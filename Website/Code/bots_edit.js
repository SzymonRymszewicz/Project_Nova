const BOT_EDITOR_DEFAULT_GRADIENT = 'linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%)';
const BOT_EDITOR_NO_IMAGES_MARKUP = '<p style="color: #999; grid-column: 1/-1;">No images yet</p>';

function normalizeBotEditorDatasetId(value) {
	const safe = `${value || ''}`.trim();
	if (!safe || safe.toLowerCase() === 'none') {
		return '';
	}
	return safe;
}

function renderBotEditorDatasetOptions(datasetItems, selectedId) {
	const select = document.getElementById('bot-dataset-select');
	if (!select) {
		return;
	}
	const normalizedSelected = normalizeBotEditorDatasetId(selectedId);
	const rows = Array.isArray(datasetItems) ? datasetItems : [];
	const options = ['<option value="">None</option>'];
	rows.forEach((dataset) => {
		const id = `${dataset?.id || ''}`.trim();
		if (!id) {
			return;
		}
		const name = `${dataset?.name || 'Untitled Dataset'}`;
		const isSelected = id === normalizedSelected ? 'selected' : '';
		options.push(`<option value="${escapeHtml(id)}" ${isSelected}>${escapeHtml(name)}</option>`);
	});
	select.innerHTML = options.join('');
	select.value = normalizedSelected;
}

function loadBotEditorDatasetOptions(botName, selectedId) {
	const safeBotName = `${botName || ''}`.trim();
	if (!safeBotName) {
		renderBotEditorDatasetOptions([], selectedId);
		return;
	}
	fetch('/api/datasets')
		.then(r => r.json())
		.then((result) => {
			const rows = Array.isArray(result?.datasets) ? result.datasets : [];
			renderBotEditorDatasetOptions(rows, selectedId);
		})
		.catch(() => {
			renderBotEditorDatasetOptions([], selectedId);
		});
}

function loadBotEditor(bot, advancedMode = false) {
	const render = () => renderBotEditor(bot, advancedMode);
	if (advancedMode) {
		ensureAvailableModulesLoaded().then(render);
		return;
	}
	render();
}

function showBotEditor(bot) {
	loadBotEditor(bot, false);
}

function showBotAdvancedEditor(bot) {
	loadBotEditor(bot, true);
}

function handleEditModuleDefaultsRestore(botName, moduleName) {
	const safeBotName = `${botName || ''}`.trim();
	const safeModuleName = `${moduleName || ''}`.trim();
	if (!safeBotName || !safeModuleName) {
		return;
	}
	if (!confirm(`Restore ${safeModuleName} settings to defaults for this bot?`)) {
		return;
	}

	const defaults = getModuleSettingsDefaults(safeModuleName);
	const moduleSettings = normalizeModuleSettings(currentBotInfo && currentBotInfo.module_settings, availableModuleDefinitions);
	moduleSettings[safeModuleName] = { ...defaults };

	fetch('/api/bots', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			action: 'update',
			bot_name: safeBotName,
			new_name: safeBotName,
			module_settings: moduleSettings
		})
	})
		.then(r => r.json())
		.then(result => {
			if (!result || !result.success || !result.bot) {
				alert((result && result.message) || `Failed to restore ${safeModuleName} settings.`);
				return;
			}
			currentBotInfo = result.bot;
			currentBotName = result.bot.name;
			showBotAdvancedEditor(result.bot);
			if (typeof showToast === 'function') {
				showToast(`${safeModuleName} restored to defaults.`, 'success');
			}
		});
}

