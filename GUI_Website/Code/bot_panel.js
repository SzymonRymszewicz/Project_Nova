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

function updateBotPanel() {
	const panel = document.getElementById('botPanel');
	const inner = document.getElementById('botPanelInner');
	if (!panel || !inner) {
		return;
	}

	const botName = (currentBotInfo && currentBotInfo.name) ? currentBotInfo.name : (currentBotName || 'No bot selected');
	const coverArt = currentBotInfo && currentBotInfo.cover_art ? currentBotInfo.cover_art : '';
	const coverFit = currentBotInfo && currentBotInfo.cover_art_fit ? currentBotInfo.cover_art_fit : null;
	const initial = botName ? botName[0].toUpperCase() : 'B';
	const coverStyle = coverArt
		? buildImageStyle(coverArt, coverFit)
		: 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);';
	const coverContent = coverArt ? '' : `<div>${initial}</div>`;

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

	inner.innerHTML = `<div class="bot-panel-cover" style="${coverStyle}">${coverContent}</div><div class="bot-panel-name-row"><div class="bot-panel-name">${botName}</div><button class="icon-btn bot-panel-edit-btn" type="button" title="Edit bot" aria-label="Edit bot"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-1 1-3.828-3.828 1-1a2 2 0 012.828 0zM2 13.586l9.586-9.586 3.828 3.828L5.828 17.414H2v-3.828z"/></svg></button></div><div class="bot-panel-group"><h3>Generation</h3><div class="setting-item"><label class="setting-label setting-label-row" title="Controls randomness. Lower values are more focused; higher values are more creative.">Temperature <span class="setting-tooltip" title="Controls randomness. Lower values are more focused; higher values are more creative.">ⓘ</span><span class="setting-value" id="bot-temp-value">${Number(tempValue).toFixed(2)}</span></label><input type="range" class="setting-input" min="0.1" max="2.0" step="0.01" value="${tempValue}" id="bot-temp" title="Controls randomness. Lower values are more focused; higher values are more creative."></div><div class="setting-item"><label class="setting-label setting-label-row" title="Maximum token budget reserved for prompt/context window.">Max Tokens (Context) <span class="setting-tooltip" title="Maximum token budget reserved for prompt/context window.">ⓘ</span></label><input type="number" class="setting-input" value="${tokensValue}" id="bot-tokens" min="1" step="1" title="Maximum token budget reserved for prompt/context window."></div><div class="setting-item"><label class="setting-label setting-label-row" title="Caps how long each assistant response can be.">Max Response Length <span class="setting-tooltip" title="Caps how long each assistant response can be.">ⓘ</span></label><input type="number" class="setting-input" value="${maxResponseLengthValue}" id="bot-max-response-length" min="1" step="1" title="Caps how long each assistant response can be."></div><div class="setting-item"><label class="setting-label setting-label-row" title="Generation stops when any listed string appears.">Stop Strings <span class="setting-tooltip" title="Generation stops when any listed string appears.">ⓘ</span></label><textarea class="setting-input" id="bot-stop-strings" rows="3" placeholder="One stop string per line" title="Generation stops when any listed string appears.">${stopStringsValue}</textarea></div><div class="setting-item"><label class="setting-label setting-label-row" title="Limits candidate token pool size before sampling.">Top K Sampling <span class="setting-tooltip" title="Limits candidate token pool size before sampling.">ⓘ</span></label><input type="number" class="setting-input" value="${topKValue}" id="bot-top-k" min="1" step="1" title="Limits candidate token pool size before sampling."></div><div class="setting-item setting-with-toggle"><label class="setting-label setting-label-row" title="Penalizes repeating the same tokens/phrases.">Repeat Penalty <span class="setting-tooltip" title="Penalizes repeating the same tokens/phrases.">ⓘ</span></label><label class="setting-toggle"><input type="checkbox" id="bot-enable-repeat-penalty" ${repeatPenaltyEnabled ? 'checked' : ''}> Enabled</label><input type="number" class="setting-input" value="${repeatPenaltyValue}" id="bot-repeat-penalty" min="0" max="3" step="0.01" ${repeatPenaltyEnabled ? '' : 'disabled'} title="Penalizes repeating the same tokens/phrases."></div><div class="setting-item setting-with-toggle"><label class="setting-label setting-label-row" title="Upper probability threshold used for nucleus-style filtering.">Max Top P Sampling <span class="setting-tooltip" title="Upper probability threshold used for nucleus-style filtering.">ⓘ</span></label><label class="setting-toggle"><input type="checkbox" id="bot-enable-top-p-max" ${topPMaxEnabled ? 'checked' : ''}> Enabled</label><input type="number" class="setting-input" value="${topPMaxValue}" id="bot-top-p-max" min="0" max="1" step="0.01" ${topPMaxEnabled ? '' : 'disabled'} title="Upper probability threshold used for nucleus-style filtering."></div><div class="setting-item setting-with-toggle"><label class="setting-label setting-label-row" title="Lower probability threshold floor used for token filtering.">Min Top P Sampling <span class="setting-tooltip" title="Lower probability threshold floor used for token filtering.">ⓘ</span></label><label class="setting-toggle"><input type="checkbox" id="bot-enable-top-p-min" ${topPMinEnabled ? 'checked' : ''}> Enabled</label><input type="number" class="setting-input" value="${topPMinValue}" id="bot-top-p-min" min="0" max="1" step="0.01" ${topPMinEnabled ? '' : 'disabled'} title="Lower probability threshold floor used for token filtering."></div><div class="bot-panel-actions"><button class="btn btn-primary" id="bot-settings-save">Save Generation</button><button class="btn btn-secondary" id="bot-settings-reset">Restore Generation</button></div></div>`;
	makeSectionsCollapsible(inner, '.bot-panel-group', 'chat-generation-panel');

	const tempInput = document.getElementById('bot-temp');
	const tempValueLabel = document.getElementById('bot-temp-value');
	const tokensInput = document.getElementById('bot-tokens');
	const maxResponseLengthInput = document.getElementById('bot-max-response-length');
	const stopStringsInput = document.getElementById('bot-stop-strings');
	const topKInput = document.getElementById('bot-top-k');
	const enableRepeatPenaltyInput = document.getElementById('bot-enable-repeat-penalty');
	const repeatPenaltyInput = document.getElementById('bot-repeat-penalty');
	const enableTopPMaxInput = document.getElementById('bot-enable-top-p-max');
	const topPMaxInput = document.getElementById('bot-top-p-max');
	const enableTopPMinInput = document.getElementById('bot-enable-top-p-min');
	const topPMinInput = document.getElementById('bot-top-p-min');
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
	if (tokensInput) {
		tokensInput.addEventListener('input', () => {
			settingsDraft.max_tokens = parseInt(tokensInput.value, 10);
		});
	}
	if (maxResponseLengthInput) {
		maxResponseLengthInput.addEventListener('input', () => {
			settingsDraft.max_response_length = parseInt(maxResponseLengthInput.value, 10);
		});
	}
	if (stopStringsInput) {
		stopStringsInput.addEventListener('input', () => {
			settingsDraft.stop_strings = parseBotPanelStopStrings(stopStringsInput.value);
		});
	}
	if (topKInput) {
		topKInput.addEventListener('input', () => {
			settingsDraft.top_k = parseInt(topKInput.value, 10);
		});
	}
	if (enableRepeatPenaltyInput && repeatPenaltyInput) {
		enableRepeatPenaltyInput.addEventListener('change', () => {
			repeatPenaltyInput.disabled = !enableRepeatPenaltyInput.checked;
			settingsDraft.enable_repeat_penalty = enableRepeatPenaltyInput.checked;
		});
		repeatPenaltyInput.addEventListener('input', () => {
			settingsDraft.repeat_penalty = parseFloat(repeatPenaltyInput.value);
		});
	}
	if (enableTopPMaxInput && topPMaxInput) {
		enableTopPMaxInput.addEventListener('change', () => {
			topPMaxInput.disabled = !enableTopPMaxInput.checked;
			settingsDraft.enable_top_p_max = enableTopPMaxInput.checked;
		});
		topPMaxInput.addEventListener('input', () => {
			settingsDraft.top_p_max = parseFloat(topPMaxInput.value);
		});
	}
	if (enableTopPMinInput && topPMinInput) {
		enableTopPMinInput.addEventListener('change', () => {
			topPMinInput.disabled = !enableTopPMinInput.checked;
			settingsDraft.enable_top_p_min = enableTopPMinInput.checked;
		});
		topPMinInput.addEventListener('input', () => {
			settingsDraft.top_p_min = parseFloat(topPMinInput.value);
		});
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
}

