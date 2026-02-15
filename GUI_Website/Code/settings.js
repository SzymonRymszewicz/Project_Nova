function getDefaultApiBaseUrl(provider) {
	if (provider === 'localhost') {
		return 'http://localhost:1234/v1';
	}
	if (provider === 'openai') {
		return 'https://api.openai.com/v1';
	}
	return '';
}

function getDefaultModel(provider) {
	if (provider === 'openai') {
		return 'gpt-3.5-turbo';
	}
	return '';
}

function setApiTestResult(message, isSuccess) {
	const result = document.getElementById('api-test-result');
	if (!result) {
		return;
	}
	result.textContent = message || '';
	result.classList.toggle('success', isSuccess === true);
	result.classList.toggle('failure', isSuccess === false);
}

function testApiConnection() {
	const provider = document.getElementById('provider');
	const apiBaseUrl = document.getElementById('api-base-url');
	const apiKey = document.getElementById('apikey');
	const model = document.getElementById('model');

	if (!provider || !apiBaseUrl || !apiKey || !model) {
		return;
	}

	setApiTestResult('Testing connection...', null);
	const payload = {
		api_provider: provider.value,
		api_base_url: apiBaseUrl.value.trim(),
		api_key: apiKey.value.trim(),
		model: model.value.trim()
	};

	fetch('/api/settings/test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ settings: payload })
	})
		.then(r => r.json())
		.then(result => {
			const success = !!(result && result.success);
			const message = (result && result.message) || (success ? 'Connection successful.' : 'Connection failed.');
			setApiTestResult('', null);
			alert(message);
		})
		.catch(() => {
			setApiTestResult('', null);
			alert('Connection failed.');
		});
}

function showSettings() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Settings</div><div class="chat-subtitle">Manage preferences</div></div>';
	messagesContainer.innerHTML = '';
	fetch('/api/settings')
		.then(r => r.json())
		.then(settings => {
			const container = document.createElement('div');
			container.className = 'settings-container';
			const temp = settings.temperature || 0.7;
			const tokens = settings.max_tokens || 2048;
			const uiFontSize = settings.ui_font_size ?? settings.font_size ?? 12;
			const chatFontSize = settings.chat_font_size ?? settings.font_size ?? 12;
			const providerValue = settings.api_provider || 'localhost';
			const apiBaseUrlValue = settings.api_base_url || getDefaultApiBaseUrl(providerValue);
			const modelValue = settings.model ?? getDefaultModel(providerValue);
			const apiKeyValue = settings.api_key || '';
			const showTimestamps = settings.show_message_timestamps ?? true;
			const debugMode = settings.debug_mode ?? false;
			const normalizedSettings = {
				...settings,
				api_provider: providerValue,
				api_base_url: apiBaseUrlValue,
				model: modelValue,
				api_key: apiKeyValue,
				ui_font_size: uiFontSize,
				chat_font_size: chatFontSize,
				show_message_timestamps: showTimestamps,
				debug_mode: debugMode
			};
			lastSavedTheme = normalizedSettings.theme || 'default';
			lastSavedSettings = { ...normalizedSettings };
			settingsDraft = { ...normalizedSettings };
			const modelPlaceholder = providerValue === 'localhost' ? 'Loaded model name in LM Studio' : 'Model name';
			container.innerHTML = `<div class="settings-grid"><div class="settings-group"><h3>Generation</h3><div class="setting-item"><label class="setting-label">Temperature</label><input type="range" class="setting-input" min="0" max="2" step="0.1" value="${temp}" id="temp"></div><div class="setting-item"><label class="setting-label">Max Tokens</label><input type="number" class="setting-input" value="${tokens}" id="tokens"></div></div><div class="settings-group"><h3>API Client</h3><div class="setting-item"><label class="setting-label">API Provider</label><select class="setting-select" id="provider"><option value="localhost" ${providerValue === 'localhost' ? 'selected' : ''}>Localhost (LM Studio)</option><option value="openai" ${providerValue === 'openai' ? 'selected' : ''}>OpenAI</option></select></div><div class="setting-item"><label class="setting-label">API Base URL</label><input type="text" class="setting-input" value="${apiBaseUrlValue}" id="api-base-url"></div><div class="setting-item"><label class="setting-label">Model</label><input type="text" class="setting-input" value="${modelValue}" placeholder="${modelPlaceholder}" id="model"></div><div class="setting-item"><label class="setting-label">API Key</label><input type="password" class="setting-input" placeholder="Enter API key" id="apikey" value="${apiKeyValue}"></div><div class="setting-item api-test-row"><button class="btn btn-secondary" id="api-test-btn" type="button">Test Connection</button><div class="api-test-result" id="api-test-result"></div></div></div><div class="settings-group"><h3>Style</h3><div class="setting-item"><label class="setting-label">Theme</label><select class="setting-select" id="theme"></select></div><div class="setting-item"><label class="setting-label">UI Font Size</label><input type="number" class="setting-input" value="${uiFontSize}" id="ui-fontsize"></div><div class="setting-item"><label class="setting-label">Chat Font Size</label><input type="number" class="setting-input" value="${chatFontSize}" id="chat-fontsize"></div></div><div class="settings-group"><h3>Other</h3><div class="setting-item"><label><input type="checkbox" id="autosave" ${settings.auto_save_chats ? 'checked' : ''} > Auto-save Chats</label></div><div class="setting-item"><label><input type="checkbox" id="autoload" ${settings.auto_load_last_chat ? 'checked' : ''} > Auto-load Last Chat</label></div><div class="setting-item"><label><input type="checkbox" id="showtimestamps" ${showTimestamps ? 'checked' : ''} > Show Message Timestamps</label></div><div class="setting-item"><label><input type="checkbox" id="debugmode" ${debugMode ? 'checked' : ''} > Enable Debug Mode</label></div><div class="settings-actions"><button class="btn btn-primary" onclick="saveSettings()" style="margin-top:12px;">Save Settings</button><button class="btn btn-secondary" onclick="resetSettings()" style="margin-top:12px;">Restore Defaults</button></div></div></div>`;
			messagesContainer.appendChild(container);
			loadThemes(settings.theme || 'default');
			bindSettingsDraft();
			applyFontSizes(uiFontSize, chatFontSize);
		});
}

