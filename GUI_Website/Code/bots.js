function showBots() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Available Bots</div><div class="chat-subtitle">Select a bot to chat with</div></div>';
	fetch('/api/bots')
		.then(r => r.json())
		.then(bots => {
			const grid = document.createElement('div');
			grid.className = 'bot-grid';
			bots.forEach(bot => {
				const card = document.createElement('div');
				card.className = 'bot-card';
				const initial = bot.name[0].toUpperCase();
				const coverStyle = bot.cover_art ? buildImageStyle(bot.cover_art, bot.cover_art_fit || null) : 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);';
				const coverContent = bot.cover_art ? '' : `<div>${initial}</div>`;
				card.innerHTML = `<div class="card-cover" style="${coverStyle}">${coverContent}</div><div class="card-content"><div class="card-title">${bot.name}</div><div class="card-desc">${bot.short_description || bot.description || 'No description'}</div></div>`;
				card.onclick = () => selectBot(bot);
				grid.appendChild(card);
			});
			messagesContainer.appendChild(grid);
		});
}

function showBotCreation() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Create Bot</div><div class="chat-subtitle">Add a new AI bot</div></div>';
	renderBotCreationView(false);
}

function showBotCreationAdvanced() {
	renderBotCreationView(true);
}

const BOT_CREATION_DRAFT_KEY = 'nova.botCreationDraft.v1';
let botCreationDraft = null;
const DEFAULT_IAM_SET = 'IAM_1';
let botEditorIamState = { botName: '', setNames: [DEFAULT_IAM_SET], currentSet: DEFAULT_IAM_SET };

function getSortedIamSetNames(setNames) {
	const extractIndex = (name) => {
		const match = /^IAM_(\d+)$/i.exec(name || '');
		return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
	};
	return [...new Set((setNames || []).filter(Boolean))].sort((a, b) => {
		const ai = extractIndex(a);
		const bi = extractIndex(b);
		if (ai !== bi) {
			return ai - bi;
		}
		return String(a).localeCompare(String(b));
	});
}

function getNextIamSetName(existingNames) {
	const names = existingNames || [];
	let maxIndex = 0;
	names.forEach(name => {
		const match = /^IAM_(\d+)$/i.exec(name || '');
		if (match) {
			maxIndex = Math.max(maxIndex, parseInt(match[1], 10));
		}
	});
	return `IAM_${maxIndex + 1}`;
}

function normalizeIamSets(rawSets, rawCurrentSet, fallbackItems = []) {
	const fallback = Array.isArray(fallbackItems) ? fallbackItems : [];
	const input = rawSets && typeof rawSets === 'object' ? rawSets : {};
	const normalized = {};
	Object.keys(input).forEach(setName => {
		const safeName = setName || DEFAULT_IAM_SET;
		const value = input[setName];
		normalized[safeName] = Array.isArray(value) ? value.map(item => String(item || '')) : [];
	});
	if (Object.keys(normalized).length === 0) {
		normalized[DEFAULT_IAM_SET] = fallback.map(item => String(item || ''));
	}
	const orderedNames = getSortedIamSetNames(Object.keys(normalized));
	const current = orderedNames.includes(rawCurrentSet) ? rawCurrentSet : orderedNames[0];
	return { sets: normalized, currentSet: current, setNames: orderedNames };
}

function getCurrentCreationIamItems() {
	const { sets, currentSet } = normalizeIamSets(botCreationDraft?.iam_sets, botCreationDraft?.current_iam_set, botCreationDraft?.iam_items || []);
	return sets[currentSet] || [];
}

function getEmptyBotCreationDraft() {
	return {
		name: '',
		description: '',
		core_data: '',
		scenario_data: '',
		cover_art: '',
		icon_art: '',
		cover_art_fit: { size: 100, x: 50, y: 50 },
		icon_fit: { size: 100, x: 50, y: 50 },
		prompt_order: ['scenario', 'core', 'iam'],
		iam_sets: { [DEFAULT_IAM_SET]: [] },
		current_iam_set: DEFAULT_IAM_SET,
		iam_items: [],
		images: [],
		cover_image_name: '',
		icon_image_name: ''
	};
}

function normalizeBotCreationDraft(raw) {
	const defaults = getEmptyBotCreationDraft();
	const draft = raw && typeof raw === 'object' ? raw : {};
	const normalizedIam = normalizeIamSets(draft?.iam_sets, draft?.current_iam_set, draft?.iam_items || []);
	return {
		...defaults,
		...draft,
		cover_art_fit: {
			size: Number.isFinite(draft?.cover_art_fit?.size) ? draft.cover_art_fit.size : defaults.cover_art_fit.size,
			x: Number.isFinite(draft?.cover_art_fit?.x) ? draft.cover_art_fit.x : defaults.cover_art_fit.x,
			y: Number.isFinite(draft?.cover_art_fit?.y) ? draft.cover_art_fit.y : defaults.cover_art_fit.y
		},
		icon_fit: {
			size: Number.isFinite(draft?.icon_fit?.size) ? draft.icon_fit.size : defaults.icon_fit.size,
			x: Number.isFinite(draft?.icon_fit?.x) ? draft.icon_fit.x : defaults.icon_fit.x,
			y: Number.isFinite(draft?.icon_fit?.y) ? draft.icon_fit.y : defaults.icon_fit.y
		},
		prompt_order: normalizePromptOrder(draft?.prompt_order),
		iam_sets: normalizedIam.sets,
		current_iam_set: normalizedIam.currentSet,
		iam_items: normalizedIam.sets[normalizedIam.currentSet] || [],
		images: Array.isArray(draft?.images) ? draft.images : []
	};
}

function loadBotCreationDraft() {
	try {
		const raw = localStorage.getItem(BOT_CREATION_DRAFT_KEY);
		if (!raw) {
			return getEmptyBotCreationDraft();
		}
		return normalizeBotCreationDraft(JSON.parse(raw));
	} catch (_error) {
		return getEmptyBotCreationDraft();
	}
}

function saveBotCreationDraft() {
	if (!botCreationDraft) {
		return;
	}
	localStorage.setItem(BOT_CREATION_DRAFT_KEY, JSON.stringify(botCreationDraft));
}

function clearBotCreationDraft() {
	localStorage.removeItem(BOT_CREATION_DRAFT_KEY);
	botCreationDraft = getEmptyBotCreationDraft();
}

function readFileAsDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsDataURL(file);
	});
}

function fetchUrlAsDataUrl(url) {
	return fetch(url)
		.then(response => {
			if (!response.ok) {
				throw new Error('Failed to fetch image');
			}
			return response.blob();
		})
		.then(blob => new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(new Error('Failed to convert image'));
			reader.readAsDataURL(blob);
		}));
}

function getDataUrlExtension(dataUrl) {
	if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
		return 'png';
	}
	const match = dataUrl.match(/^data:([^;]+);/i);
	if (!match || !match[1]) {
		return 'png';
	}
	const mime = match[1].toLowerCase();
	if (mime === 'image/jpeg') {
		return 'jpg';
	}
	if (mime === 'image/svg+xml') {
		return 'svg';
	}
	if (mime === 'image/webp') {
		return 'webp';
	}
	if (mime === 'image/gif') {
		return 'gif';
	}
	return 'png';
}

function buildUniqueImageName(images, baseName) {
	const existingNames = new Set((images || []).map(img => img.name));
	if (!existingNames.has(baseName)) {
		return baseName;
	}
	const dotIndex = baseName.lastIndexOf('.');
	const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
	const ext = dotIndex > 0 ? baseName.slice(dotIndex) : '';
	let index = 1;
	let candidate = `${stem}_${index}${ext}`;
	while (existingNames.has(candidate)) {
		index += 1;
		candidate = `${stem}_${index}${ext}`;
	}
	return candidate;
}

function ensureDraftImageReference(images, preferredName, dataUrl, fallbackBaseName) {
	if (!dataUrl) {
		return preferredName || '';
	}
	const imageList = Array.isArray(images) ? images : [];
	if (preferredName && imageList.some(img => img.name === preferredName)) {
		return preferredName;
	}
	const existingByContent = imageList.find(img => img.data_url === dataUrl);
	if (existingByContent) {
		return existingByContent.name;
	}
	const extension = getDataUrlExtension(dataUrl);
	const proposedName = `${fallbackBaseName}.${extension}`;
	const uniqueName = buildUniqueImageName(imageList, proposedName);
	imageList.push({ name: uniqueName, data_url: dataUrl });
	return uniqueName;
}

function setCreationPreviewStyle(targetId, art, fit, fallback) {
	const target = document.getElementById(targetId);
	if (!target) {
		return;
	}
	if (art) {
		target.style.cssText = buildImageStyle(art, fit);
		target.textContent = '';
		return;
	}
	target.style.cssText = fallback;
	target.textContent = botCreationDraft.name ? botCreationDraft.name[0].toUpperCase() : 'B';
}

