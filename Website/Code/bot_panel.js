function parseBotPanelStopStrings(rawValue) {
	if (typeof parseStopStringsInput === 'function') {
		return parseStopStringsInput(rawValue);
	}
	if (!rawValue) {
		return [];
	}
	return `${rawValue}`
		.split(/\r?\n|,/)
		.map(value => value.trim())
		.filter(Boolean);
}

const BOT_PANEL_COVER_FALLBACK_STYLE = 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);';
const BOT_PANEL_IMAGE_STATUS = {
	loading: 'Loading images...',
	empty: 'No images found.',
	error: 'Failed to load images.',
	noSelection: 'No bot selected.'
};

const botPanelImageCache = window.__botPanelImageCache || (window.__botPanelImageCache = {});
let botPanelExpanded = false;

function getBotPanelImagesGrid() {
	return document.getElementById('botPanelImagesGrid');
}

function scheduleBotPanelImagesViewportAdjust(grid = null) {
	const target = grid || getBotPanelImagesGrid();
	if (!target) {
		return;
	}
	requestAnimationFrame(() => adjustBotPanelImagesViewport(target));
	setTimeout(() => adjustBotPanelImagesViewport(target), 60);
	setTimeout(() => adjustBotPanelImagesViewport(target), 240);
}

function bindBotPanelImagesLoadAdjust(grid) {
	if (!grid) {
		return;
	}
	const thumbs = Array.from(grid.querySelectorAll('.bot-panel-image-thumb'));
	thumbs.forEach(img => {
		if (!img || img.dataset.viewportBound === '1') {
			return;
		}
		img.dataset.viewportBound = '1';
		img.addEventListener('load', () => scheduleBotPanelImagesViewportAdjust(grid), { passive: true });
		img.addEventListener('error', () => scheduleBotPanelImagesViewportAdjust(grid), { passive: true });
	});
}

if (!window.__botPanelImagesViewportResizeBound) {
	window.__botPanelImagesViewportResizeBound = true;
	window.addEventListener('resize', () => {
		scheduleBotPanelImagesViewportAdjust();
	});
}

function applyBotPanelExpandedState(nextExpanded) {
	const panel = document.getElementById('botPanel');
	const appRoot = document.querySelector('.app');
	const toggle = document.getElementById('bot-panel-expand-toggle');
	const expanded = !!nextExpanded;

	if (!panel || !panel.classList.contains('visible')) {
		botPanelExpanded = false;
		if (panel) {
			panel.classList.remove('expanded');
		}
		if (appRoot) {
			appRoot.classList.remove('bot-panel-overlay-active');
		}
		if (toggle) {
			toggle.textContent = '<';
			toggle.setAttribute('aria-label', 'Expand bot panel');
			toggle.title = 'Expand bot panel';
		}
		return;
	}

	botPanelExpanded = expanded;
	panel.classList.toggle('expanded', expanded);
	if (appRoot) {
		appRoot.classList.toggle('bot-panel-overlay-active', expanded);
	}
	if (toggle) {
		toggle.textContent = expanded ? '>' : '<';
		toggle.setAttribute('aria-label', expanded ? 'Collapse bot panel' : 'Expand bot panel');
		toggle.title = expanded ? 'Collapse bot panel' : 'Expand bot panel';
	}
	scheduleBotPanelImagesViewportAdjust();
}

function ensureBotPanelExpandToggle() {
	const panel = document.getElementById('botPanel');
	if (!panel) {
		return;
	}
	let toggle = document.getElementById('bot-panel-expand-toggle');
	if (!toggle) {
		toggle = document.createElement('button');
		toggle.id = 'bot-panel-expand-toggle';
		toggle.type = 'button';
		toggle.className = 'bot-panel-expand-toggle';
		toggle.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			applyBotPanelExpandedState(!botPanelExpanded);
		});
		panel.appendChild(toggle);
	}
	applyBotPanelExpandedState(botPanelExpanded);
}

window.ensureBotPanelExpandToggle = ensureBotPanelExpandToggle;
window.setBotPanelExpanded = function setBotPanelExpanded(nextExpanded) {
	applyBotPanelExpandedState(!!nextExpanded);
};