function bindSettingsDraft() {
	const temp = document.getElementById('temp');
	const tokens = document.getElementById('tokens');
	const provider = document.getElementById('provider');
	const apiBaseUrl = document.getElementById('api-base-url');
	const model = document.getElementById('model');
	const apiKey = document.getElementById('apikey');
	const apiTestBtn = document.getElementById('api-test-btn');
	const theme = document.getElementById('theme');
	const uiFontSize = document.getElementById('ui-fontsize');
	const chatFontSize = document.getElementById('chat-fontsize');
	const autosave = document.getElementById('autosave');
	const autoload = document.getElementById('autoload');
	const showTimestamps = document.getElementById('showtimestamps');
	const debugMode = document.getElementById('debugmode');

	if (temp) {
		temp.addEventListener('input', () => {
			settingsDraft.temperature = parseFloat(temp.value);
		});
	}
	if (tokens) {
		tokens.addEventListener('input', () => {
			settingsDraft.max_tokens = parseInt(tokens.value, 10);
		});
	}
	if (provider) {
		provider.addEventListener('change', () => {
			const previousProvider = settingsDraft.api_provider || 'openai';
			const nextProvider = provider.value;
			settingsDraft.api_provider = nextProvider;

			if (apiBaseUrl) {
				const currentUrl = apiBaseUrl.value.trim();
				const previousDefault = getDefaultApiBaseUrl(previousProvider);
				const nextDefault = getDefaultApiBaseUrl(nextProvider);
				if (!currentUrl || currentUrl === previousDefault) {
					apiBaseUrl.value = nextDefault;
					settingsDraft.api_base_url = nextDefault;
				}
			}

			if (model) {
				const currentModel = model.value.trim();
				const previousDefaultModel = getDefaultModel(previousProvider);
				const nextDefaultModel = getDefaultModel(nextProvider);
				if (!currentModel || currentModel === previousDefaultModel) {
					model.value = nextDefaultModel;
					settingsDraft.model = nextDefaultModel;
				}
				model.placeholder = nextProvider === 'localhost' ? 'Loaded model name in LM Studio' : 'Model name';
			}
		});
	}
	if (apiBaseUrl) {
		apiBaseUrl.addEventListener('input', () => {
			settingsDraft.api_base_url = apiBaseUrl.value;
		});
	}
	if (model) {
		model.addEventListener('input', () => {
			settingsDraft.model = model.value;
		});
	}
	if (apiKey) {
		apiKey.addEventListener('input', () => {
			settingsDraft.api_key = apiKey.value;
		});
	}
	if (theme) {
		theme.addEventListener('change', () => {
			settingsDraft.theme = theme.value || 'default';
		});
	}
	if (uiFontSize) {
		uiFontSize.addEventListener('input', () => {
			const value = parseInt(uiFontSize.value, 10);
			settingsDraft.ui_font_size = value;
			applyFontSizes(value, settingsDraft.chat_font_size ?? 12);
		});
	}
	if (chatFontSize) {
		chatFontSize.addEventListener('input', () => {
			const value = parseInt(chatFontSize.value, 10);
			settingsDraft.chat_font_size = value;
			applyFontSizes(settingsDraft.ui_font_size ?? 12, value);
		});
	}
	if (autosave) {
		autosave.addEventListener('change', () => {
			settingsDraft.auto_save_chats = autosave.checked;
		});
	}
	if (autoload) {
		autoload.addEventListener('change', () => {
			settingsDraft.auto_load_last_chat = autoload.checked;
		});
	}
	if (showTimestamps) {
		showTimestamps.addEventListener('change', () => {
			settingsDraft.show_message_timestamps = showTimestamps.checked;
			if (currentView === 'last-chat') {
				renderCurrentChat();
			}
		});
	}
	if (debugMode) {
		debugMode.addEventListener('change', () => {
			settingsDraft.debug_mode = debugMode.checked;
		});
	}
	if (apiTestBtn) {
		apiTestBtn.addEventListener('click', () => {
			testApiConnection();
		});
	}
}