function updateCreationDraftFromForm() {
	if (!botCreationDraft) {
		return;
	}
	const nameInput = document.getElementById('create-bot-name');
	const descInput = document.getElementById('create-bot-description');
	const coreInput = document.getElementById('create-bot-core');
	const scenarioInput = document.getElementById('create-bot-scenario');
	const coverZoom = document.getElementById('create-cover-zoom');
	const coverPosX = document.getElementById('create-cover-posX');
	const coverPosY = document.getElementById('create-cover-posY');
	const iconZoom = document.getElementById('create-icon-zoom');
	const iconPosX = document.getElementById('create-icon-posX');
	const iconPosY = document.getElementById('create-icon-posY');

	if (nameInput) {
		botCreationDraft.name = nameInput.value;
	}
	if (descInput) {
		botCreationDraft.description = descInput.value;
	}
	if (coreInput) {
		botCreationDraft.core_data = coreInput.value;
	}
	if (scenarioInput) {
		botCreationDraft.scenario_data = scenarioInput.value;
	}
	if (coverZoom && coverPosX && coverPosY) {
		botCreationDraft.cover_art_fit = {
			size: parseInt(coverZoom.value, 10),
			x: parseInt(coverPosX.value, 10),
			y: parseInt(coverPosY.value, 10)
		};
	}
	if (iconZoom && iconPosX && iconPosY) {
		botCreationDraft.icon_fit = {
			size: parseInt(iconZoom.value, 10),
			x: parseInt(iconPosX.value, 10),
			y: parseInt(iconPosY.value, 10)
		};
	}

	const iamRows = document.querySelectorAll('.create-iam-item');
	const items = Array.from(iamRows)
		.map(row => (row.querySelector('.create-iam-input') || {}).value || '')
		.map(value => value.trim())
		.filter(Boolean);
	const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
	normalizedIam.sets[normalizedIam.currentSet] = items;
	botCreationDraft.iam_sets = normalizedIam.sets;
	botCreationDraft.current_iam_set = normalizedIam.currentSet;
	botCreationDraft.iam_items = items;

	saveBotCreationDraft();
}

function renderBotCreationIamList() {
	const list = document.getElementById('create-bot-iam-list');
	if (!list || !botCreationDraft) {
		return;
	}
	const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
	botCreationDraft.iam_sets = normalizedIam.sets;
	botCreationDraft.current_iam_set = normalizedIam.currentSet;
	botCreationDraft.iam_items = normalizedIam.sets[normalizedIam.currentSet] || [];
	const iamLabel = document.getElementById('create-iam-set-label');
	if (iamLabel) {
		iamLabel.textContent = botCreationDraft.current_iam_set;
	}
	list.innerHTML = '';
	const items = botCreationDraft.iam_items.length ? botCreationDraft.iam_items : [''];
	items.forEach(content => {
		const row = document.createElement('div');
		row.className = 'iam-item create-iam-item';
		row.innerHTML = `<textarea class="setting-input iam-input create-iam-input" rows="2">${content || ''}</textarea><button class="btn btn-secondary create-iam-delete" type="button">Delete</button>`;
		const deleteBtn = row.querySelector('.create-iam-delete');
		const input = row.querySelector('.create-iam-input');
		if (deleteBtn) {
			deleteBtn.addEventListener('click', () => {
				row.remove();
				updateCreationDraftFromForm();
			});
		}
		if (input) {
			input.addEventListener('input', updateCreationDraftFromForm);
		}
		list.appendChild(row);
	});
}

function renderBotCreationImages() {
	const gallery = document.getElementById('create-bot-image-gallery');
	if (!gallery || !botCreationDraft) {
		return;
	}
	if (!botCreationDraft.images.length) {
		gallery.innerHTML = '<p style="color: #999; grid-column: 1/-1;">No images yet</p>';
		return;
	}
	gallery.innerHTML = '';
	botCreationDraft.images.forEach(img => {
		const card = document.createElement('div');
		card.className = 'image-card';
		card.innerHTML = `
			<div class="image-thumb" style="background-image: url('${img.data_url}'); background-size: cover; background-position: center;"></div>
			<div class="image-actions">
				<button class="img-action-btn create-img-cover" type="button" title="Set as cover">🖼️</button>
				<button class="img-action-btn create-img-icon" type="button" title="Set as icon">👤</button>
				<button class="img-action-btn delete-btn create-img-delete" type="button" title="Delete">🗑️</button>
			</div>
		`;
		card.querySelector('.create-img-cover').addEventListener('click', () => {
			botCreationDraft.cover_art = img.data_url;
			botCreationDraft.cover_image_name = img.name;
			saveBotCreationDraft();
			setCreationPreviewStyle('create-cover-preview', botCreationDraft.cover_art, botCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);');
		});
		card.querySelector('.create-img-icon').addEventListener('click', () => {
			botCreationDraft.icon_art = img.data_url;
			botCreationDraft.icon_image_name = img.name;
			saveBotCreationDraft();
			setCreationPreviewStyle('create-icon-preview', botCreationDraft.icon_art, botCreationDraft.icon_fit, 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);');
		});
		card.querySelector('.create-img-delete').addEventListener('click', () => {
			botCreationDraft.images = botCreationDraft.images.filter(item => item.name !== img.name);
			if (botCreationDraft.cover_image_name === img.name) {
				botCreationDraft.cover_image_name = '';
				botCreationDraft.cover_art = '';
			}
			if (botCreationDraft.icon_image_name === img.name) {
				botCreationDraft.icon_image_name = '';
				botCreationDraft.icon_art = '';
			}
			saveBotCreationDraft();
			renderBotCreationImages();
			setCreationPreviewStyle('create-cover-preview', botCreationDraft.cover_art, botCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);');
			setCreationPreviewStyle('create-icon-preview', botCreationDraft.icon_art, botCreationDraft.icon_fit, 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);');
		});
		gallery.appendChild(card);
	});
}

function bindBotCreationAdjustments() {
	const bindRange = (id, callback) => {
		const el = document.getElementById(id);
		if (!el) {
			return;
		}
		el.addEventListener('input', callback);
	};

	const updateCover = () => {
		updateCreationDraftFromForm();
		document.getElementById('create-cover-zoom-val').textContent = `${botCreationDraft.cover_art_fit.size}%`;
		document.getElementById('create-cover-posX-val').textContent = `${botCreationDraft.cover_art_fit.x}%`;
		document.getElementById('create-cover-posY-val').textContent = `${botCreationDraft.cover_art_fit.y}%`;
		setCreationPreviewStyle('create-cover-preview', botCreationDraft.cover_art, botCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);');
	};
	const updateIcon = () => {
		updateCreationDraftFromForm();
		document.getElementById('create-icon-zoom-val').textContent = `${botCreationDraft.icon_fit.size}%`;
		document.getElementById('create-icon-posX-val').textContent = `${botCreationDraft.icon_fit.x}%`;
		document.getElementById('create-icon-posY-val').textContent = `${botCreationDraft.icon_fit.y}%`;
		setCreationPreviewStyle('create-icon-preview', botCreationDraft.icon_art, botCreationDraft.icon_fit, 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);');
	};

	['create-cover-zoom', 'create-cover-posX', 'create-cover-posY'].forEach(id => bindRange(id, updateCover));
	['create-icon-zoom', 'create-icon-posX', 'create-icon-posY'].forEach(id => bindRange(id, updateIcon));
}

function loadCloneBotOptions(menuEl) {
	if (!menuEl) {
		return;
	}
	menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Loading bots...</button>';
	fetch('/api/bots')
		.then(r => r.json())
		.then(bots => {
			const list = Array.isArray(bots) ? bots : [];
			if (!list.length) {
				menuEl.innerHTML = '<button class="persona-option" type="button" disabled>No bots available</button>';
				return;
			}
			menuEl.innerHTML = '';
			list.forEach(bot => {
				const option = document.createElement('button');
				option.type = 'button';
				option.className = 'persona-option';
				const icon = document.createElement('span');
				icon.className = 'persona-option-icon';
				if (bot.icon_art || bot.cover_art) {
					icon.style.cssText = buildImageStyle(bot.icon_art || bot.cover_art, bot.icon_fit || bot.cover_art_fit || null);
					icon.textContent = '';
				} else {
					icon.textContent = (bot.name || 'B')[0].toUpperCase();
				}
				const text = document.createElement('span');
				text.className = 'persona-option-text';
				text.textContent = bot.name;
				option.appendChild(icon);
				option.appendChild(text);
				option.addEventListener('click', () => {
					cloneExistingBotIntoDraft(bot.name);
					menuEl.classList.add('hidden');
				});
				menuEl.appendChild(option);
			});
		})
		.catch(() => {
			menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Failed to load bots</button>';
		});
}