function resolveActiveBotNameForPanel() {
	const fromInfo = (currentBotInfo && currentBotInfo.name) ? `${currentBotInfo.name}`.trim() : '';
	if (fromInfo) {
		return fromInfo;
	}
	const fromName = currentBotName ? `${currentBotName}`.trim() : '';
	if (fromName) {
		return fromName;
	}
	const panelNameNode = document.querySelector('#botPanelInner .bot-panel-name');
	return panelNameNode ? (panelNameNode.textContent || '').trim() : '';
}

function buildBotPanelImagesMarkup(images) {
	if (!Array.isArray(images) || !images.length) {
		return `<div class="bot-panel-images-empty">${BOT_PANEL_IMAGE_STATUS.empty}</div>`;
	}
	return images.map((image, index) => {
		const imageUrl = image && image.url ? image.url : '';
		const imageName = image && image.name ? image.name : `Image ${index + 1}`;
		if (!imageUrl) {
			return '';
		}
		return `<button class="bot-panel-image-btn" type="button" title="${escapeHtml(imageName)}" aria-label="${escapeHtml(imageName)}"><img class="bot-panel-image-thumb image-thumb" src="${imageUrl}" alt="${escapeHtml(imageName)}"></button>`;
	}).join('');
}

function setBotPanelImagesStatus(grid, statusText) {
	if (!grid) {
		return;
	}
	grid.innerHTML = `<div class="bot-panel-images-empty">${statusText}</div>`;
}

function getBotPanelGenerationInputElements() {
	return {
		tempInput: document.getElementById('bot-temp'),
		tokensInput: document.getElementById('bot-tokens'),
		maxResponseLengthInput: document.getElementById('bot-max-response-length'),
		stopStringsInput: document.getElementById('bot-stop-strings'),
		topKInput: document.getElementById('bot-top-k'),
		enableRepeatPenaltyInput: document.getElementById('bot-enable-repeat-penalty'),
		repeatPenaltyInput: document.getElementById('bot-repeat-penalty'),
		enableTopPMaxInput: document.getElementById('bot-enable-top-p-max'),
		topPMaxInput: document.getElementById('bot-top-p-max'),
		enableTopPMinInput: document.getElementById('bot-enable-top-p-min'),
		topPMinInput: document.getElementById('bot-top-p-min')
	};
}

function bindNumericDraftInput(input, key, parser) {
	if (!input) {
		return;
	}
	input.addEventListener('input', () => {
		settingsDraft[key] = parser(input.value);
	});
}

function buildBotPanelGenerationPayload(inputs) {
	return {
		temperature: parseFloat(inputs.tempInput.value),
		max_tokens: parseInt(inputs.tokensInput.value, 10),
		max_response_length: parseInt(inputs.maxResponseLengthInput.value, 10),
		stop_strings: parseBotPanelStopStrings(inputs.stopStringsInput.value),
		top_k: parseInt(inputs.topKInput.value, 10),
		enable_repeat_penalty: inputs.enableRepeatPenaltyInput.checked,
		repeat_penalty: parseFloat(inputs.repeatPenaltyInput.value),
		enable_top_p_max: inputs.enableTopPMaxInput.checked,
		top_p_max: parseFloat(inputs.topPMaxInput.value),
		enable_top_p_min: inputs.enableTopPMinInput.checked,
		top_p_min: parseFloat(inputs.topPMinInput.value)
	};
}

function adjustBotPanelImagesViewport(grid) {
	if (!grid) {
		return;
	}
	const firstCard = grid.querySelector('.bot-panel-image-btn');
	if (!firstCard) {
		grid.style.maxHeight = '';
		return;
	}
	const cardHeight = firstCard.getBoundingClientRect().height;
	if (!Number.isFinite(cardHeight) || cardHeight <= 0) {
		return;
	}
	const style = window.getComputedStyle(grid);
	const rowGap = parseFloat(style.rowGap || style.gap || '0') || 0;
	const rowsVisible = 2;
	const targetHeight = (cardHeight * rowsVisible) + (rowGap * (rowsVisible - 1));
	const bufferedHeight = targetHeight * 1.03;
	grid.style.maxHeight = `${Math.ceil(bufferedHeight)}px`;
}