function renderBotEditor(bot, advancedMode) {
	const isProtectedBot = `${bot && bot.name ? bot.name : ''}`.trim().toLowerCase() === 'nova';
	const normalizedModuleSettings = normalizeModuleSettings(bot && bot.module_settings, availableModuleDefinitions);
	chatHeader.innerHTML = `<div><div class="chat-title">Edit ${bot.name}</div><div class="chat-subtitle">Bot Editor</div></div>`;
	messagesContainer.innerHTML = '';
	const editor = document.createElement('div');
	editor.className = 'bot-editor';
	if (advancedMode) {
		editor.classList.add('bot-editor-advanced');
	}
	const advancedModuleSections = advancedMode
		? getAdvancedModulePlaceholderSectionsMarkup({ prefix: 'bot', module_settings: normalizedModuleSettings })
		: '';
	
	const initial = bot.name[0].toUpperCase();
	
	const coverStyle = bot.cover_art
		? buildImageStyle(bot.cover_art, bot.cover_art_fit || null)
		: `background:${BOT_EDITOR_DEFAULT_GRADIENT};`;
	const iconStyle = bot.icon_art
		? buildImageStyle(bot.icon_art, bot.icon_fit || null)
		: `background:${BOT_EDITOR_DEFAULT_GRADIENT};`;
	
	const coverContent = bot.cover_art ? '' : `<div>${initial}</div>`;
	const iconContent = bot.icon_art ? '' : `<div style="font-size: 24px;">${initial}</div>`;

	const detailsHeader = advancedMode
		? `<div class="detail-title-row"><button class="icon-btn bot-advanced-back-btn" type="button" title="Back to full editor" aria-label="Back to full editor"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.707 4.293a1 1 0 010 1.414L6.414 9H17a1 1 0 110 2H6.414l3.293 3.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></button><h3>Bot Details</h3></div>`
		: `<div class="detail-title-row"><h3>Bot Details</h3><button class="icon-btn bot-advanced-settings-btn" type="button" title="Advanced settings" aria-label="Advanced settings"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg></button></div>`;

	const detailsSection = `
			<div class="bot-editor-section">
				${detailsHeader}
				${advancedMode ? '' : '<div class="form-group"><label>Dataset</label><select id="bot-dataset-select" class="text-input"><option value="">None</option></select></div>'}
				<div class="form-group">
					<label>Name</label>
					<input type="text" id="bot-name" class="text-input" value="${bot.name || ''}" ${isProtectedBot ? 'readonly' : ''}>
				</div>
				<div class="form-group">
					<label>Description</label>
					<textarea id="bot-description" class="text-input" rows="3">${bot.description || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Definition (core.txt) <span class="token-badge" id="bot-core-token-count">0 tok</span></label>
					<textarea id="bot-core" class="text-input" rows="4">${bot.core_data || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Rules (scenario.txt) <span class="token-badge" id="bot-scenario-token-count">0 tok</span></label>
					<textarea id="bot-scenario" class="text-input" rows="4">${bot.scenario_data || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Initial Messages (IAM) <span class="token-badge" id="bot-iam-token-total">0 tok</span></label>
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
				${advancedMode ? `<div class="form-group"><label>Example Messages <span class="token-badge" id="bot-example-token-count">0 tok</span></label><textarea id="bot-example-messages" class="text-input" rows="6">${bot.example_messages || ''}</textarea><p style="margin-top:0.5rem;opacity:0.8;">Format with blocks starting at [Start], then lines like {{char}}: ... and {{user}}: ...</p></div><div class="form-group"><label>Example Injection Threshold</label><input type="number" id="bot-example-threshold" class="text-input" min="0" step="1" value="${Math.max(0, parseInt(bot.example_injection_threshold, 10) || 0)}"><p style="margin-top:0.5rem;opacity:0.8;">0 = always inject. Values above 0 inject only for the first X user messages.</p></div><div class="form-group"><label>Dataset</label><label style="margin-top:0.5rem;display:block;opacity:0.85;">Injection persistance</label><input type="number" id="bot-dataset-injection-persistence" class="text-input" min="0" step="1" value="${Math.max(0, parseInt(bot.dataset_injection_persistence, 10) || 6)}"><p style="margin-top:0.5rem;opacity:0.8;">Controls how many user turns dynamic dataset entries stay injected after a keyword trigger. Mentioning a keyword again resets the timer.</p></div>` : ''}
				${advancedMode ? `<div class="form-group"><label>Tabs</label><div class="prompt-tab-picker-list" id="prompt-tabs-list"></div></div><div class="form-group"><label>Prompt Order</label><div class="prompt-order-list" id="prompt-order-list"></div></div>` : ''}
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
								<input type="range" id="cover-zoom" min="50" max="300" value="${(bot.cover_art_fit?.size ?? 100)}" class="slider">
								<span id="cover-zoom-val">${(bot.cover_art_fit?.size ?? 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="cover-posX" min="0" max="100" value="${(bot.cover_art_fit?.x ?? 50)}" class="slider">
								<span id="cover-posX-val">${(bot.cover_art_fit?.x ?? 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="cover-posY" min="0" max="100" value="${(bot.cover_art_fit?.y ?? 50)}" class="slider">
								<span id="cover-posY-val">${(bot.cover_art_fit?.y ?? 50)}%</span>
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
								<input type="range" id="icon-zoom" min="50" max="300" value="${(bot.icon_fit?.size ?? 100)}" class="slider">
								<span id="icon-zoom-val">${(bot.icon_fit?.size ?? 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="icon-posX" min="0" max="100" value="${(bot.icon_fit?.x ?? 50)}" class="slider">
								<span id="icon-posX-val">${(bot.icon_fit?.x ?? 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="icon-posY" min="0" max="100" value="${(bot.icon_fit?.y ?? 50)}" class="slider">
								<span id="icon-posY-val">${(bot.icon_fit?.y ?? 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

	editor.innerHTML = `
		<div class="bot-editor-grid masonry-grid${advancedMode ? ' bot-editor-grid-advanced' : ''}">
			${detailsSection}
			${advancedMode ? advancedModuleSections : mediaSections}
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

	loadBotIam(bot.name, bot.active_iam_set || DEFAULT_IAM_SET);
	loadBotEditorDatasetOptions(bot.name, bot.active_dataset_id || '');
	
	if (!advancedMode) {
		loadBotImages(bot);
		bindBotImageAdjustments(bot);

		const imageUpload = document.getElementById('bot-image-upload');
		if (imageUpload) {
			imageUpload.addEventListener('change', (e) => {
				uploadBotImages(bot.name, e.target.files);
			});
		}
	}
	
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
		initPromptOrderEditor(bot.prompt_order, 'prompt-order-list', (state) => {
			syncAdvancedModuleSectionsVisibility('bot', state.order);
		}, bot.prompt_order_enabled, 'prompt-tabs-list');
		syncAdvancedModuleSectionsVisibility('bot', bot.prompt_order);
		document.querySelectorAll('.module-setting-input[data-module-prefix="bot"]').forEach((input) => {
			input.addEventListener('input', refreshEditBotTokenCounters);
		});
		bindModuleRestoreButtons('bot', (moduleName) => handleEditModuleDefaultsRestore(bot.name, moduleName));
	}

	['bot-core', 'bot-scenario'].forEach(id => {
		const input = document.getElementById(id);
		if (input) {
			input.addEventListener('input', refreshEditBotTokenCounters);
		}
	});
	refreshEditBotTokenCounters();
}