function applyTheme(themeName) {
	if (!themeStylesheet) {
		return;
	}
	const safeTheme = themeName || 'default';
	themeStylesheet.setAttribute('href', `/Styles/${safeTheme}.css`);
}

function applyFontSizes(uiSize, chatSize) {
	const root = document.documentElement;
	if (!root) {
		return;
	}
	const uiValue = Number.isFinite(uiSize) ? uiSize : 12;
	const chatValue = Number.isFinite(chatSize) ? chatSize : uiValue;
	root.style.setProperty('--ui-font-size', `${uiValue}px`);
	root.style.setProperty('--chat-font-size', `${chatValue}px`);
}

function revertUnsavedSettings() {
	lastSavedSettings = lastSavedSettings || {};
	settingsDraft = { ...lastSavedSettings };
	lastSavedTheme = lastSavedSettings.theme || lastSavedTheme || 'default';
	applyTheme(lastSavedTheme);
	applyFontSizes(lastSavedSettings.ui_font_size, lastSavedSettings.chat_font_size);
}

function loadThemes(selectedTheme) {
	const themeSelect = document.getElementById('theme');
	if (!themeSelect) {
		return;
	}

	fetch('/api/themes')
		.then(r => r.json())
		.then(themes => {
			const normalized = Array.isArray(themes) ? themes : [];
			themeSelect.innerHTML = '';
			if (!normalized.includes('default')) {
				normalized.unshift('default');
			}
			normalized.forEach(theme => {
				const option = document.createElement('option');
				option.value = theme;
				option.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
				themeSelect.appendChild(option);
			});

			const targetTheme = selectedTheme && normalized.includes(selectedTheme) ? selectedTheme : 'default';
			themeSelect.value = targetTheme;
			applyTheme(targetTheme);
			themeSelect.onchange = () => applyTheme(themeSelect.value);
		});
}