function cloneExistingBotIntoDraft(botName) {
	Promise.all([
		fetch('/api/bot/select', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bot_name: botName })
		}).then(r => r.json()),
		fetch('/api/bot/iam', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'list_all', bot_name: botName })
		}).then(r => r.json()),
		fetch('/api/bot/images', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'list', bot_name: botName })
		}).then(r => r.json())
	])
		.then(async ([botResponse, iamResponse, imagesResponse]) => {
			if (!botResponse || !botResponse.success || !botResponse.bot) {
				alert('Failed to clone bot.');
				return;
			}
			const bot = botResponse.bot;
			const iamSetsPayload = (iamResponse && Array.isArray(iamResponse.sets)) ? iamResponse.sets : [];
			const iamSets = {};
			iamSetsPayload.forEach(setEntry => {
				const setName = (setEntry && setEntry.name) ? setEntry.name : DEFAULT_IAM_SET;
				const setItems = (setEntry && Array.isArray(setEntry.items)) ? setEntry.items.map(item => item.content).filter(Boolean) : [];
				iamSets[setName] = setItems;
			});
			const normalizedIam = normalizeIamSets(iamSets, iamResponse && iamResponse.current_set, []);
			const imageItems = (imagesResponse && imagesResponse.items) ? imagesResponse.items : [];

			const convertedImages = await Promise.all(imageItems.map(async (img) => {
				try {
					const data_url = await fetchUrlAsDataUrl(img.url);
					return { name: img.name, data_url };
				} catch (_error) {
					return null;
				}
			}));

			let coverArt = '';
			let iconArt = '';
			try {
				coverArt = bot.cover_art ? await fetchUrlAsDataUrl(bot.cover_art) : '';
			} catch (_error) {
				coverArt = '';
			}
			try {
				iconArt = bot.icon_art ? await fetchUrlAsDataUrl(bot.icon_art) : '';
			} catch (_error) {
				iconArt = '';
			}

			botCreationDraft = normalizeBotCreationDraft({
				name: `${bot.name}_copy`,
				description: bot.description || '',
				core_data: bot.core_data || '',
				scenario_data: bot.scenario_data || '',
				cover_art: coverArt,
				icon_art: iconArt,
				cover_art_fit: bot.cover_art_fit || { size: 100, x: 50, y: 50 },
				icon_fit: bot.icon_fit || { size: 100, x: 50, y: 50 },
				prompt_order: bot.prompt_order || ['scenario', 'core', 'iam'],
				iam_sets: normalizedIam.sets,
				current_iam_set: normalizedIam.currentSet,
				iam_items: normalizedIam.sets[normalizedIam.currentSet] || [],
				images: convertedImages.filter(Boolean)
			});
			saveBotCreationDraft();
			renderBotCreationView();
		})
		.catch(() => {
			alert('Failed to clone bot.');
		});
}

