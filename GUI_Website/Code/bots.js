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
	const form = document.createElement('div');
	form.style.cssText = 'padding:24px;max-width:500px;';
	form.innerHTML = '<input type="text" class="setting-input" id="botName" placeholder="Bot name" style="margin-bottom:12px;"><textarea class="setting-input" id="botCore" placeholder="Core instructions" style="min-height:200px;margin-bottom:12px;font-family:monospace;"></textarea><button class="btn btn-primary" onclick="createBot()" style="width:100%;">Create Bot</button>';
	messagesContainer.appendChild(form);
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
	detail.innerHTML = `<div class="detail-cover" style="${coverStyle}">${coverContent}</div><div class="detail-info"><div class="detail-title-row"><h2>${bot.name}</h2><button class="icon-btn bot-edit-btn" type="button" title="Edit bot" aria-label="Edit bot"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-1 1-3.828-3.828 1-1a2 2 0 012.828 0zM2 13.586l9.586-9.586 3.828 3.828L5.828 17.414H2v-3.828z"/></svg></button></div><p>${bot.description || 'No description provided.'}</p><div class="detail-actions"><button class="btn btn-primary" onclick="startNewChat('${bot.name}')">Start New Chat</button><button class="btn btn-secondary" onclick="continuePreviousChat('${bot.name}')">Continue Last Chat</button></div></div>`;
	messagesContainer.appendChild(detail);
	const editBtn = detail.querySelector('.bot-edit-btn');
	if (editBtn) {
		editBtn.addEventListener('click', () => {
			showBotEditor(bot);
		});
	}
}

function showBotEditor(bot) {
	chatHeader.innerHTML = `<div><div class="chat-title">Edit ${bot.name}</div><div class="chat-subtitle">Bot Editor</div></div>`;
	messagesContainer.innerHTML = '';
	const editor = document.createElement('div');
	editor.className = 'bot-editor';
	
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
	
	editor.innerHTML = `
		<div class="bot-editor-grid">
			<div class="bot-editor-section">
				<h3>Bot Details</h3>
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
					<label>Initial Messages (IAM)</label>
					<div id="bot-iam-list" class="iam-list"></div>
					<div style="margin-top:1rem;display:flex;gap:0.5rem;">
						<button type="button" class="action-btn" id="bot-add-iam-btn">Add Message</button>
						<button type="button" class="action-btn save-btn" id="bot-save-iam-btn">Save Messages</button>
					</div>
				</div>
			</div>
			
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
		</div>
		<div class="bot-editor-footer">
			<button type="button" class="action-btn cancel-btn" onclick="renderBotDetailView(currentBotInfo)">Cancel</button>
			<button type="button" class="action-btn save-btn" onclick="saveBotEdits('${bot.name}')">Save</button>
		</div>
	`;
	messagesContainer.appendChild(editor);

	// Load IAM
	loadBotIam(bot.name);
	
	// Load images
	loadBotImages(bot);
	
	// Bind image adjustments
	bindBotImageAdjustments(bot);
	
	// Bind image upload
	document.getElementById('bot-image-upload').addEventListener('change', (e) => {
		uploadBotImages(bot.name, e.target.files);
	});
	
	// Bind IAM buttons
	const addIamBtn = document.getElementById('bot-add-iam-btn');
	const saveIamBtn = document.getElementById('bot-save-iam-btn');
	if (addIamBtn) {
		addIamBtn.addEventListener('click', () => addBotIamEntry());
	}
	if (saveIamBtn) {
		saveIamBtn.addEventListener('click', () => saveBotIamList(bot.name));
	}
}

function saveBotEdits(originalName) {
	const nameInput = document.getElementById('bot-name');
	const descInput = document.getElementById('bot-description');
	const coreInput = document.getElementById('bot-core');
	const coverFit = readBotFitInputs('cover');
	const iconFit = readBotFitInputs('icon');
	if (!nameInput || !descInput || !coreInput) {
		return;
	}
	const nextName = nameInput.value.trim() || originalName;
	const payload = {
		action: 'update',
		bot_name: originalName,
		new_name: nextName,
		description: descInput.value,
		cover_art_fit: coverFit,
		icon_fit: iconFit,
		core_data: coreInput.value
	};
	fetch('/api/bots', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	})
		.then(r => r.json())
		.then(result => {
			if (result && result.success && result.bot) {
				currentBotInfo = result.bot;
				currentBotName = result.bot.name;
				updateBotPanel();
				renderBotDetailView(result.bot);
			} else {
				alert((result && result.message) || 'Failed to update bot');
			}
		});
}

function readBotFitInputs(prefix) {
	return {
		size: parseInt(document.getElementById(prefix + '-zoom').value),
		x: parseInt(document.getElementById(prefix + '-posX').value),
		y: parseInt(document.getElementById(prefix + '-posY').value)
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

function loadBotIam(botName) {
	const container = document.getElementById('bot-iam-list');
	if (container) {
		container.dataset.botName = botName;
	}
	fetch('/api/bot/iam', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'list', bot_name: botName })
	})
		.then(r => r.json())
		.then(data => {
			renderBotIamList((data && data.items) ? data.items : []);
		});
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
		row.dataset.iamId = item.id;
		row.innerHTML = `<textarea class="setting-input iam-input" rows="2">${item.content || ''}</textarea><button class="btn btn-secondary iam-delete" type="button">Delete</button>`;
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
	row.dataset.iamId = '';
	row.innerHTML = `<textarea class="setting-input iam-input" rows="2"></textarea><button class="btn btn-secondary iam-delete" type="button">Delete</button>`;
	const delBtn = row.querySelector('.iam-delete');
	if (delBtn) {
		delBtn.addEventListener('click', () => row.remove());
	}
	container.appendChild(row);
}

function saveBotIamList(botName) {
	const container = document.getElementById('bot-iam-list');
	const items = container ? container.querySelectorAll('.iam-item') : [];
	const actions = [];
	items.forEach(item => {
		const content = (item.querySelector('.iam-input') || {}).value || '';
		const iamId = item.dataset.iamId;
		if (iamId) {
			actions.push(fetch('/api/bot/iam', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'update', bot_name: botName, iam_id: iamId, content: content })
			}));
		} else if (content.trim()) {
			actions.push(fetch('/api/bot/iam', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'add', bot_name: botName, content: content })
			})
				.then(r => r.json())
				.then(result => {
					if (result && result.item && result.item.id) {
						item.dataset.iamId = result.item.id;
					}
				}));
		}
	});
	Promise.all(actions).then(() => {
		loadBotIam(botName);
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
			// Then create the chat
			return fetch('/api/chats', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'create', bot_name: botName, title: title })
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
	const name = document.getElementById('botName').value;
	const core = document.getElementById('botCore').value;
	if (!name) {
		return alert('Bot name required');
	}
	fetch('/api/bots', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'create', name: name, core_data: core })
	})
		.then(r => r.json())
		.then(bot => {
			alert('Bot created: ' + bot.name);
			navItems[1].click();
		});
}