function updateSettings(settings) {
	if (!settings) {
		return;
	}

	const temp = document.getElementById('temp');
	const tokens = document.getElementById('tokens');
	const provider = document.getElementById('provider');
	const apiBaseUrl = document.getElementById('api-base-url');
	const model = document.getElementById('model');
	const apiKey = document.getElementById('apikey');
	const theme = document.getElementById('theme');
	const uiFontSize = document.getElementById('ui-fontsize');
	const chatFontSize = document.getElementById('chat-fontsize');
	const autosave = document.getElementById('autosave');
	const autoload = document.getElementById('autoload');
	const showTimestamps = document.getElementById('showtimestamps');
	const debugMode = document.getElementById('debugmode');

	if (!temp || !tokens || !provider || !apiBaseUrl || !model || !apiKey || !theme || !uiFontSize || !chatFontSize || !autosave || !autoload || !showTimestamps || !debugMode) {
		showSettings();
		return;
	}

	temp.value = settings.temperature ?? 0.7;
	tokens.value = settings.max_tokens ?? 2048;
	const providerValue = settings.api_provider || 'localhost';
	const apiBaseUrlValue = settings.api_base_url || getDefaultApiBaseUrl(providerValue);
	model.value = settings.model ?? getDefaultModel(providerValue);
	model.placeholder = providerValue === 'localhost' ? 'Loaded model name in LM Studio' : 'Model name';
	apiBaseUrl.value = apiBaseUrlValue;
	apiKey.value = settings.api_key || '';
	uiFontSize.value = settings.ui_font_size ?? settings.font_size ?? 12;
	chatFontSize.value = settings.chat_font_size ?? settings.font_size ?? 12;
	autosave.checked = !!settings.auto_save_chats;
	autoload.checked = !!settings.auto_load_last_chat;
	showTimestamps.checked = settings.show_message_timestamps ?? true;
	debugMode.checked = !!settings.debug_mode;

	if (provider) {
		provider.value = providerValue;
	}

	if (theme) {
		loadThemes(settings.theme || 'default');
	}
	lastSavedTheme = settings.theme || 'default';
	lastSavedSettings = { ...settings, api_provider: providerValue, api_base_url: apiBaseUrlValue, show_message_timestamps: showTimestamps.checked, debug_mode: debugMode.checked };
	settingsDraft = { ...lastSavedSettings };
	applyTheme(lastSavedTheme);
	applyFontSizes(settings.ui_font_size ?? settings.font_size ?? 12, settings.chat_font_size ?? settings.font_size ?? 12);
}

function saveSettings() {
	const settings = {
		temperature: parseFloat(document.getElementById('temp').value),
		max_tokens: parseInt(document.getElementById('tokens').value, 10),
		api_provider: document.getElementById('provider').value,
		api_base_url: document.getElementById('api-base-url').value.trim(),
		api_key: document.getElementById('apikey').value,
		model: document.getElementById('model').value,
		theme: document.getElementById('theme').value || 'default',
		ui_font_size: parseInt(document.getElementById('ui-fontsize').value, 10),
		chat_font_size: parseInt(document.getElementById('chat-fontsize').value, 10),
		auto_save_chats: document.getElementById('autosave').checked,
		auto_load_last_chat: document.getElementById('autoload').checked,
		show_message_timestamps: document.getElementById('showtimestamps').checked,
		debug_mode: document.getElementById('debugmode').checked
	};
	fetch('/api/settings', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'update', settings: settings })
	})
		.then(r => r.json())
		.then(() => {
			lastSavedTheme = settings.theme || 'default';
			lastSavedSettings = { ...settings };
			settingsDraft = { ...settings };
			applyTheme(lastSavedTheme);
			applyFontSizes(settings.ui_font_size, settings.chat_font_size);
			updateBotPanel();
			alert('Settings saved!');
		});
}

function resetSettings() {
	if (confirm('Reset all settings to defaults? This cannot be undone.')) {
		fetch('/api/settings/reset', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		})
			.then(r => r.json())
			.then(data => {
				if (data) {
					alert('Settings restored to defaults!');
					updateSettings(data);
				} else {
					alert('Failed to reset settings');
				}
			});
	}
}

function initSettings() {
	fetch('/api/settings')
		.then(r => r.json())
		.then(settings => {
			lastSavedTheme = settings.theme || 'default';
			lastSavedSettings = { ...settings };
			settingsDraft = { ...settings };
			applyFontSizes(settings.ui_font_size ?? settings.font_size ?? 12, settings.chat_font_size ?? settings.font_size ?? 12);
			applyTheme(lastSavedTheme);
			loadDefaultPersona();
			autoLoadLastChat(settings);
			updateBotPanel();
		});
}