function renderBotCreationView(advancedMode = false) {
	botCreationDraft = normalizeBotCreationDraft(loadBotCreationDraft());
	messagesContainer.innerHTML = '';
	const editor = document.createElement('div');
	editor.className = 'bot-editor';
	if (advancedMode) {
		editor.classList.add('bot-editor-advanced');
	}
	const initial = botCreationDraft.name ? botCreationDraft.name[0].toUpperCase() : 'B';

	const detailsHeader = advancedMode
		? `<div class="detail-title-row"><button class="icon-btn create-bot-advanced-back-btn" type="button" title="Back to full editor" aria-label="Back to full editor"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.707 4.293a1 1 0 010 1.414L6.414 9H17a1 1 0 110 2H6.414l3.293 3.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></button><h3>Bot Details</h3><div class="persona-picker"><button class="btn btn-secondary persona-picker-btn" type="button" id="cloneBotBtn">Clone Existing Bot</button><div class="persona-picker-menu hidden" id="cloneBotMenu"></div></div></div>`
		: `<div class="detail-title-row"><h3>Bot Details</h3><div style="display:flex;align-items:center;gap:0.5rem;"><div class="persona-picker"><button class="btn btn-secondary persona-picker-btn" type="button" id="cloneBotBtn">Clone Existing Bot</button><div class="persona-picker-menu hidden" id="cloneBotMenu"></div></div><button class="icon-btn create-bot-advanced-settings-btn" type="button" title="Advanced settings" aria-label="Advanced settings"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg></button></div></div>`;

	const detailsSection = `
			<div class="bot-editor-section">
				${detailsHeader}
				<div class="form-group">
					<label>Name</label>
					<input type="text" id="create-bot-name" class="text-input" value="${botCreationDraft.name || ''}">
				</div>
				<div class="form-group">
					<label>Description</label>
					<textarea id="create-bot-description" class="text-input" rows="3">${botCreationDraft.description || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Definition (core.txt)</label>
					<textarea id="create-bot-core" class="text-input" rows="4">${botCreationDraft.core_data || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Rules (scenario.txt)</label>
					<textarea id="create-bot-scenario" class="text-input" rows="4">${botCreationDraft.scenario_data || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Initial Messages (IAM)</label>
					<div class="iam-set-nav" style="margin-bottom:0.5rem;">
						<button type="button" class="action-btn cancel-btn" id="create-iam-prev-btn">&lt;</button>
						<span class="iam-set-label" id="create-iam-set-label">${botCreationDraft.current_iam_set || DEFAULT_IAM_SET}</span>
						<button type="button" class="action-btn cancel-btn" id="create-iam-next-btn">&gt;</button>
						<button type="button" class="action-btn" id="create-iam-new-set-btn">Create New</button>
						<button type="button" class="action-btn delete-btn" id="create-iam-delete-set-btn">Delete IAM</button>
					</div>
					<div id="create-bot-iam-list" class="iam-list"></div>
					<div style="margin-top:1rem;display:flex;gap:0.5rem;">
						<button type="button" class="action-btn" id="create-bot-add-iam-btn">Add Message</button>
					</div>
				</div>
				${advancedMode ? `<div class="form-group"><label>Prompt Order</label><div class="prompt-order-list" id="create-prompt-order-list"></div></div>` : ''}
			</div>`;

	const mediaSections = `
			<div class="bot-editor-section">
				<div class="bot-preview-with-controls">
					<div class="bot-preview-container">
						<h3>Cover Art</h3>
						<div class="detail-cover" id="create-cover-preview">${botCreationDraft.cover_art ? '' : initial}</div>
					</div>
					<div class="bot-controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item">
								<label>Zoom (%)</label>
								<input type="range" id="create-cover-zoom" min="50" max="300" value="${(botCreationDraft.cover_art_fit?.size || 100)}" class="slider">
								<span id="create-cover-zoom-val">${(botCreationDraft.cover_art_fit?.size || 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="create-cover-posX" min="0" max="100" value="${(botCreationDraft.cover_art_fit?.x || 50)}" class="slider">
								<span id="create-cover-posX-val">${(botCreationDraft.cover_art_fit?.x || 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="create-cover-posY" min="0" max="100" value="${(botCreationDraft.cover_art_fit?.y || 50)}" class="slider">
								<span id="create-cover-posY-val">${(botCreationDraft.cover_art_fit?.y || 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div class="bot-editor-section">
				<h3>Images</h3>
				<div class="form-group">
					<input type="file" id="create-bot-image-upload" multiple accept="image/*" style="display:none;">
					<button type="button" class="action-btn" onclick="document.getElementById('create-bot-image-upload').click()">Upload Images</button>
				</div>
				<div id="create-bot-image-gallery" class="image-gallery"></div>
			</div>

			<div class="bot-editor-section">
				<div class="bot-preview-with-controls">
					<div class="bot-preview-container">
						<h3>Icon</h3>
						<div class="detail-icon" id="create-icon-preview">${botCreationDraft.icon_art ? '' : initial}</div>
					</div>
					<div class="bot-controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item">
								<label>Zoom (%)</label>
								<input type="range" id="create-icon-zoom" min="50" max="300" value="${(botCreationDraft.icon_fit?.size || 100)}" class="slider">
								<span id="create-icon-zoom-val">${(botCreationDraft.icon_fit?.size || 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="create-icon-posX" min="0" max="100" value="${(botCreationDraft.icon_fit?.x || 50)}" class="slider">
								<span id="create-icon-posX-val">${(botCreationDraft.icon_fit?.x || 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="create-icon-posY" min="0" max="100" value="${(botCreationDraft.icon_fit?.y || 50)}" class="slider">
								<span id="create-icon-posY-val">${(botCreationDraft.icon_fit?.y || 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

	editor.innerHTML = `
		<div class="bot-editor-grid masonry-grid${advancedMode ? ' bot-editor-grid-advanced' : ''}">
			${detailsSection}
			${advancedMode ? '' : mediaSections}
		</div>
		<div class="bot-editor-footer">
			<button type="button" class="action-btn cancel-btn" id="create-bot-clear-btn">Clear</button>
			<button type="button" class="action-btn save-btn" id="create-bot-create-btn">Create</button>
		</div>
	`;
	messagesContainer.appendChild(editor);
	makeSectionsCollapsible(editor, '.bot-editor-section', `bot-create:${advancedMode ? 'advanced' : 'standard'}`);
	scheduleMasonryRefresh(editor);

	renderBotCreationIamList();

	if (!advancedMode) {
		setCreationPreviewStyle('create-cover-preview', botCreationDraft.cover_art, botCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);');
		setCreationPreviewStyle('create-icon-preview', botCreationDraft.icon_art, botCreationDraft.icon_fit, 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);');
		renderBotCreationImages();
		bindBotCreationAdjustments();
	} else {
		initPromptOrderEditor(botCreationDraft.prompt_order, 'create-prompt-order-list', (order) => {
			botCreationDraft.prompt_order = order;
			saveBotCreationDraft();
		});
	}

	['create-bot-name', 'create-bot-description', 'create-bot-core', 'create-bot-scenario'].forEach(id => {
		const input = document.getElementById(id);
		if (input) {
			input.addEventListener('input', updateCreationDraftFromForm);
		}
	});

	const addIamBtn = document.getElementById('create-bot-add-iam-btn');
	if (addIamBtn) {
		addIamBtn.addEventListener('click', () => {
			const list = document.getElementById('create-bot-iam-list');
			const row = document.createElement('div');
			row.className = 'iam-item create-iam-item';
			row.innerHTML = `<textarea class="setting-input iam-input create-iam-input" rows="2"></textarea><button class="btn btn-secondary create-iam-delete" type="button">Delete</button>`;
			row.querySelector('.create-iam-delete').addEventListener('click', () => {
				row.remove();
				updateCreationDraftFromForm();
			});
			row.querySelector('.create-iam-input').addEventListener('input', updateCreationDraftFromForm);
			list.appendChild(row);
			updateCreationDraftFromForm();
		});
	}

	const createPrevIamBtn = document.getElementById('create-iam-prev-btn');
	const createNextIamBtn = document.getElementById('create-iam-next-btn');
	const createNewSetBtn = document.getElementById('create-iam-new-set-btn');
	const createDeleteSetBtn = document.getElementById('create-iam-delete-set-btn');
	const switchCreateSet = (direction) => {
		updateCreationDraftFromForm();
		const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
		const setNames = normalizedIam.setNames;
		if (!setNames.length) {
			return;
		}
		const currentIndex = Math.max(0, setNames.indexOf(normalizedIam.currentSet));
		const nextIndex = (currentIndex + direction + setNames.length) % setNames.length;
		botCreationDraft.iam_sets = normalizedIam.sets;
		botCreationDraft.current_iam_set = setNames[nextIndex];
		botCreationDraft.iam_items = botCreationDraft.iam_sets[botCreationDraft.current_iam_set] || [];
		saveBotCreationDraft();
		renderBotCreationIamList();
	};
	if (createPrevIamBtn) {
		createPrevIamBtn.addEventListener('click', () => switchCreateSet(-1));
	}
	if (createNextIamBtn) {
		createNextIamBtn.addEventListener('click', () => switchCreateSet(1));
	}
	if (createNewSetBtn) {
		createNewSetBtn.addEventListener('click', () => {
			updateCreationDraftFromForm();
			const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
			const newSetName = getNextIamSetName(normalizedIam.setNames);
			normalizedIam.sets[newSetName] = [];
			botCreationDraft.iam_sets = normalizedIam.sets;
			botCreationDraft.current_iam_set = newSetName;
			botCreationDraft.iam_items = [];
			saveBotCreationDraft();
			renderBotCreationIamList();
		});
	}
	if (createDeleteSetBtn) {
		createDeleteSetBtn.addEventListener('click', () => {
			updateCreationDraftFromForm();
			if ((botCreationDraft.current_iam_set || DEFAULT_IAM_SET) === DEFAULT_IAM_SET) {
				alert('IAM_1 cannot be deleted.');
				return;
			}
			if (!confirm(`Delete ${botCreationDraft.current_iam_set}?`)) {
				return;
			}
			const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
			delete normalizedIam.sets[normalizedIam.currentSet];
			const remaining = getSortedIamSetNames(Object.keys(normalizedIam.sets));
			botCreationDraft.iam_sets = normalizedIam.sets;
			botCreationDraft.current_iam_set = remaining.includes(DEFAULT_IAM_SET) ? DEFAULT_IAM_SET : (remaining[0] || DEFAULT_IAM_SET);
			botCreationDraft.iam_items = botCreationDraft.iam_sets[botCreationDraft.current_iam_set] || [];
			saveBotCreationDraft();
			renderBotCreationIamList();
		});
	}

	const imageUpload = document.getElementById('create-bot-image-upload');
	if (imageUpload && !advancedMode) {
		imageUpload.addEventListener('change', async (event) => {
			const files = Array.from(event.target.files || []);
			if (!files.length) {
				return;
			}
			for (const file of files) {
				try {
					const data_url = await readFileAsDataUrl(file);
					botCreationDraft.images.push({ name: file.name, data_url });
				} catch (_error) {
				}
			}
			saveBotCreationDraft();
			renderBotCreationImages();
			event.target.value = '';
		});
	}

	const cloneBtn = document.getElementById('cloneBotBtn');
	const cloneMenu = document.getElementById('cloneBotMenu');
	if (cloneBtn && cloneMenu) {
		cloneBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			const isHidden = cloneMenu.classList.contains('hidden');
			if (isHidden) {
				loadCloneBotOptions(cloneMenu);
			}
			cloneMenu.classList.toggle('hidden');
		});
		setTimeout(() => {
			document.addEventListener('click', (event) => {
				if (!editor.contains(event.target)) {
					cloneMenu.classList.add('hidden');
				}
			});
		}, 0);
	}

	const advancedBtn = document.querySelector('.create-bot-advanced-settings-btn');
	if (advancedBtn) {
		advancedBtn.addEventListener('click', () => showBotCreationAdvanced());
	}

	const backBtn = document.querySelector('.create-bot-advanced-back-btn');
	if (backBtn) {
		backBtn.addEventListener('click', () => showBotCreation());
	}

	const clearBtn = document.getElementById('create-bot-clear-btn');
	if (clearBtn) {
		clearBtn.addEventListener('click', () => {
			if (!confirm('Clear all bot creation fields?')) {
				return;
			}
			clearBotCreationDraft();
			renderBotCreationView(advancedMode);
		});
	}

	const createBtn = document.getElementById('create-bot-create-btn');
	if (createBtn) {
		createBtn.addEventListener('click', () => {
			createBotFromDraft();
		});
	}
}

function createBotFromDraft() {
	updateCreationDraftFromForm();
	const draft = normalizeBotCreationDraft(botCreationDraft);
	if (!draft.name.trim()) {
		alert('Bot name required');
		return;
	}
	const creationImages = [...(draft.images || [])];
	const coverImageName = ensureDraftImageReference(creationImages, draft.cover_image_name, draft.cover_art, 'cover_clone');
	const iconImageName = ensureDraftImageReference(creationImages, draft.icon_image_name, draft.icon_art, 'icon_clone');
	const normalizedIam = normalizeIamSets(draft.iam_sets, draft.current_iam_set, draft.iam_items || []);
	const iamSetsPayload = normalizedIam.setNames.map(setName => ({
		name: setName,
		items: (normalizedIam.sets[setName] || []).map(item => (item || '').trim()).filter(Boolean)
	}));

	fetch('/api/bots', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'create', name: draft.name.trim(), core_data: draft.core_data || '' })
	})
		.then(r => r.json())
		.then(created => {
			if (!created || !created.name) {
				throw new Error('Bot creation failed');
			}
			const botName = created.name;
			const updates = fetch('/api/bots', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'update',
					bot_name: botName,
					new_name: botName,
					description: draft.description,
					core_data: draft.core_data,
					scenario_data: draft.scenario_data,
					cover_art_fit: draft.cover_art_fit,
					icon_fit: draft.icon_fit,
					prompt_order: draft.prompt_order,
					active_iam_set: normalizedIam.currentSet
				})
			});

			const uploadImages = Promise.all(creationImages.map(img =>
				fetch('/api/bot/images', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'upload', bot_name: botName, filename: img.name, data_url: img.data_url })
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('Image upload failed');
						}
					})
			));

			const saveIamSets = iamSetsPayload.reduce((chain, iamSet) =>
				chain.then(() => fetch('/api/bot/iam', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'create_set', bot_name: botName, iam_set: iamSet.name })
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('IAM set creation failed');
						}
					})
					.then(() => fetch('/api/bot/iam', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'replace', bot_name: botName, iam_set: iamSet.name, items: iamSet.items })
					}))
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('IAM set save failed');
						}
					})), Promise.resolve()
			);

			return Promise.all([updates, uploadImages, saveIamSets]).then(() => botName);
		})
		.then(botName => {
			const postActions = [];
			if (coverImageName) {
				postActions.push(fetch('/api/bot/images', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'set_coverart', bot_name: botName, filename: coverImageName })
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('Setting cover image failed');
						}
					}));
			}
			if (iconImageName) {
				postActions.push(fetch('/api/bot/images', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'set_icon', bot_name: botName, filename: iconImageName, source: 'Images' })
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('Setting icon image failed');
						}
					}));
			}
			return Promise.all(postActions).then(() => botName);
		})
		.then(() => {
			clearBotCreationDraft();
			alert('Bot created successfully');
			navItems[1].click();
		})
		.catch(() => {
			alert('Failed to create bot. Ensure the name is unique and try again.');
		});
}

function selectBot(bot) {
	currentBotName = bot.name;
	currentBotInfo = bot;
	fetch('/api/bot/select', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ bot_name: bot.name })
	})
		.then(r => r.json())
		.then(data => {
			if (data.success) {
				currentBotInfo = data.bot;
				showBotDetail(data.bot);
				updateBotPanel();
			}
		});
}

function showBotDetail(bot) {
	renderBotDetailView(bot);
}

function getPersonaDisplay(persona) {
	const name = (persona && persona.name) ? persona.name : 'User';
	const iconArt = (persona && persona.icon_art) ? persona.icon_art : ((persona && persona.cover_art) ? persona.cover_art : '');
	const iconFit = (persona && persona.icon_fit) ? persona.icon_fit : ((persona && persona.cover_art_fit) ? persona.cover_art_fit : null);
	const initial = name ? name[0].toUpperCase() : 'U';
	return { name, iconArt, iconFit, initial };
}

function setPersonaPickerButtonContent(buttonEl, persona) {
	if (!buttonEl) {
		return;
	}
	const display = getPersonaDisplay(persona);
	buttonEl.innerHTML = '';

	const icon = document.createElement('span');
	icon.className = 'persona-chip-icon';
	if (display.iconArt) {
		icon.style.cssText = buildImageStyle(display.iconArt, display.iconFit);
		icon.textContent = '';
	} else {
		icon.textContent = display.initial;
	}

	const label = document.createElement('span');
	label.className = 'persona-chip-label';
	label.textContent = `Persona: ${display.name}`;

	buttonEl.appendChild(icon);
	buttonEl.appendChild(label);
}

function loadPersonaPickerOptions(menuEl, buttonEl) {
	if (!menuEl || !buttonEl) {
		return;
	}
	menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Loading personas...</button>';

	fetch('/api/personas')
		.then(r => r.json())
		.then(personas => {
			const list = Array.isArray(personas) ? personas : [];
			if (!list.length) {
				menuEl.innerHTML = '<button class="persona-option" type="button" disabled>No personas available</button>';
				return;
			}

			if (!currentPersonaInfo) {
				currentPersonaInfo = list.find(p => p.id === 'User') || list[0];
			}

			setPersonaPickerButtonContent(buttonEl, currentPersonaInfo);
			menuEl.innerHTML = '';
			list.forEach(persona => {
				const display = getPersonaDisplay(persona);
				const option = document.createElement('button');
				option.type = 'button';
				option.className = 'persona-option' + ((currentPersonaInfo && currentPersonaInfo.id === persona.id) ? ' active' : '');

				const icon = document.createElement('span');
				icon.className = 'persona-option-icon';
				if (display.iconArt) {
					icon.style.cssText = buildImageStyle(display.iconArt, display.iconFit);
					icon.textContent = '';
				} else {
					icon.textContent = display.initial;
				}

				const text = document.createElement('span');
				text.className = 'persona-option-text';
				text.textContent = display.name;

				option.appendChild(icon);
				option.appendChild(text);
				option.addEventListener('click', (event) => {
					event.stopPropagation();
					currentPersonaInfo = persona;
					setPersonaPickerButtonContent(buttonEl, currentPersonaInfo);
					menuEl.classList.add('hidden');
				});
				menuEl.appendChild(option);
			});
		})
		.catch(() => {
			menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Failed to load personas</button>';
		});
}

function renderBotDetailView(bot) {
	chatHeader.innerHTML = `<div><div class="chat-title">${bot.name}</div><div class="chat-subtitle">Bot Details</div></div>`;
	// Clear the messages container to replace the bot grid
	messagesContainer.innerHTML = '';
	const detail = document.createElement('div');
	detail.className = 'bot-detail';
	const initial = bot.name[0].toUpperCase();
	// Use coverart if available, otherwise use gradient with initial
	const coverStyle = bot.cover_art 
		? buildImageStyle(bot.cover_art, bot.cover_art_fit || null)
		: `background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);`;
	const coverContent = bot.cover_art ? '' : `<div>${initial}</div>`;
	detail.innerHTML = `<div class="detail-cover" style="${coverStyle}">${coverContent}</div><div class="detail-info"><div class="detail-title-row"><h2>${bot.name}</h2><button class="icon-btn bot-edit-btn" type="button" title="Edit bot" aria-label="Edit bot"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-1 1-3.828-3.828 1-1a2 2 0 012.828 0zM2 13.586l9.586-9.586 3.828 3.828L5.828 17.414H2v-3.828z"/></svg></button></div><p>${bot.description || 'No description provided.'}</p><div class="detail-actions detail-actions-inline"><button class="btn btn-primary" onclick="startNewChat('${bot.name}')">Start New Chat</button><div class="persona-picker"><button class="btn btn-secondary persona-picker-btn" type="button" id="personaPickerBtn"></button><div class="persona-picker-menu hidden" id="personaPickerMenu"></div></div><button class="btn btn-secondary" onclick="continuePreviousChat('${bot.name}')">Continue Last Chat</button></div></div>`;
	messagesContainer.appendChild(detail);
	const editBtn = detail.querySelector('.bot-edit-btn');
	const personaPickerBtn = detail.querySelector('#personaPickerBtn');
	const personaPickerMenu = detail.querySelector('#personaPickerMenu');
	if (editBtn) {
		editBtn.addEventListener('click', () => {
			showBotEditor(bot);
		});
	}
	if (personaPickerBtn && personaPickerMenu) {
		setPersonaPickerButtonContent(personaPickerBtn, currentPersonaInfo);
		const closePersonaPicker = (event) => {
			if (!detail.contains(event.target)) {
				personaPickerMenu.classList.add('hidden');
				document.removeEventListener('click', closePersonaPicker);
			}
		};
		loadPersonaPickerOptions(personaPickerMenu, personaPickerBtn);
		personaPickerBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			const isHidden = personaPickerMenu.classList.contains('hidden');
			if (isHidden) {
				loadPersonaPickerOptions(personaPickerMenu, personaPickerBtn);
				setTimeout(() => {
					document.addEventListener('click', closePersonaPicker);
				}, 0);
			} else {
				document.removeEventListener('click', closePersonaPicker);
			}
			personaPickerMenu.classList.toggle('hidden');
		});
	}
}