function saveBotEdits(originalName) {
	const isAdvancedMode = !!document.querySelector('.bot-editor.bot-editor-advanced');
	const isProtectedBot = `${originalName || ''}`.trim().toLowerCase() === 'nova';
	const nameInput = document.getElementById('bot-name');
	const descInput = document.getElementById('bot-description');
	const coreInput = document.getElementById('bot-core');
	const scenarioInput = document.getElementById('bot-scenario');
	const exampleMessagesInput = document.getElementById('bot-example-messages');
	const exampleThresholdInput = document.getElementById('bot-example-threshold');
	const datasetPersistenceInput = document.getElementById('bot-dataset-injection-persistence');
	const coverFit = readBotFitInputs('cover');
	const iconFit = readBotFitInputs('icon');
	if (!nameInput || !descInput || !coreInput || !scenarioInput) {
		return;
	}
	const nextName = isProtectedBot
		? originalName
		: (nameInput.value.trim() || originalName);
	const payload = {
		action: 'update',
		bot_name: originalName,
		new_name: nextName,
		description: descInput.value,
		core_data: coreInput.value,
		scenario_data: scenarioInput.value,
		active_iam_set: botEditorIamState.currentSet || DEFAULT_IAM_SET,
		active_dataset_id: normalizeBotEditorDatasetId((document.getElementById('bot-dataset-select') || {}).value) || normalizeBotEditorDatasetId(currentBotInfo && currentBotInfo.active_dataset_id),
		dataset_injection_persistence: Math.max(0, parseInt(datasetPersistenceInput ? datasetPersistenceInput.value : `${(currentBotInfo && currentBotInfo.dataset_injection_persistence) || 6}`, 10) || 6),
		example_messages: exampleMessagesInput ? exampleMessagesInput.value : '',
		example_injection_threshold: Math.max(0, parseInt(exampleThresholdInput ? exampleThresholdInput.value : '0', 10) || 0)
	};
	if (coverFit) {
		payload.cover_art_fit = coverFit;
	}
	if (iconFit) {
		payload.icon_fit = iconFit;
	}
	const promptOrderContainer = document.getElementById('prompt-order-list');
	if (promptOrderContainer) {
		const promptOrderState = readPromptOrderEditorState('prompt-order-list');
		payload.prompt_order = promptOrderState.order;
		payload.prompt_order_enabled = promptOrderState.enabled;
	}
	const moduleInputs = document.querySelectorAll('.module-setting-input[data-module-prefix="bot"]');
	if (moduleInputs.length) {
		const moduleSettings = normalizeModuleSettings(currentBotInfo && currentBotInfo.module_settings, availableModuleDefinitions);
		moduleInputs.forEach((input) => {
			const moduleName = `${input.getAttribute('data-module-name') || ''}`.trim();
			const settingKey = `${input.getAttribute('data-setting-key') || ''}`.trim();
			if (!moduleName || !settingKey) {
				return;
			}
			if (!moduleSettings[moduleName] || typeof moduleSettings[moduleName] !== 'object') {
				moduleSettings[moduleName] = {};
			}
			moduleSettings[moduleName][settingKey] = `${input.value || ''}`;
		});
		payload.module_settings = moduleSettings;
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
	if (`${botName}`.trim().toLowerCase() === 'nova') {
		alert('She kinda needs to exist for this entire thing to work... Sorry, not sorry.');
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
				setCurrentChatContextStats(null);
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
	const fitKey = prefix === 'cover' ? 'cover_art_fit' : `${prefix}_fit`;
	const fallback = (currentBotInfo && currentBotInfo[fitKey]) || { size: 100, x: 50, y: 50 };
	if (!zoomInput || !posXInput || !posYInput) {
		return null;
	}
	const size = Number.parseInt(zoomInput.value, 10);
	const x = Number.parseInt(posXInput.value, 10);
	const y = Number.parseInt(posYInput.value, 10);
	const fallbackSize = Number.parseInt(fallback.size, 10);
	const fallbackX = Number.parseInt(fallback.x, 10);
	const fallbackY = Number.parseInt(fallback.y, 10);
	return {
		size: Number.isFinite(size) ? size : (Number.isFinite(fallbackSize) ? fallbackSize : 100),
		x: Number.isFinite(x) ? x : (Number.isFinite(fallbackX) ? fallbackX : 50),
		y: Number.isFinite(y) ? y : (Number.isFinite(fallbackY) ? fallbackY : 50)
	};
}

function bindBotImageAdjustments(bot) {
	const resolveCoverArt = () => {
		const hidden = document.getElementById('cover-art-value');
		const hiddenValue = hidden ? `${hidden.value || ''}`.trim() : '';
		if (hiddenValue) {
			return hiddenValue;
		}
		if (currentBotInfo && currentBotInfo.cover_art) {
			return `${currentBotInfo.cover_art}`;
		}
		return `${(bot && bot.cover_art) || ''}`;
	};

	const resolveIconArt = () => {
		const hidden = document.getElementById('icon-art-value');
		const hiddenValue = hidden ? `${hidden.value || ''}`.trim() : '';
		if (hiddenValue) {
			return hiddenValue;
		}
		if (currentBotInfo && currentBotInfo.icon_art) {
			return `${currentBotInfo.icon_art}`;
		}
		return `${(bot && bot.icon_art) || ''}`;
	};

	const updateCoverPreview = () => {
		const zoom = parseInt(document.getElementById('cover-zoom').value);
		const x = parseInt(document.getElementById('cover-posX').value);
		const y = parseInt(document.getElementById('cover-posY').value);
		document.getElementById('cover-zoom-val').textContent = zoom + '%';
		document.getElementById('cover-posX-val').textContent = x + '%';
		document.getElementById('cover-posY-val').textContent = y + '%';
		const fit = { size: zoom, x, y };
		document.getElementById('cover-preview').style.cssText = buildImageStyle(resolveCoverArt(), fit);
	};
	
	document.getElementById('cover-zoom').addEventListener('input', updateCoverPreview);
	document.getElementById('cover-posX').addEventListener('input', updateCoverPreview);
	document.getElementById('cover-posY').addEventListener('input', updateCoverPreview);
	
	const updateIconPreview = () => {
		const zoom = parseInt(document.getElementById('icon-zoom').value);
		const x = parseInt(document.getElementById('icon-posX').value);
		const y = parseInt(document.getElementById('icon-posY').value);
		document.getElementById('icon-zoom-val').textContent = zoom + '%';
		document.getElementById('icon-posX-val').textContent = x + '%';
		document.getElementById('icon-posY-val').textContent = y + '%';
		const fit = { size: zoom, x, y };
		document.getElementById('icon-preview').style.cssText = buildImageStyle(resolveIconArt(), fit);
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
				gallery.innerHTML = BOT_EDITOR_NO_IMAGES_MARKUP;
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
				document.getElementById('cover-art-value').value = `${currentBotInfo.cover_art || ''}`;
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
				document.getElementById('icon-art-value').value = `${currentBotInfo.icon_art || ''}`;
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
		container.appendChild(createBotIamRow(item));
	});
	refreshEditBotTokenCounters();
}

function addBotIamEntry() {
	const container = document.getElementById('bot-iam-list');
	if (!container) {
		return;
	}
	container.appendChild(createBotIamRow(''));
	refreshEditBotTokenCounters();
}

function createBotIamRow(item) {
	const row = document.createElement('div');
	row.className = 'iam-item';
	const content = (item && typeof item === 'object') ? (item.content || '') : (item || '');
	row.innerHTML = `<textarea class="setting-input iam-input" rows="2">${content}</textarea><button class="btn btn-secondary iam-delete" type="button">Delete</button>`;
	const input = row.querySelector('.iam-input');
	if (input) {
		input.addEventListener('input', refreshEditBotTokenCounters);
	}
	const delBtn = row.querySelector('.iam-delete');
	if (delBtn) {
		delBtn.addEventListener('click', () => {
			row.remove();
			refreshEditBotTokenCounters();
		});
	}
	return row;
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