function renderBotPanelImagesFromCache(grid, botName = '') {
	if (!grid) {
		return false;
	}
	const cacheKey = `${botName || (grid.dataset ? (grid.dataset.botName || '') : '') || resolveActiveBotNameForPanel()}`.trim();
	if (cacheKey && Array.isArray(botPanelImageCache[cacheKey]) && botPanelImageCache[cacheKey].length) {
		if (grid.dataset) {
			grid.dataset.botName = cacheKey;
			grid.dataset.cachedImages = JSON.stringify(botPanelImageCache[cacheKey]);
		}
		grid.innerHTML = buildBotPanelImagesMarkup(botPanelImageCache[cacheKey]);
		bindBotPanelImagesLoadAdjust(grid);
		scheduleBotPanelImagesViewportAdjust(grid);
		return true;
	}
	const cachedRaw = grid.dataset ? grid.dataset.cachedImages : '';
	if (!cachedRaw) {
		return false;
	}
	try {
		const cachedItems = JSON.parse(cachedRaw);
		if (!Array.isArray(cachedItems) || !cachedItems.length) {
			return false;
		}
		grid.innerHTML = buildBotPanelImagesMarkup(cachedItems);
		bindBotPanelImagesLoadAdjust(grid);
		scheduleBotPanelImagesViewportAdjust(grid);
		return true;
	} catch (_error) {
		return false;
	}
}

function renderBotPanelImages(botName, grid) {
	const resolvedBotName = `${botName || ''}`.trim();
	if (!resolvedBotName || !grid) {
		return;
	}
	if (grid.dataset) {
		grid.dataset.botName = resolvedBotName;
		grid.dataset.requestId = `${Date.now()}-${Math.random()}`;
	}
	const requestId = grid.dataset ? grid.dataset.requestId : '';

	setBotPanelImagesStatus(grid, BOT_PANEL_IMAGE_STATUS.loading);

	fetch('/api/bot/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'list', bot_name: resolvedBotName })
	})
		.then(response => response.json())
		.then(data => {
			if (!grid.isConnected) {
				return;
			}
			if (grid.dataset && requestId && grid.dataset.requestId !== requestId) {
				return;
			}
			if (grid.dataset && grid.dataset.botName && grid.dataset.botName !== resolvedBotName) {
				return;
			}

			const images = Array.isArray(data?.items)
				? data.items
				: (Array.isArray(data?.images) ? data.images : []);
			if (!images.length) {
				botPanelImageCache[resolvedBotName] = [];
				if (grid.dataset) {
					grid.dataset.cachedImages = '[]';
				}
				setBotPanelImagesStatus(grid, BOT_PANEL_IMAGE_STATUS.empty);
				grid.style.maxHeight = '';
				return;
			}
			botPanelImageCache[resolvedBotName] = images;
			if (grid.dataset) {
				grid.dataset.cachedImages = JSON.stringify(images);
			}
			grid.innerHTML = buildBotPanelImagesMarkup(images);
			bindBotPanelImagesLoadAdjust(grid);
			scheduleBotPanelImagesViewportAdjust(grid);
		})
		.catch(() => {
			if (!grid.isConnected) {
				return;
			}
			if (renderBotPanelImagesFromCache(grid, resolvedBotName)) {
				return;
			}
			setBotPanelImagesStatus(grid, BOT_PANEL_IMAGE_STATUS.error);
			grid.style.maxHeight = '';
		});
}