function showBotEditor(bot) {
	renderBotEditor(bot, false);
}

function showBotAdvancedEditor(bot) {
	renderBotEditor(bot, true);
}

function normalizePromptOrder(promptOrder) {
	const defaults = ['scenario', 'core', 'user_persona', 'iam'];
	if (!Array.isArray(promptOrder)) {
		return [...defaults];
	}
	const normalized = [];
	promptOrder.forEach(item => {
		if (defaults.includes(item) && !normalized.includes(item)) {
			normalized.push(item);
		}
	});
	defaults.forEach(item => {
		if (!normalized.includes(item)) {
			normalized.push(item);
		}
	});
	return normalized;
}

function getPromptOrderLabel(key) {
	if (key === 'scenario') {
		return 'Rules / Scenario';
	}
	if (key === 'core') {
		return 'Definition / Core';
	}
	if (key === 'user_persona') {
		return 'User / Persona';
	}
	return 'Chat History / IAM\'s';
}

function renderPromptOrderItems(container, promptOrder) {
	if (!container) {
		return;
	}
	container.innerHTML = '';
	normalizePromptOrder(promptOrder).forEach((key, index) => {
		const item = document.createElement('div');
		item.className = 'prompt-order-item';
		item.draggable = true;
		item.dataset.sectionKey = key;
		item.innerHTML = `<span class="prompt-order-index">${index + 1}.</span><span class="prompt-order-label">${getPromptOrderLabel(key)}</span>`;
		container.appendChild(item);
	});
}

function initPromptOrderEditor(initialOrder, containerId = 'prompt-order-list', onOrderChange = null) {
	const container = document.getElementById(containerId);
	if (!container) {
		return;
	}
	renderPromptOrderItems(container, initialOrder);

	let dragKey = null;
	container.addEventListener('dragstart', (event) => {
		const item = event.target.closest('.prompt-order-item');
		if (!item) {
			return;
		}
		dragKey = item.dataset.sectionKey;
		item.classList.add('dragging');
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', dragKey);
		}
	});

	container.addEventListener('dragend', (event) => {
		const item = event.target.closest('.prompt-order-item');
		if (item) {
			item.classList.remove('dragging');
		}
		dragKey = null;
	});

	container.addEventListener('dragover', (event) => {
		event.preventDefault();
		const target = event.target.closest('.prompt-order-item');
		const dragging = container.querySelector('.prompt-order-item.dragging');
		if (!target || !dragging || target === dragging) {
			return;
		}
		const rect = target.getBoundingClientRect();
		const after = event.clientX > rect.left + rect.width / 2;
		if (after) {
			target.after(dragging);
		} else {
			target.before(dragging);
		}
	});

	container.addEventListener('drop', (event) => {
		event.preventDefault();
		const orderedKeys = Array.from(container.querySelectorAll('.prompt-order-item')).map(el => el.dataset.sectionKey);
		renderPromptOrderItems(container, orderedKeys);
		if (typeof onOrderChange === 'function') {
			onOrderChange(normalizePromptOrder(orderedKeys));
		}
	});
}