function saveGenerationSettings() {
	const tempInput = document.getElementById('bot-temp');
	const tokensInput = document.getElementById('bot-tokens');
	const maxResponseLengthInput = document.getElementById('bot-max-response-length');
	const stopStringsInput = document.getElementById('bot-stop-strings');
	const topKInput = document.getElementById('bot-top-k');
	const enableRepeatPenaltyInput = document.getElementById('bot-enable-repeat-penalty');
	const repeatPenaltyInput = document.getElementById('bot-repeat-penalty');
	const enableTopPMaxInput = document.getElementById('bot-enable-top-p-max');
	const topPMaxInput = document.getElementById('bot-top-p-max');
	const enableTopPMinInput = document.getElementById('bot-enable-top-p-min');
	const topPMinInput = document.getElementById('bot-top-p-min');
	if (!tempInput || !tokensInput || !maxResponseLengthInput || !stopStringsInput || !topKInput || !enableRepeatPenaltyInput || !repeatPenaltyInput || !enableTopPMaxInput || !topPMaxInput || !enableTopPMinInput || !topPMinInput) {
		return;
	}
	const payload = {
		temperature: parseFloat(tempInput.value),
		max_tokens: parseInt(tokensInput.value, 10),
		max_response_length: parseInt(maxResponseLengthInput.value, 10),
		stop_strings: parseBotPanelStopStrings(stopStringsInput.value),
		top_k: parseInt(topKInput.value, 10),
		enable_repeat_penalty: enableRepeatPenaltyInput.checked,
		repeat_penalty: parseFloat(repeatPenaltyInput.value),
		enable_top_p_max: enableTopPMaxInput.checked,
		top_p_max: parseFloat(topPMaxInput.value),
		enable_top_p_min: enableTopPMinInput.checked,
		top_p_min: parseFloat(topPMinInput.value)
	};
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