function updateBotPanel() {
	const panel = document.getElementById('botPanel');
	const inner = document.getElementById('botPanelInner');
	if (!panel || !inner) {
		return;
	}

	ensureBotPanelExpandToggle();

	const botName = (currentBotInfo && currentBotInfo.name) ? currentBotInfo.name : (currentBotName || 'No bot selected');
	const coverArt = currentBotInfo && currentBotInfo.cover_art ? currentBotInfo.cover_art : '';
	const coverFit = currentBotInfo && currentBotInfo.cover_art_fit ? currentBotInfo.cover_art_fit : null;
	const initial = botName ? botName[0].toUpperCase() : 'B';
	const coverStyle = coverArt
		? buildImageStyle(coverArt, coverFit)
		: BOT_PANEL_COVER_FALLBACK_STYLE;
	const coverContent = coverArt ? '' : `<div>${initial}</div>`;
	const datasetName = (currentBotInfo && currentBotInfo.active_dataset_name)
		? `${currentBotInfo.active_dataset_name}`
		: 'None';
	const datasetLabel = escapeHtml(datasetName);

	const tempValue = Number.isFinite(settingsDraft.temperature) ? settingsDraft.temperature : (lastSavedSettings.temperature ?? 0.7);
	const tokensValue = Number.isFinite(settingsDraft.max_tokens) ? settingsDraft.max_tokens : (lastSavedSettings.max_tokens ?? 10000);
	const maxResponseLengthValue = Number.isFinite(settingsDraft.max_response_length) ? settingsDraft.max_response_length : (lastSavedSettings.max_response_length ?? 300);
	const stopStringsSource = Array.isArray(settingsDraft.stop_strings)
		? settingsDraft.stop_strings
		: (Array.isArray(lastSavedSettings.stop_strings) ? lastSavedSettings.stop_strings : ['User', 'User:']);
	const stopStringsValue = stopStringsSource.join('\n');
	const topKValue = Number.isFinite(settingsDraft.top_k) ? settingsDraft.top_k : (lastSavedSettings.top_k ?? 40);
	const repeatPenaltyEnabled = settingsDraft.enable_repeat_penalty ?? lastSavedSettings.enable_repeat_penalty ?? true;
	const repeatPenaltyValue = Number.isFinite(settingsDraft.repeat_penalty) ? settingsDraft.repeat_penalty : (lastSavedSettings.repeat_penalty ?? 1.0);
	const topPMaxEnabled = settingsDraft.enable_top_p_max ?? lastSavedSettings.enable_top_p_max ?? true;
	const topPMaxValue = Number.isFinite(settingsDraft.top_p_max) ? settingsDraft.top_p_max : (lastSavedSettings.top_p_max ?? 0.95);
	const topPMinEnabled = settingsDraft.enable_top_p_min ?? lastSavedSettings.enable_top_p_min ?? true;
	const topPMinValue = Number.isFinite(settingsDraft.top_p_min) ? settingsDraft.top_p_min : (lastSavedSettings.top_p_min ?? 0.05);
	const chatGenerationStorageKey = makeCollapsibleStorageKey('chat-generation-panel', 'Generation', 0);
	if (!readCollapsedState(chatGenerationStorageKey)) {
		writeCollapsedState(chatGenerationStorageKey, true);
	}
	const chatImagesStorageKey = makeCollapsibleStorageKey('chat-generation-panel', 'Images', 0);

	inner.innerHTML = `<div class="bot-panel-cover" style="${coverStyle}">${coverContent}</div><div class="bot-panel-name-row"><div class="bot-panel-name">${botName}</div><button class="icon-btn bot-panel-edit-btn" type="button" title="Edit bot" aria-label="Edit bot"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-1 1-3.828-3.828 1-1a2 2 0 012.828 0zM2 13.586l9.586-9.586 3.828 3.828L5.828 17.414H2v-3.828z"/></svg></button></div><div class="bot-panel-dataset"><span class="bot-panel-dataset-icon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 011-1h4l1 1h7a1 1 0 011 1v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4zm2 2v8h10V6H5z"/></svg></span><span class="bot-panel-dataset-name">${datasetLabel}</span></div><div class="bot-panel-group"><h3>Generation</h3><div class="setting-item"><label class="setting-label setting-label-row" title="Controls randomness. Lower values are more focused; higher values are more creative.">Temperature <span class="setting-tooltip" title="Controls randomness. Lower values are more focused; higher values are more creative.">ⓘ</span><span class="setting-value" id="bot-temp-value">${Number(tempValue).toFixed(2)}</span></label><input type="range" class="setting-input" min="0.1" max="2.0" step="0.01" value="${tempValue}" id="bot-temp" title="Controls randomness. Lower values are more focused; higher values are more creative."></div><div class="setting-item"><label class="setting-label setting-label-row" title="Maximum token budget reserved for prompt/context window.">Max Tokens (Context) <span class="setting-tooltip" title="Maximum token budget reserved for prompt/context window.">ⓘ</span></label><input type="number" class="setting-input" value="${tokensValue}" id="bot-tokens" min="1" step="1" title="Maximum token budget reserved for prompt/context window."></div><div class="setting-item"><label class="setting-label setting-label-row" title="Caps how long each assistant response can be.">Max Response Length <span class="setting-tooltip" title="Caps how long each assistant response can be.">ⓘ</span></label><input type="number" class="setting-input" value="${maxResponseLengthValue}" id="bot-max-response-length" min="1" step="1" title="Caps how long each assistant response can be."></div><div class="setting-item"><label class="setting-label setting-label-row" title="Generation stops when any listed string appears.">Stop Strings <span class="setting-tooltip" title="Generation stops when any listed string appears.">ⓘ</span></label><textarea class="setting-input" id="bot-stop-strings" rows="3" placeholder="One stop string per line" title="Generation stops when any listed string appears.">${stopStringsValue}</textarea></div><div class="setting-item"><label class="setting-label setting-label-row" title="Limits candidate token pool size before sampling.">Top K Sampling <span class="setting-tooltip" title="Limits candidate token pool size before sampling.">ⓘ</span></label><input type="number" class="setting-input" value="${topKValue}" id="bot-top-k" min="1" step="1" title="Limits candidate token pool size before sampling."></div><div class="setting-item setting-with-toggle"><label class="setting-label setting-label-row" title="Penalizes repeating the same tokens/phrases.">Repeat Penalty <span class="setting-tooltip" title="Penalizes repeating the same tokens/phrases.">ⓘ</span></label><label class="setting-toggle"><input type="checkbox" id="bot-enable-repeat-penalty" ${repeatPenaltyEnabled ? 'checked' : ''}> Enabled</label><input type="number" class="setting-input" value="${repeatPenaltyValue}" id="bot-repeat-penalty" min="0" max="3" step="0.01" ${repeatPenaltyEnabled ? '' : 'disabled'} title="Penalizes repeating the same tokens/phrases."></div><div class="setting-item setting-with-toggle"><label class="setting-label setting-label-row" title="Upper probability threshold used for nucleus-style filtering.">Max Top P Sampling <span class="setting-tooltip" title="Upper probability threshold used for nucleus-style filtering.">ⓘ</span></label><label class="setting-toggle"><input type="checkbox" id="bot-enable-top-p-max" ${topPMaxEnabled ? 'checked' : ''}> Enabled</label><input type="number" class="setting-input" value="${topPMaxValue}" id="bot-top-p-max" min="0" max="1" step="0.01" ${topPMaxEnabled ? '' : 'disabled'} title="Upper probability threshold used for nucleus-style filtering."></div><div class="setting-item setting-with-toggle"><label class="setting-label setting-label-row" title="Lower probability threshold floor used for token filtering.">Min Top P Sampling <span class="setting-tooltip" title="Lower probability threshold floor used for token filtering.">ⓘ</span></label><label class="setting-toggle"><input type="checkbox" id="bot-enable-top-p-min" ${topPMinEnabled ? 'checked' : ''}> Enabled</label><input type="number" class="setting-input" value="${topPMinValue}" id="bot-top-p-min" min="0" max="1" step="0.01" ${topPMinEnabled ? '' : 'disabled'} title="Lower probability threshold floor used for token filtering."></div><div class="bot-panel-actions"><button class="btn btn-primary" id="bot-settings-save">Save Generation</button><button class="btn btn-secondary" id="bot-settings-reset">Restore Generation</button></div></div>`;
	const generationGroup = inner.querySelector('.bot-panel-group');
	if (generationGroup) {
		const imagesGroup = document.createElement('div');
		imagesGroup.className = 'bot-panel-group bot-panel-images-group';
		imagesGroup.innerHTML = `<div class="section-collapsible-header"><span class="section-collapsible-title">Images</span><button class="section-collapsible-toggle" type="button" aria-label="Collapse Images" title="Collapse Images">v</button></div><div class="section-collapsible-body"><div class="bot-panel-images-grid" id="botPanelImagesGrid"><div class="bot-panel-images-empty">${BOT_PANEL_IMAGE_STATUS.loading}</div></div></div>`;
		inner.insertBefore(imagesGroup, generationGroup);

		const imagesGrid = imagesGroup.querySelector('#botPanelImagesGrid');
		const imagesToggleBtn = imagesGroup.querySelector('.section-collapsible-toggle');
		const selectedBotName = resolveActiveBotNameForPanel();

		const setImagesCollapsed = (collapsed) => {
			imagesGroup.classList.toggle('section-collapsed', !!collapsed);
			if (imagesToggleBtn) {
				imagesToggleBtn.textContent = collapsed ? '<' : 'v';
				imagesToggleBtn.setAttribute('aria-label', collapsed ? 'Expand Images' : 'Collapse Images');
				imagesToggleBtn.title = collapsed ? 'Expand Images' : 'Collapse Images';
			}
			writeCollapsedState(chatImagesStorageKey, !!collapsed);

			if (!collapsed && imagesGrid) {
				const activeBotName = resolveActiveBotNameForPanel();
				renderBotPanelImagesFromCache(imagesGrid, activeBotName);
				if (activeBotName) {
					renderBotPanelImages(activeBotName, imagesGrid);
				} else {
					setBotPanelImagesStatus(imagesGrid, BOT_PANEL_IMAGE_STATUS.noSelection);
				}
			}
		};

		if (imagesToggleBtn) {
			imagesToggleBtn.addEventListener('click', () => {
				setImagesCollapsed(!imagesGroup.classList.contains('section-collapsed'));
			});
		}

		if (selectedBotName) {
			renderBotPanelImagesFromCache(imagesGrid, selectedBotName);
			renderBotPanelImages(selectedBotName, imagesGrid);
		} else if (imagesGrid) {
			setBotPanelImagesStatus(imagesGrid, BOT_PANEL_IMAGE_STATUS.noSelection);
		}

		setImagesCollapsed(readCollapsedState(chatImagesStorageKey));
	}
	makeSectionsCollapsible(inner, '.bot-panel-group:not(.bot-panel-images-group)', 'chat-generation-panel');

	const inputs = getBotPanelGenerationInputElements();
	const {
		tempInput,
		tokensInput,
		maxResponseLengthInput,
		stopStringsInput,
		topKInput,
		enableRepeatPenaltyInput,
		repeatPenaltyInput,
		enableTopPMaxInput,
		topPMaxInput,
		enableTopPMinInput,
		topPMinInput
	} = inputs;
	const tempValueLabel = document.getElementById('bot-temp-value');
	const saveBtn = document.getElementById('bot-settings-save');
	const resetBtn = document.getElementById('bot-settings-reset');
	const editBtn = document.querySelector('.bot-panel-edit-btn');
	if (tempInput) {
		tempInput.addEventListener('input', () => {
			settingsDraft.temperature = parseFloat(tempInput.value);
			if (tempValueLabel) {
				tempValueLabel.textContent = Number(settingsDraft.temperature).toFixed(2);
			}
		});
	}
	bindNumericDraftInput(tokensInput, 'max_tokens', value => parseInt(value, 10));
	bindNumericDraftInput(maxResponseLengthInput, 'max_response_length', value => parseInt(value, 10));
	if (stopStringsInput) {
		stopStringsInput.addEventListener('input', () => {
			settingsDraft.stop_strings = parseBotPanelStopStrings(stopStringsInput.value);
		});
	}
	bindNumericDraftInput(topKInput, 'top_k', value => parseInt(value, 10));
	if (enableRepeatPenaltyInput && repeatPenaltyInput) {
		enableRepeatPenaltyInput.addEventListener('change', () => {
			repeatPenaltyInput.disabled = !enableRepeatPenaltyInput.checked;
			settingsDraft.enable_repeat_penalty = enableRepeatPenaltyInput.checked;
		});
		bindNumericDraftInput(repeatPenaltyInput, 'repeat_penalty', value => parseFloat(value));
	}
	if (enableTopPMaxInput && topPMaxInput) {
		enableTopPMaxInput.addEventListener('change', () => {
			topPMaxInput.disabled = !enableTopPMaxInput.checked;
			settingsDraft.enable_top_p_max = enableTopPMaxInput.checked;
		});
		bindNumericDraftInput(topPMaxInput, 'top_p_max', value => parseFloat(value));
	}
	if (enableTopPMinInput && topPMinInput) {
		enableTopPMinInput.addEventListener('change', () => {
			topPMinInput.disabled = !enableTopPMinInput.checked;
			settingsDraft.enable_top_p_min = enableTopPMinInput.checked;
		});
		bindNumericDraftInput(topPMinInput, 'top_p_min', value => parseFloat(value));
	}
	if (saveBtn) {
		saveBtn.addEventListener('click', () => {
			saveGenerationSettings();
		});
	}
	if (resetBtn) {
		resetBtn.addEventListener('click', () => {
			resetGenerationSettingsFromPanel();
		});
	}
	if (editBtn) {
		editBtn.addEventListener('click', () => {
			const targetBotName = (currentBotInfo && currentBotInfo.name) ? currentBotInfo.name : currentBotName;
			if (!targetBotName) {
				return;
			}

			fetch('/api/bot/select', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bot_name: targetBotName })
			})
				.then(r => r.json())
				.then(data => {
					if (!data || !data.success || !data.bot) {
						return;
					}
					currentBotInfo = data.bot;
					currentBotName = data.bot.name;

					const navArray = Array.from(navItems || []);
					navArray.forEach(item => item.classList.remove('active'));
					const botsNavItem = navArray.find(item => item.dataset && item.dataset.view === 'bots');
					if (botsNavItem) {
						botsNavItem.classList.add('active');
					}

					const appRoot = document.querySelector('.app');
					if (appRoot) {
						appRoot.classList.remove('chat-layout');
					}
					const panel = document.getElementById('botPanel');
					if (panel) {
						panel.classList.remove('visible');
					}
					if (inputArea) {
						inputArea.classList.remove('visible');
					}
					currentView = 'bots';
					renderBotDetailView(data.bot);
					showBotEditor(data.bot);
				});
		});
	}

	ensureBotPanelExpandToggle();
}