function renderBotEditor(bot, advancedMode) {
	chatHeader.innerHTML = `<div><div class="chat-title">Edit ${bot.name}</div><div class="chat-subtitle">Bot Editor</div></div>`;
	messagesContainer.innerHTML = '';
	const editor = document.createElement('div');
	editor.className = 'bot-editor';
	if (advancedMode) {
		editor.classList.add('bot-editor-advanced');
	}
	
	const initial = bot.name[0].toUpperCase();
	const defaultGrad = 'linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%)';
	
	const coverStyle = bot.cover_art
		? buildImageStyle(bot.cover_art, bot.cover_art_fit || null)
		: `background:${defaultGrad};`;
	const iconStyle = bot.icon_art
		? buildImageStyle(bot.icon_art, bot.icon_fit || null)
		: `background:${defaultGrad};`;
	
	const coverContent = bot.cover_art ? '' : `<div>${initial}</div>`;
	const iconContent = bot.icon_art ? '' : `<div style="font-size: 24px;">${initial}</div>`;

	const detailsHeader = advancedMode
		? `<div class="detail-title-row"><button class="icon-btn bot-advanced-back-btn" type="button" title="Back to full editor" aria-label="Back to full editor"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.707 4.293a1 1 0 010 1.414L6.414 9H17a1 1 0 110 2H6.414l3.293 3.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></button><h3>Bot Details</h3></div>`
		: `<div class="detail-title-row"><h3>Bot Details</h3><button class="icon-btn bot-advanced-settings-btn" type="button" title="Advanced settings" aria-label="Advanced settings"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg></button></div>`;

	const detailsSection = `
			<div class="bot-editor-section">
				${detailsHeader}
				<div class="form-group">
					<label>Name</label>
					<input type="text" id="bot-name" class="text-input" value="${bot.name || ''}">
				</div>
				<div class="form-group">
					<label>Description</label>
					<textarea id="bot-description" class="text-input" rows="3">${bot.description || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Definition (core.txt)</label>
					<textarea id="bot-core" class="text-input" rows="4">${bot.core_data || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Rules (scenario.txt)</label>
					<textarea id="bot-scenario" class="text-input" rows="4">${bot.scenario_data || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Initial Messages (IAM)</label>
					<div class="iam-set-nav" style="margin-bottom:0.5rem;">
						<button type="button" class="action-btn cancel-btn" id="bot-iam-prev-btn">&lt;</button>
						<span class="iam-set-label" id="bot-iam-set-label">${bot.active_iam_set || DEFAULT_IAM_SET}</span>
						<button type="button" class="action-btn cancel-btn" id="bot-iam-next-btn">&gt;</button>
						<button type="button" class="action-btn" id="bot-iam-new-set-btn">Create New</button>
						<button type="button" class="action-btn delete-btn" id="bot-iam-delete-set-btn">Delete IAM</button>
					</div>
					<div id="bot-iam-list" class="iam-list"></div>
					<div style="margin-top:1rem;display:flex;gap:0.5rem;">
						<button type="button" class="action-btn" id="bot-add-iam-btn">Add Message</button>
					</div>
				</div>
				${advancedMode ? `<div class="form-group"><label>Prompt Order</label><div class="prompt-order-list" id="prompt-order-list"></div></div>` : ''}
			</div>`;

	const mediaSections = `
			<div class="bot-editor-section">
				<div class="bot-preview-with-controls">
					<div class="bot-preview-container">
						<h3>Cover Art</h3>
						<div class="detail-cover" id="cover-preview" style="${coverStyle}">${coverContent}</div>
						<input type="hidden" id="cover-art-value" value="${bot.cover_art || ''}">
					</div>
					<div class="bot-controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item">
								<label>Zoom (%)</label>
								<input type="range" id="cover-zoom" min="50" max="300" value="${(bot.cover_art_fit?.size || 100)}" class="slider">
								<span id="cover-zoom-val">${(bot.cover_art_fit?.size || 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="cover-posX" min="0" max="100" value="${(bot.cover_art_fit?.x || 50)}" class="slider">
								<span id="cover-posX-val">${(bot.cover_art_fit?.x || 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="cover-posY" min="0" max="100" value="${(bot.cover_art_fit?.y || 50)}" class="slider">
								<span id="cover-posY-val">${(bot.cover_art_fit?.y || 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
			
			<div class="bot-editor-section">
				<h3>Images</h3>
				<div class="form-group">
					<input type="file" id="bot-image-upload" multiple accept="image/*" style="display:none;">
					<button type="button" class="action-btn" onclick="document.getElementById('bot-image-upload').click()">Upload Images</button>
				</div>
				<div id="bot-image-gallery" class="image-gallery"></div>
			</div>
			
			<div class="bot-editor-section">
				<div class="bot-preview-with-controls">
					<div class="bot-preview-container">
						<h3>Icon</h3>
						<div class="detail-icon" id="icon-preview" style="${iconStyle}">${iconContent}</div>
						<input type="hidden" id="icon-art-value" value="${bot.icon_art || ''}">
					</div>
					<div class="bot-controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item">
								<label>Zoom (%)</label>
								<input type="range" id="icon-zoom" min="50" max="300" value="${(bot.icon_fit?.size || 100)}" class="slider">
								<span id="icon-zoom-val">${(bot.icon_fit?.size || 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="icon-posX" min="0" max="100" value="${(bot.icon_fit?.x || 50)}" class="slider">
								<span id="icon-posX-val">${(bot.icon_fit?.x || 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="icon-posY" min="0" max="100" value="${(bot.icon_fit?.y || 50)}" class="slider">
								<span id="icon-posY-val">${(bot.icon_fit?.y || 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

	editor.innerHTML = `
		<div class="bot-editor-grid masonry-grid${advancedMode ? ' bot-editor-grid-advanced' : ''}">
			${detailsSection}
			${advancedMode ? '' : mediaSections}
		</div>
		<div class="bot-editor-footer">
			<button type="button" class="action-btn cancel-btn" onclick="${advancedMode ? "showBotEditor(currentBotInfo)" : "renderBotDetailView(currentBotInfo)"}">Cancel</button>
			<button type="button" class="action-btn delete-btn" onclick="deleteBot('${bot.name}')">Delete</button>
			<button type="button" class="action-btn save-btn" onclick="saveBotEdits('${bot.name}')">Save</button>
		</div>
	`;
	messagesContainer.appendChild(editor);
	makeSectionsCollapsible(editor, '.bot-editor-section', `bot-edit:${bot.name}:${advancedMode ? 'advanced' : 'standard'}`);
	scheduleMasonryRefresh(editor);

	// Load IAM set state
	loadBotIam(bot.name, bot.active_iam_set || DEFAULT_IAM_SET);
	
	if (!advancedMode) {
		// Load images
		loadBotImages(bot);

		// Bind image adjustments
		bindBotImageAdjustments(bot);

		// Bind image upload
		const imageUpload = document.getElementById('bot-image-upload');
		if (imageUpload) {
			imageUpload.addEventListener('change', (e) => {
				uploadBotImages(bot.name, e.target.files);
			});
		}
	}
	
	// Bind IAM buttons
	const addIamBtn = document.getElementById('bot-add-iam-btn');
	if (addIamBtn) {
		addIamBtn.addEventListener('click', () => addBotIamEntry());
	}

	const iamPrevBtn = document.getElementById('bot-iam-prev-btn');
	const iamNextBtn = document.getElementById('bot-iam-next-btn');
	const iamNewSetBtn = document.getElementById('bot-iam-new-set-btn');
	const iamDeleteSetBtn = document.getElementById('bot-iam-delete-set-btn');
	const switchBotIamSet = (direction) => {
		if (!botEditorIamState.setNames.length) {
			return;
		}
		captureBotIamDomToState();
		const currentIndex = Math.max(0, botEditorIamState.setNames.indexOf(botEditorIamState.currentSet));
		const nextIndex = (currentIndex + direction + botEditorIamState.setNames.length) % botEditorIamState.setNames.length;
		botEditorIamState.currentSet = botEditorIamState.setNames[nextIndex];
		renderBotIamList(botEditorIamState.itemsBySet?.[botEditorIamState.currentSet] || []);
		setBotIamSetLabel();
	};
	if (iamPrevBtn) {
		iamPrevBtn.addEventListener('click', () => switchBotIamSet(-1));
	}
	if (iamNextBtn) {
		iamNextBtn.addEventListener('click', () => switchBotIamSet(1));
	}
	if (iamNewSetBtn) {
		iamNewSetBtn.addEventListener('click', () => {
			captureBotIamDomToState();
			fetch('/api/bot/iam', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'create_set', bot_name: bot.name })
			})
				.then(r => r.json())
				.then(result => {
					if (!result || !result.success || !result.iam_set) {
						alert('Failed to create IAM set');
						return;
					}
					if (!botEditorIamState.itemsBySet) {
						botEditorIamState.itemsBySet = {};
					}
					botEditorIamState.itemsBySet[result.iam_set] = [];
					botEditorIamState.setNames = getSortedIamSetNames([...botEditorIamState.setNames, result.iam_set]);
					botEditorIamState.currentSet = result.iam_set;
					renderBotIamList([]);
					setBotIamSetLabel();
				});
		});
	}
	if (iamDeleteSetBtn) {
		iamDeleteSetBtn.addEventListener('click', () => {
			if ((botEditorIamState.currentSet || DEFAULT_IAM_SET) === DEFAULT_IAM_SET) {
				alert('IAM_1 cannot be deleted.');
				return;
			}
			if (!confirm(`Delete ${botEditorIamState.currentSet}?`)) {
				return;
			}
			fetch('/api/bot/iam', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'delete_set', bot_name: bot.name, iam_set: botEditorIamState.currentSet })
			})
				.then(r => r.json())
				.then(result => {
					if (!result || !result.success) {
						alert('Failed to delete IAM set');
						return;
					}
					delete botEditorIamState.itemsBySet[botEditorIamState.currentSet];
					botEditorIamState.setNames = getSortedIamSetNames(botEditorIamState.setNames.filter(name => name !== botEditorIamState.currentSet));
					botEditorIamState.currentSet = botEditorIamState.setNames.includes(DEFAULT_IAM_SET) ? DEFAULT_IAM_SET : (botEditorIamState.setNames[0] || DEFAULT_IAM_SET);
					renderBotIamList(botEditorIamState.itemsBySet?.[botEditorIamState.currentSet] || []);
					setBotIamSetLabel();
				});
		});
	}

	const advancedBtn = document.querySelector('.bot-advanced-settings-btn');
	if (advancedBtn) {
		advancedBtn.addEventListener('click', () => showBotAdvancedEditor(bot));
	}

	const backBtn = document.querySelector('.bot-advanced-back-btn');
	if (backBtn) {
		backBtn.addEventListener('click', () => showBotEditor(bot));
	}

	if (advancedMode) {
		initPromptOrderEditor(bot.prompt_order);
	}
}

function saveBotEdits(originalName) {
	const isAdvancedMode = !!document.querySelector('.bot-editor.bot-editor-advanced');
	const nameInput = document.getElementById('bot-name');
	const descInput = document.getElementById('bot-description');
	const coreInput = document.getElementById('bot-core');
	const scenarioInput = document.getElementById('bot-scenario');
	const coverFit = readBotFitInputs('cover');
	const iconFit = readBotFitInputs('icon');
	if (!nameInput || !descInput || !coreInput || !scenarioInput) {
		return;
	}
	const nextName = nameInput.value.trim() || originalName;
	const payload = {
		action: 'update',
		bot_name: originalName,
		new_name: nextName,
		description: descInput.value,
		core_data: coreInput.value,
		scenario_data: scenarioInput.value,
		active_iam_set: botEditorIamState.currentSet || DEFAULT_IAM_SET
	};
	if (coverFit) {
		payload.cover_art_fit = coverFit;
	}
	if (iconFit) {
		payload.icon_fit = iconFit;
	}
	const promptOrderContainer = document.getElementById('prompt-order-list');
	if (promptOrderContainer) {
		payload.prompt_order = normalizePromptOrder(
			Array.from(promptOrderContainer.querySelectorAll('.prompt-order-item')).map(item => item.dataset.sectionKey)
		);
	}
	saveBotIamList(originalName)
		.then(() => fetch('/api/bots', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		}))
		.then(r => r.json())
		.then(result => {
			if (result && result.success && result.bot) {
				currentBotInfo = result.bot;
				currentBotName = result.bot.name;
				updateBotPanel();
				if (isAdvancedMode) {
					showBotAdvancedEditor(result.bot);
				} else {
					showBotEditor(result.bot);
				}
				if (typeof showToast === 'function') {
					showToast('Bot saved.', 'success');
				}
			} else {
				alert((result && result.message) || 'Failed to update bot');
			}
		});
}

function deleteBot(botName) {
	if (!botName) {
		return;
	}
	const confirmed = confirm(`Delete bot "${botName}" and all its chats permanently?`);
	if (!confirmed) {
		return;
	}

	const typedName = prompt(`Type the bot name to confirm deletion: ${botName}`);
	if (typedName === null) {
		return;
	}
	if (typedName.trim() !== botName) {
		alert('Deletion cancelled: bot name did not match.');
		return;
	}

	fetch('/api/bots', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'delete', name: botName })
	})
		.then(r => r.json())
		.then(result => {
			if (!result || !result.success) {
				alert((result && result.message) || 'Failed to delete bot');
				return;
			}

			if (currentBotName === botName) {
				currentBotName = null;
			}
			if (currentBotInfo && currentBotInfo.name === botName) {
				currentBotInfo = null;
			}
			if (currentChatId) {
				currentChatId = null;
				currentChatMessages = [];
			}

			updateBotPanel();
			const botsNavItem = Array.from(navItems || []).find(item => item.dataset && item.dataset.view === 'bots');
			if (botsNavItem) {
				botsNavItem.click();
			} else {
				currentView = 'bots';
				showBots();
			}
		});
}

function readBotFitInputs(prefix) {
	const zoomInput = document.getElementById(prefix + '-zoom');
	const posXInput = document.getElementById(prefix + '-posX');
	const posYInput = document.getElementById(prefix + '-posY');
	if (!zoomInput || !posXInput || !posYInput) {
		return null;
	}
	return {
		size: parseInt(zoomInput.value),
		x: parseInt(posXInput.value),
		y: parseInt(posYInput.value)
	};
}

function bindBotImageAdjustments(bot) {
	// Cover art adjustments
	const updateCoverPreview = () => {
		const zoom = parseInt(document.getElementById('cover-zoom').value);
		const x = parseInt(document.getElementById('cover-posX').value);
		const y = parseInt(document.getElementById('cover-posY').value);
		document.getElementById('cover-zoom-val').textContent = zoom + '%';
		document.getElementById('cover-posX-val').textContent = x + '%';
		document.getElementById('cover-posY-val').textContent = y + '%';
		const fit = { size: zoom, x, y };
		document.getElementById('cover-preview').style.cssText = buildImageStyle(bot.cover_art, fit);
	};
	
	document.getElementById('cover-zoom').addEventListener('input', updateCoverPreview);
	document.getElementById('cover-posX').addEventListener('input', updateCoverPreview);
	document.getElementById('cover-posY').addEventListener('input', updateCoverPreview);
	
	// Icon adjustments
	const updateIconPreview = () => {
		const zoom = parseInt(document.getElementById('icon-zoom').value);
		const x = parseInt(document.getElementById('icon-posX').value);
		const y = parseInt(document.getElementById('icon-posY').value);
		document.getElementById('icon-zoom-val').textContent = zoom + '%';
		document.getElementById('icon-posX-val').textContent = x + '%';
		document.getElementById('icon-posY-val').textContent = y + '%';
		const fit = { size: zoom, x, y };
		document.getElementById('icon-preview').style.cssText = buildImageStyle(bot.icon_art, fit);
	};
	
	document.getElementById('icon-zoom').addEventListener('input', updateIconPreview);
	document.getElementById('icon-posX').addEventListener('input', updateIconPreview);
	document.getElementById('icon-posY').addEventListener('input', updateIconPreview);
}

function loadBotImages(bot) {
	fetch('/api/bot/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'list', bot_name: bot.name })
	})
		.then(r => r.json())
		.then(data => {
			const gallery = document.getElementById('bot-image-gallery');
			const items = (data && data.items) ? data.items : [];
			if (!items || items.length === 0) {
				gallery.innerHTML = '<p style="color: #999; grid-column: 1/-1;">No images yet</p>';
				return;
			}
			gallery.innerHTML = '';
			items.forEach(img => {
				const card = document.createElement('div');
				card.className = 'image-card';
				card.innerHTML = `
					<div class="image-thumb" style="background-image: url('${img.url}'); background-size: cover; background-position: center;"></div>
					<div class="image-actions">
						<button class="img-action-btn" onclick="setBotCoverArt('${bot.name}', '${img.name}')" title="Set as cover">🖼️</button>
						<button class="img-action-btn" onclick="setBotIcon('${bot.name}', '${img.name}')" title="Set as icon">👤</button>
						<button class="img-action-btn delete-btn" onclick="deleteBotImage('${bot.name}', '${img.name}')" title="Delete">🗑️</button>
					</div>
				`;
				gallery.appendChild(card);
			});
		});
}

function uploadBotImages(botName, files) {
	if (!files || files.length === 0) {
		return;
	}
	const uploads = Array.from(files).map(file => new Promise(resolve => {
		const reader = new FileReader();
		reader.onload = () => {
			fetch('/api/bot/images', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'upload', bot_name: botName, filename: file.name, data_url: reader.result })
			})
				.then(() => resolve());
		};
		reader.readAsDataURL(file);
	}));
	Promise.all(uploads).then(() => {
		loadBotImages({ name: botName });
	});
}

function setBotCoverArt(botName, filename) {
	fetch('/api/bot/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'set_coverart', bot_name: botName, filename: filename })
	})
		.then(r => r.json())
		.then(result => {
			if (result && result.bot) {
				currentBotInfo = result.bot;
				currentBotName = result.bot.name;
				currentBotInfo.cover_art = `/Bots/${botName}/Coverart/${filename}`;
				document.getElementById('cover-art-value').value = currentBotInfo.cover_art;
				document.getElementById('cover-preview').style.cssText = buildImageStyle(currentBotInfo.cover_art, currentBotInfo.cover_art_fit || null);
				loadBotImages(currentBotInfo);
				updateBotPanel();
			}
		});
}

function setBotIcon(botName, filename) {
	fetch('/api/bot/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'set_icon', bot_name: botName, filename: filename, source: 'Images' })
	})
		.then(r => r.json())
		.then(result => {
			if (result && result.bot) {
				currentBotInfo = result.bot;
				currentBotName = result.bot.name;
				currentBotInfo.icon_art = `/Bots/${botName}/Coverart/${filename}`;
				document.getElementById('icon-art-value').value = currentBotInfo.icon_art;
				document.getElementById('icon-preview').style.cssText = buildImageStyle(currentBotInfo.icon_art, currentBotInfo.icon_fit || null);
				loadBotImages(currentBotInfo);
				updateBotPanel();
			}
		});
}

function deleteBotImage(botName, filename) {
	fetch('/api/bot/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'delete', bot_name: botName, filename: filename })
	})
		.then(() => {
			loadBotImages({ name: botName });
		});
}

function loadBotIam(botName, preferredSet = null) {
	const container = document.getElementById('bot-iam-list');
	if (container) {
		container.dataset.botName = botName;
	}
	fetch('/api/bot/iam', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'list_all', bot_name: botName })
	})
		.then(r => r.json())
		.then(data => {
			const setsPayload = (data && Array.isArray(data.sets)) ? data.sets : [];
			const setNames = [];
			const itemsBySet = {};
			setsPayload.forEach(setData => {
				const setName = (setData && setData.name) ? setData.name : DEFAULT_IAM_SET;
				const items = (setData && Array.isArray(setData.items)) ? setData.items.map(item => item.content || '') : [];
				setNames.push(setName);
				itemsBySet[setName] = items;
			});
			const ordered = getSortedIamSetNames(setNames.length ? setNames : [DEFAULT_IAM_SET]);
			const resolvedCurrentSet = ordered.includes(preferredSet) ? preferredSet : (ordered.includes(data && data.current_set) ? data.current_set : ordered[0]);
			botEditorIamState = {
				botName,
				setNames: ordered,
				currentSet: resolvedCurrentSet,
				itemsBySet
			};
			if (!botEditorIamState.itemsBySet[botEditorIamState.currentSet]) {
				botEditorIamState.itemsBySet[botEditorIamState.currentSet] = [];
			}
			renderBotIamList(botEditorIamState.itemsBySet[botEditorIamState.currentSet] || []);
			setBotIamSetLabel();
		});
}

function setBotIamSetLabel() {
	const label = document.getElementById('bot-iam-set-label');
	if (label) {
		label.textContent = botEditorIamState.currentSet || DEFAULT_IAM_SET;
	}
}

function captureBotIamDomToState() {
	const container = document.getElementById('bot-iam-list');
	if (!container || !botEditorIamState.currentSet) {
		return;
	}
	const rows = Array.from(container.querySelectorAll('.iam-item'));
	if (!botEditorIamState.itemsBySet) {
		botEditorIamState.itemsBySet = {};
	}
	botEditorIamState.itemsBySet[botEditorIamState.currentSet] = rows
		.map(row => (row.querySelector('.iam-input') || {}).value || '')
		.map(value => value.trim())
		.filter(Boolean);
}

function renderBotIamList(items) {
	const container = document.getElementById('bot-iam-list');
	if (!container) {
		return;
	}
	container.innerHTML = '';
	items.forEach(item => {
		const row = document.createElement('div');
		row.className = 'iam-item';
		const content = (item && typeof item === 'object') ? (item.content || '') : (item || '');
		row.innerHTML = `<textarea class="setting-input iam-input" rows="2">${content}</textarea><button class="btn btn-secondary iam-delete" type="button">Delete</button>`;
		const delBtn = row.querySelector('.iam-delete');
		if (delBtn) {
			delBtn.addEventListener('click', () => row.remove());
		}
		container.appendChild(row);
	});
}

function addBotIamEntry() {
	const container = document.getElementById('bot-iam-list');
	if (!container) {
		return;
	}
	const row = document.createElement('div');
	row.className = 'iam-item';
	row.innerHTML = `<textarea class="setting-input iam-input" rows="2"></textarea><button class="btn btn-secondary iam-delete" type="button">Delete</button>`;
	const delBtn = row.querySelector('.iam-delete');
	if (delBtn) {
		delBtn.addEventListener('click', () => row.remove());
	}
	container.appendChild(row);
}

function saveBotIamList(botName) {
	captureBotIamDomToState();
	const currentSet = botEditorIamState.currentSet || DEFAULT_IAM_SET;
	const currentItems = (botEditorIamState.itemsBySet && botEditorIamState.itemsBySet[currentSet]) ? botEditorIamState.itemsBySet[currentSet] : [];
	return fetch('/api/bot/iam', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'replace', bot_name: botName, iam_set: currentSet, items: currentItems })
	})
		.then(r => r.json())
		.then(result => {
			if (!result || !result.success) {
				throw new Error('Failed to save IAM set');
			}
		});
}

function startNewChat(botName) {
	const title = prompt('Chat title (optional):') || 'Chat with ' + botName;
	// Fetch bot info first
	fetch('/api/bot/select', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ bot_name: botName })
	})
		.then(r => r.json())
		.then(botData => {
			if (botData.success) {
				currentBotInfo = botData.bot;
			}
			return fetch('/api/bot/iam', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'list_sets', bot_name: botName })
			})
				.then(r => r.json())
				.then(iamData => {
					const defaultIamSet = (typeof DEFAULT_IAM_SET !== 'undefined' && DEFAULT_IAM_SET) ? DEFAULT_IAM_SET : 'IAM_1';
					const setNames = (typeof getSortedIamSetNames === 'function')
						? getSortedIamSetNames((iamData && iamData.sets) ? iamData.sets : [defaultIamSet])
						: ((iamData && iamData.sets) || [defaultIamSet]);
					const selectedIamSet = setNames && setNames.length ? setNames[0] : defaultIamSet;
					chatBotIamSelections[botName] = selectedIamSet;

					// Then create the chat
					return fetch('/api/chats', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'create', bot_name: botName, title: title, persona_name: (currentPersonaInfo && currentPersonaInfo.name) ? currentPersonaInfo.name : 'User', iam_set: selectedIamSet })
					});
				});
		})
		.then(r => r.json())
		.then(chat => {
			currentChatId = chat.id;
			currentBotName = botName;
			// Load the chat so IAM messages show immediately
			return fetch('/api/load-chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chat_id: chat.id, bot_name: botName })
			});
		})
		.then(r => r.json())
		.then(data => {
			currentChatMessages = (data && data.messages) ? data.messages : [];
			renderCurrentChat();
			switchToLastChat();
			updateBotPanel();
		});
}

function continuePreviousChat(botName) {
	// Fetch bot info first
	fetch('/api/bot/select', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ bot_name: botName })
	})
		.then(r => r.json())
		.then(botData => {
			if (botData.success) {
				currentBotInfo = botData.bot;
			}
			// Then load last chat
			return fetch('/api/last-chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bot_name: botName })
			});
		})
		.then(r => r.json())
		.then(data => {
			if (data && data.chat_info) {
				currentChatId = data.chat_info.id;
				currentBotName = data.chat_info.bot || botName;
				currentChatMessages = data.messages || [];
				switchToLastChat();
				updateBotPanel();
			} else {
				alert('No previous chat found for this bot');
				startNewChat(botName);
			}
		});
}

function createBot() {
	createBotFromDraft();
}