function saveGenerationSettings() {
	const inputs = getBotPanelGenerationInputElements();
	const {
		tempInput,
		tokensInput,
		maxResponseLengthInput,
		stopStringsInput,
		topKInput,
		enableRepeatPenaltyInput,
		repeatPenaltyInput,
		enableTopPMaxInput,
		topPMaxInput,
		enableTopPMinInput,
		topPMinInput
	} = inputs;
	if (!tempInput || !tokensInput || !maxResponseLengthInput || !stopStringsInput || !topKInput || !enableRepeatPenaltyInput || !repeatPenaltyInput || !enableTopPMaxInput || !topPMaxInput || !enableTopPMinInput || !topPMinInput) {
		return;
	}
	const payload = buildBotPanelGenerationPayload(inputs);
	saveSettingsPatch(payload, true);
}

function resetGenerationSettingsFromPanel() {
	if (typeof restoreGenerationSettings === 'function') {
		restoreGenerationSettings({ showAlert: true, askConfirmation: true });
		return;
	}
	if (!confirm('Restore Generation settings to defaults?')) {
		return;
	}
	const payload = {
		temperature: 0.7,
		max_tokens: 10000,
		max_response_length: 300,
		stop_strings: ['User', 'User:'],
		top_k: 40,
		enable_repeat_penalty: true,
		repeat_penalty: 1.0,
		enable_top_p_max: true,
		top_p_max: 0.95,
		enable_top_p_min: true,
		top_p_min: 0.05
	};
	saveSettingsPatch(payload, false)
		.then(() => {
			alert('Generation settings restored to defaults!');
			updateBotPanel();
		});
}
