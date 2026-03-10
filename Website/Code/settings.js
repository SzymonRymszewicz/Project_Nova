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
	if (provider === 'localhost') {
		return 'Localhost';
	}
	if (provider === 'openai') {
		return 'gpt-3.5-turbo';
	}
	return '';
}

function normalizeApiProvider(provider) {
	const normalized = `${provider || ''}`.trim().toLowerCase();
	if (normalized === 'openai' || normalized === 'localhost') {
		return normalized;
	}
	return 'localhost';
}

function getModelPlaceholder(provider) {
	if (provider === 'localhost') {
		return 'Loaded model name in LM Studio';
	}
	return 'Model name';
}

function renderLocalModelPicker(providerValue) {
	const modelInput = document.getElementById('model');
	const apiBaseUrl = document.getElementById('api-base-url');
	const apiKey = document.getElementById('apikey');
	if (!modelInput || !apiBaseUrl || !apiKey) {
		return;
	}

	const pickerWrap = document.getElementById('local-model-picker-wrap');
	if (pickerWrap) {
		pickerWrap.style.display = 'none';
	}
	apiBaseUrl.disabled = false;
	apiKey.disabled = false;
}

function resolveModelValue(model, provider) {
	const parsed = `${model ?? ''}`.trim();
	return parsed || getDefaultModel(provider);
}

function getGenerationDefaultSettings() {
	return {
		temperature: 0.7,
		max_tokens: 10000,
		max_response_length: 300,
		stop_strings: [],
		top_k: 40,
		enable_repeat_penalty: true,
		repeat_penalty: 1.0,
		enable_top_p_max: true,
		top_p_max: 0.95,
		enable_top_p_min: true,
		top_p_min: 0.05
	};
}

function parseStopStringsInput(rawValue) {
	if (!rawValue) {
		return [];
	}
	return `${rawValue}`
		.split(/\r?\n|,/)
		.map(value => value.trim())
		.filter(Boolean);
}

function normalizeStopStrings(value) {
	if (Array.isArray(value)) {
		return value
			.map(item => `${item}`.trim())
			.filter(Boolean);
	}
	if (typeof value === 'string') {
		return parseStopStringsInput(value);
	}
	return [];
}

function formatStopStringsForInput(value) {
	const normalized = normalizeStopStrings(value);
	return normalized.join('\n');
}

function getStyleDefaultSettings() {
	return {
		theme: 'default',
		ui_font_size: 14,
		chat_font_size: 20,
		chat_text_color_main: '#d5e2ff',
		chat_text_color_italic: '#aeb6cb',
		chat_text_color_bold: '#f2f4ff',
		chat_text_color_underlined: '#bdeed5',
		chat_text_color_quote: '#e39a35'
	};
}

function normalizeHexColor(value, fallback = '#d5e2ff') {
	const raw = `${value || ''}`.trim();
	if (/^#[0-9a-f]{6}$/i.test(raw)) {
		return raw.toLowerCase();
	}
	if (/^#[0-9a-f]{3}$/i.test(raw)) {
		const short = raw.slice(1).toLowerCase();
		return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`;
	}
	return fallback;
}

function applyChatTextColors(mainColor, italicColor, boldColor, underlinedColor, quoteColor) {
	const root = document.documentElement;
	if (!root) {
		return;
	}
	root.style.setProperty('--chat-text-main-color', normalizeHexColor(mainColor, '#d5e2ff'));
	root.style.setProperty('--chat-text-italic-color', normalizeHexColor(italicColor, '#aeb6cb'));
	root.style.setProperty('--chat-text-bold-color', normalizeHexColor(boldColor, '#f2f4ff'));
	root.style.setProperty('--chat-text-underlined-color', normalizeHexColor(underlinedColor, '#bdeed5'));
	root.style.setProperty('--chat-text-quote-color', normalizeHexColor(quoteColor, '#e39a35'));
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
			const temp = settings.temperature ?? 0.7;
			const tokens = settings.max_tokens ?? 10000;
			const maxResponseLength = settings.max_response_length ?? 300;
			const stopStrings = formatStopStringsForInput(settings.stop_strings ?? []);
			const topK = settings.top_k ?? 40;
			const enableRepeatPenalty = settings.enable_repeat_penalty ?? true;
			const repeatPenalty = settings.repeat_penalty ?? 1.0;
			const enableTopPMax = settings.enable_top_p_max ?? true;
			const topPMax = settings.top_p_max ?? 0.95;
			const enableTopPMin = settings.enable_top_p_min ?? true;
			const topPMin = settings.top_p_min ?? 0.05;
			const uiFontSize = settings.ui_font_size ?? settings.font_size ?? 12;
			const chatFontSize = settings.chat_font_size ?? settings.font_size ?? 20;
			const mainTextColor = normalizeHexColor(settings.chat_text_color_main, '#d5e2ff');
			const italicTextColor = normalizeHexColor(settings.chat_text_color_italic, '#aeb6cb');
			const boldTextColor = normalizeHexColor(settings.chat_text_color_bold, '#f2f4ff');
			const underlinedTextColor = normalizeHexColor(settings.chat_text_color_underlined, '#bdeed5');
			const quoteTextColor = normalizeHexColor(settings.chat_text_color_quote, '#e39a35');
			const providerValue = normalizeApiProvider(settings.api_provider || 'localhost');
			const apiBaseUrlValue = settings.api_base_url || getDefaultApiBaseUrl(providerValue);
			const modelValue = resolveModelValue(settings.model, providerValue);
			const apiKeyValue = settings.api_key || '';
			const showTimestamps = settings.show_message_timestamps ?? true;
			const showThinking = settings.show_thinking ?? false;
			const enableTextStreaming = settings.enable_text_streaming ?? true;
			const enableControlledStreaming = settings.enable_controlled_streaming ?? true;
			const controlledStreamingTps = Math.max(1, Math.min(100, parseInt(settings.controlled_streaming_tps ?? 15, 10) || 15));
			const debugMode = settings.debug_mode ?? false;
			const normalizedSettings = {
				...settings,
				api_provider: providerValue,
				api_base_url: apiBaseUrlValue,
				model: modelValue,
				api_key: apiKeyValue,
				ui_font_size: uiFontSize,
				chat_font_size: chatFontSize,
				max_response_length: maxResponseLength,
				stop_strings: normalizeStopStrings(settings.stop_strings ?? []),
				top_k: topK,
				enable_repeat_penalty: enableRepeatPenalty,
				repeat_penalty: repeatPenalty,
				enable_top_p_max: enableTopPMax,
				top_p_max: topPMax,
				enable_top_p_min: enableTopPMin,
				top_p_min: topPMin,
				chat_text_color_main: mainTextColor,
				chat_text_color_italic: italicTextColor,
				chat_text_color_bold: boldTextColor,
				chat_text_color_underlined: underlinedTextColor,
				chat_text_color_quote: quoteTextColor,
				show_message_timestamps: showTimestamps,
				show_thinking: showThinking,
				enable_text_streaming: enableTextStreaming,
				enable_controlled_streaming: enableControlledStreaming,
				controlled_streaming_tps: controlledStreamingTps,
				debug_mode: debugMode
			};
			lastSavedTheme = normalizedSettings.theme || 'default';
			lastSavedSettings = { ...normalizedSettings };
			settingsDraft = { ...normalizedSettings };
			const modelPlaceholder = getModelPlaceholder(providerValue);
			container.innerHTML = `
				<div class="settings-grid masonry-grid settings-layout-fixed">
					<div class="settings-group">
						<h3>Generation</h3>
						<div class="setting-item">
							<label class="setting-label setting-label-row" title="Controls randomness. Lower values are more focused; higher values are more creative.">Temperature <span class="setting-tooltip" title="Controls randomness. Lower values are more focused; higher values are more creative.">ⓘ</span><span class="setting-value" id="temp-value">${Number(temp).toFixed(2)}</span></label>
							<input type="range" class="setting-input" min="0.1" max="2.0" step="0.01" value="${temp}" id="temp" title="Controls randomness. Lower values are more focused; higher values are more creative.">
						</div>
						<div class="setting-item">
							<label class="setting-label setting-label-row" title="Maximum token budget reserved for prompt/context window.">Max Tokens (Context) <span class="setting-tooltip" title="Maximum token budget reserved for prompt/context window.">ⓘ</span></label>
							<input type="number" class="setting-input" value="${tokens}" id="tokens" min="1" step="1" title="Maximum token budget reserved for prompt/context window.">
						</div>
						<div class="setting-item">
							<label class="setting-label setting-label-row" title="Caps how long each assistant response can be.">Max Response Length <span class="setting-tooltip" title="Caps how long each assistant response can be.">ⓘ</span></label>
							<input type="number" class="setting-input" value="${maxResponseLength}" id="max-response-length" min="1" step="1" title="Caps how long each assistant response can be.">
						</div>
						<div class="setting-item">
							<label class="setting-label setting-label-row" title="Generation stops when any listed string appears.">Stop Strings <span class="setting-tooltip" title="Generation stops when any listed string appears.">ⓘ</span></label>
							<textarea class="setting-input" id="stop-strings" rows="3" placeholder="One stop string per line" title="Generation stops when any listed string appears.">${stopStrings}</textarea>
						</div>
						<div class="setting-item">
							<label class="setting-label setting-label-row" title="Limits candidate token pool size before sampling.">Top K Sampling <span class="setting-tooltip" title="Limits candidate token pool size before sampling.">ⓘ</span></label>
							<input type="number" class="setting-input" value="${topK}" id="top-k" min="1" step="1" title="Limits candidate token pool size before sampling.">
						</div>
						<div class="setting-item setting-with-toggle">
							<label class="setting-label setting-label-row" title="Penalizes repeating the same tokens/phrases.">Repeat Penalty <span class="setting-tooltip" title="Penalizes repeating the same tokens/phrases.">ⓘ</span></label>
							<label class="setting-toggle"><input type="checkbox" id="enable-repeat-penalty" ${enableRepeatPenalty ? 'checked' : ''}> Enabled</label>
							<input type="number" class="setting-input" value="${repeatPenalty}" id="repeat-penalty" min="0" max="3" step="0.01" ${enableRepeatPenalty ? '' : 'disabled'} title="Penalizes repeating the same tokens/phrases.">
						</div>
						<div class="setting-item setting-with-toggle">
							<label class="setting-label setting-label-row" title="Upper probability threshold used for nucleus-style filtering.">Max Top P Sampling <span class="setting-tooltip" title="Upper probability threshold used for nucleus-style filtering.">ⓘ</span></label>
							<label class="setting-toggle"><input type="checkbox" id="enable-top-p-max" ${enableTopPMax ? 'checked' : ''}> Enabled</label>
							<input type="number" class="setting-input" value="${topPMax}" id="top-p-max" min="0" max="1" step="0.01" ${enableTopPMax ? '' : 'disabled'} title="Upper probability threshold used for nucleus-style filtering.">
						</div>
						<div class="setting-item setting-with-toggle">
							<label class="setting-label setting-label-row" title="Lower probability threshold floor used for token filtering.">Min Top P Sampling <span class="setting-tooltip" title="Lower probability threshold floor used for token filtering.">ⓘ</span></label>
							<label class="setting-toggle"><input type="checkbox" id="enable-top-p-min" ${enableTopPMin ? 'checked' : ''}> Enabled</label>
							<input type="number" class="setting-input" value="${topPMin}" id="top-p-min" min="0" max="1" step="0.01" ${enableTopPMin ? '' : 'disabled'} title="Lower probability threshold floor used for token filtering.">
						</div>
					</div>
					<div class="settings-group">
						<h3>API Client</h3>
						<div class="setting-item"><label class="setting-label">API Provider</label><select class="setting-select" id="provider"><option value="localhost" ${providerValue === 'localhost' ? 'selected' : ''}>Localhost</option><option value="openai" ${providerValue === 'openai' ? 'selected' : ''}>OpenAI</option></select></div>
						<div class="setting-item"><label class="setting-label">API Base URL</label><input type="text" class="setting-input" value="${apiBaseUrlValue}" id="api-base-url"></div>
						<div class="setting-item"><label class="setting-label">Model</label><input type="text" class="setting-input" value="${modelValue}" placeholder="${modelPlaceholder}" id="model"></div>
						<div class="setting-item"><label class="setting-label">API Key</label><input type="password" class="setting-input" placeholder="Enter API key" id="apikey" value="${apiKeyValue}"></div>
						<div class="setting-item api-test-row"><button class="btn btn-secondary" id="api-test-btn" type="button">Test Connection</button><div class="api-test-result" id="api-test-result"></div></div>
					</div>
					<div class="settings-group">
						<h3>Style</h3>
						<div class="setting-item"><label class="setting-label">Theme</label><select class="setting-select" id="theme"></select></div>
						<div class="setting-item"><label class="setting-label">UI Size</label><input type="number" class="setting-input" value="${uiFontSize}" id="ui-fontsize"></div>
						<div class="setting-item"><label class="setting-label">Chat Font Size</label><input type="number" class="setting-input" value="${chatFontSize}" id="chat-fontsize"></div>
						<div class="setting-item"><label class="setting-label"><span class="chat-style-preview chat-style-preview-main">Main Text</span></label><div class="chat-color-setting-row"><input type="color" class="chat-color-picker" id="chat-text-color-main" value="${mainTextColor}"><input type="text" class="setting-input chat-color-hex" id="chat-text-color-main-hex" value="${mainTextColor}" maxlength="7" placeholder="#rrggbb"></div></div>
						<div class="setting-item"><label class="setting-label"><span class="chat-style-preview chat-style-preview-italic">Italics Text</span></label><div class="chat-color-setting-row"><input type="color" class="chat-color-picker" id="chat-text-color-italic" value="${italicTextColor}"><input type="text" class="setting-input chat-color-hex" id="chat-text-color-italic-hex" value="${italicTextColor}" maxlength="7" placeholder="#rrggbb"></div></div>
						<div class="setting-item"><label class="setting-label"><span class="chat-style-preview chat-style-preview-bold">Bold Text</span></label><div class="chat-color-setting-row"><input type="color" class="chat-color-picker" id="chat-text-color-bold" value="${boldTextColor}"><input type="text" class="setting-input chat-color-hex" id="chat-text-color-bold-hex" value="${boldTextColor}" maxlength="7" placeholder="#rrggbb"></div></div>
						<div class="setting-item"><label class="setting-label"><span class="chat-style-preview chat-style-preview-underlined">Underlined Text</span></label><div class="chat-color-setting-row"><input type="color" class="chat-color-picker" id="chat-text-color-underlined" value="${underlinedTextColor}"><input type="text" class="setting-input chat-color-hex" id="chat-text-color-underlined-hex" value="${underlinedTextColor}" maxlength="7" placeholder="#rrggbb"></div></div>
						<div class="setting-item"><label class="setting-label"><span class="chat-style-preview chat-style-preview-quote">"Quote Text"</span></label><div class="chat-color-setting-row"><input type="color" class="chat-color-picker" id="chat-text-color-quote" value="${quoteTextColor}"><input type="text" class="setting-input chat-color-hex" id="chat-text-color-quote-hex" value="${quoteTextColor}" maxlength="7" placeholder="#rrggbb"></div></div>
					</div>
					<div class="settings-group">
						<h3>Other</h3>
						<div class="setting-item"><label><input type="checkbox" id="autosave" ${settings.auto_save_chats ? 'checked' : ''}> Auto-save Chats?</label></div>
						<div class="setting-item"><label><input type="checkbox" id="autoload" ${settings.auto_load_last_chat ? 'checked' : ''}> Auto-load Last Chat?</label></div>
						<div class="setting-item"><label><input type="checkbox" id="showtimestamps" ${showTimestamps ? 'checked' : ''}> Show Message Timestamps?</label></div>
						<!-- NOT WORKING<div class="setting-item"><label><input type="checkbox" id="showthinking" ${showThinking ? 'checked' : ''}> Show thinking?</label></div> -->
						<div class="setting-item"><label><input type="checkbox" id="textstreaming" ${enableTextStreaming ? 'checked' : ''}> Enable text streaming?</label></div>
						<div class="setting-item" id="controlledstreaming-wrap" style="display:${enableTextStreaming ? 'block' : 'none'};"><label><input type="checkbox" id="controlledstreaming" ${enableControlledStreaming ? 'checked' : ''}> Enable controlled streaming?</label></div>
						<div class="setting-item" id="controlledstreamingrate-wrap" style="display:${enableTextStreaming && enableControlledStreaming ? 'block' : 'none'};"><label class="setting-label setting-label-row">Streaming speed <span class="setting-value" id="controlledstreamingrate-value">${controlledStreamingTps} t/s</span></label><input type="range" class="setting-input" id="controlledstreamingrate" min="1" max="100" step="1" value="${controlledStreamingTps}"></div>
						<div class="setting-item"><label><input type="checkbox" id="debugmode" ${debugMode ? 'checked' : ''}> Enable Debug/Dev Mode?</label></div>
						<div class="settings-actions"><button class="btn btn-primary" onclick="saveSettings()">Save Settings</button><button class="btn btn-secondary" onclick="resetSettings()">Restore Defaults</button></div>
					</div>
				</div>`;
			messagesContainer.appendChild(container);
			makeSectionsCollapsible(container, '.settings-group', 'settings');
			scheduleMasonryRefresh(container);
			loadThemes(settings.theme || 'default');
			attachScopedRestoreButtons(container);
			bindSettingsDraft();
			renderLocalModelPicker(providerValue);
			applyFontSizes(uiFontSize, chatFontSize);
		});
}

function attachScopedRestoreButtons(container) {
	if (!container) {
		return;
	}
	const getGroupTitle = (group) => {
		if (!group) {
			return '';
		}
		const titleEl = group.querySelector('.section-collapsible-title') || group.querySelector('h3');
		const raw = (titleEl ? titleEl.textContent : '').toLowerCase();
		return raw.replace(/[^a-z\s]/g, '').trim();
	};
	const groups = Array.from(container.querySelectorAll('.settings-group'));
	const generationGroup = groups.find(group => {
		const title = getGroupTitle(group);
		return title === 'generation';
	});
	const styleGroup = groups.find(group => {
		const title = getGroupTitle(group);
		return title === 'style';
	});

	if (generationGroup && !generationGroup.querySelector('#restore-generation-btn')) {
		const generationBody = generationGroup.querySelector('.section-collapsible-body') || generationGroup;
		const actions = document.createElement('div');
		actions.className = 'settings-actions';
		actions.innerHTML = '<button class="btn btn-primary" id="save-generation-btn" type="button">Save Generation</button><button class="btn btn-secondary" id="restore-generation-btn" type="button">Restore Generation</button>';
		generationBody.appendChild(actions);
	}

	if (styleGroup && !styleGroup.querySelector('#restore-style-btn')) {
		const styleBody = styleGroup.querySelector('.section-collapsible-body') || styleGroup;
		const actions = document.createElement('div');
		actions.className = 'settings-actions';
		actions.innerHTML = '<button class="btn btn-primary" id="save-style-btn" type="button">Save Style</button><button class="btn btn-secondary" id="restore-style-btn" type="button">Restore Style</button>';
		styleBody.appendChild(actions);
	}
	scheduleMasonryRefresh(container);
}

function bindSettingsDraft() {
	const temp = document.getElementById('temp');
	const tempValue = document.getElementById('temp-value');
	const tokens = document.getElementById('tokens');
	const maxResponseLength = document.getElementById('max-response-length');
	const stopStrings = document.getElementById('stop-strings');
	const topK = document.getElementById('top-k');
	const enableRepeatPenalty = document.getElementById('enable-repeat-penalty');
	const repeatPenalty = document.getElementById('repeat-penalty');
	const enableTopPMax = document.getElementById('enable-top-p-max');
	const topPMax = document.getElementById('top-p-max');
	const enableTopPMin = document.getElementById('enable-top-p-min');
	const topPMin = document.getElementById('top-p-min');
	const provider = document.getElementById('provider');
	const apiBaseUrl = document.getElementById('api-base-url');
	const model = document.getElementById('model');
	const apiKey = document.getElementById('apikey');
	const apiTestBtn = document.getElementById('api-test-btn');
	const theme = document.getElementById('theme');
	const uiFontSize = document.getElementById('ui-fontsize');
	const chatFontSize = document.getElementById('chat-fontsize');
	const chatTextColorMain = document.getElementById('chat-text-color-main');
	const chatTextColorMainHex = document.getElementById('chat-text-color-main-hex');
	const chatTextColorItalic = document.getElementById('chat-text-color-italic');
	const chatTextColorItalicHex = document.getElementById('chat-text-color-italic-hex');
	const chatTextColorBold = document.getElementById('chat-text-color-bold');
	const chatTextColorBoldHex = document.getElementById('chat-text-color-bold-hex');
	const chatTextColorUnderlined = document.getElementById('chat-text-color-underlined');
	const chatTextColorUnderlinedHex = document.getElementById('chat-text-color-underlined-hex');
	const chatTextColorQuote = document.getElementById('chat-text-color-quote');
	const chatTextColorQuoteHex = document.getElementById('chat-text-color-quote-hex');
	const autosave = document.getElementById('autosave');
	const autoload = document.getElementById('autoload');
	const showTimestamps = document.getElementById('showtimestamps');
	const showThinking = document.getElementById('showthinking');
	const textStreaming = document.getElementById('textstreaming');
	const controlledStreaming = document.getElementById('controlledstreaming');
	const controlledStreamingWrap = document.getElementById('controlledstreaming-wrap');
	const controlledStreamingRateWrap = document.getElementById('controlledstreamingrate-wrap');
	const controlledStreamingRate = document.getElementById('controlledstreamingrate');
	const controlledStreamingRateValue = document.getElementById('controlledstreamingrate-value');
	const debugMode = document.getElementById('debugmode');
	const saveGenerationBtn = document.getElementById('save-generation-btn');
	const saveStyleBtn = document.getElementById('save-style-btn');
	const restoreGenerationBtn = document.getElementById('restore-generation-btn');
	const restoreStyleBtn = document.getElementById('restore-style-btn');

	if (temp) {
		temp.addEventListener('input', () => {
			settingsDraft.temperature = parseFloat(temp.value);
			if (tempValue) {
				tempValue.textContent = Number(settingsDraft.temperature).toFixed(2);
			}
		});
	}
	if (tokens) {
		tokens.addEventListener('input', () => {
			settingsDraft.max_tokens = parseInt(tokens.value, 10);
		});
	}
	if (maxResponseLength) {
		maxResponseLength.addEventListener('input', () => {
			settingsDraft.max_response_length = parseInt(maxResponseLength.value, 10);
		});
	}
	if (stopStrings) {
		stopStrings.addEventListener('input', () => {
			settingsDraft.stop_strings = parseStopStringsInput(stopStrings.value);
		});
	}
	if (topK) {
		topK.addEventListener('input', () => {
			settingsDraft.top_k = parseInt(topK.value, 10);
		});
	}
	if (enableRepeatPenalty && repeatPenalty) {
		enableRepeatPenalty.addEventListener('change', () => {
			repeatPenalty.disabled = !enableRepeatPenalty.checked;
			settingsDraft.enable_repeat_penalty = enableRepeatPenalty.checked;
		});
		repeatPenalty.addEventListener('input', () => {
			settingsDraft.repeat_penalty = parseFloat(repeatPenalty.value);
		});
	}
	if (enableTopPMax && topPMax) {
		enableTopPMax.addEventListener('change', () => {
			topPMax.disabled = !enableTopPMax.checked;
			settingsDraft.enable_top_p_max = enableTopPMax.checked;
		});
		topPMax.addEventListener('input', () => {
			settingsDraft.top_p_max = parseFloat(topPMax.value);
		});
	}
	if (enableTopPMin && topPMin) {
		enableTopPMin.addEventListener('change', () => {
			topPMin.disabled = !enableTopPMin.checked;
			settingsDraft.enable_top_p_min = enableTopPMin.checked;
		});
		topPMin.addEventListener('input', () => {
			settingsDraft.top_p_min = parseFloat(topPMin.value);
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
				model.placeholder = getModelPlaceholder(nextProvider);
			}

			renderLocalModelPicker(nextProvider);
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

	const applyDraftChatTextColors = () => {
		applyChatTextColors(
			settingsDraft.chat_text_color_main,
			settingsDraft.chat_text_color_italic,
			settingsDraft.chat_text_color_bold,
			settingsDraft.chat_text_color_underlined,
			settingsDraft.chat_text_color_quote
		);
	};

	const bindColorSettingPair = (pickerEl, hexEl, key, fallback) => {
		if (!pickerEl || !hexEl) {
			return;
		}
		const syncValue = (raw, commitToPicker = true) => {
			const normalized = normalizeHexColor(raw, fallback);
			hexEl.value = normalized;
			if (commitToPicker) {
				pickerEl.value = normalized;
			}
			settingsDraft[key] = normalized;
			applyDraftChatTextColors();
		};

		pickerEl.addEventListener('input', () => {
			syncValue(pickerEl.value, false);
		});

		hexEl.addEventListener('input', () => {
			const raw = `${hexEl.value || ''}`.trim();
			if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) {
				return;
			}
			syncValue(raw, true);
		});

		hexEl.addEventListener('blur', () => {
			syncValue(hexEl.value, true);
		});
	};

	bindColorSettingPair(chatTextColorMain, chatTextColorMainHex, 'chat_text_color_main', '#d5e2ff');
	bindColorSettingPair(chatTextColorItalic, chatTextColorItalicHex, 'chat_text_color_italic', '#aeb6cb');
	bindColorSettingPair(chatTextColorBold, chatTextColorBoldHex, 'chat_text_color_bold', '#f2f4ff');
	bindColorSettingPair(chatTextColorUnderlined, chatTextColorUnderlinedHex, 'chat_text_color_underlined', '#bdeed5');
	bindColorSettingPair(chatTextColorQuote, chatTextColorQuoteHex, 'chat_text_color_quote', '#e39a35');
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
	if (showThinking) {
		showThinking.addEventListener('change', () => {
			settingsDraft.show_thinking = showThinking.checked;
			if (currentView === 'last-chat') {
				renderCurrentChat();
			}
		});
	}
	const refreshControlledStreamingVisibility = () => {
		if (controlledStreamingWrap) {
			controlledStreamingWrap.style.display = textStreaming && textStreaming.checked ? 'block' : 'none';
		}
		if (controlledStreamingRateWrap) {
			const showRate = !!(textStreaming && textStreaming.checked && controlledStreaming && controlledStreaming.checked);
			controlledStreamingRateWrap.style.display = showRate ? 'block' : 'none';
		}
	};
	if (textStreaming) {
		textStreaming.addEventListener('change', () => {
			settingsDraft.enable_text_streaming = textStreaming.checked;
			refreshControlledStreamingVisibility();
		});
	}
	if (controlledStreaming) {
		controlledStreaming.addEventListener('change', () => {
			settingsDraft.enable_controlled_streaming = controlledStreaming.checked;
			refreshControlledStreamingVisibility();
		});
	}
	if (controlledStreamingRate) {
		controlledStreamingRate.addEventListener('input', () => {
			const next = Math.max(1, Math.min(100, parseInt(controlledStreamingRate.value, 10) || 15));
			controlledStreamingRate.value = `${next}`;
			settingsDraft.controlled_streaming_tps = next;
			if (controlledStreamingRateValue) {
				controlledStreamingRateValue.textContent = `${next} t/s`;
			}
		});
	}
	refreshControlledStreamingVisibility();
	if (debugMode) {
		debugMode.addEventListener('change', () => {
			settingsDraft.debug_mode = debugMode.checked;
			updateDevTabVisibility();
		});
	}
	if (apiTestBtn) {
		apiTestBtn.addEventListener('click', () => {
			testApiConnection();
		});
	}
	if (saveGenerationBtn) {
		saveGenerationBtn.addEventListener('click', () => {
			saveGenerationSettingsScoped();
		});
	}
	if (saveStyleBtn) {
		saveStyleBtn.addEventListener('click', () => {
			saveStyleSettingsScoped();
		});
	}
	if (restoreGenerationBtn) {
		restoreGenerationBtn.addEventListener('click', () => {
			restoreGenerationSettings({ showAlert: true, askConfirmation: true });
		});
	}
	if (restoreStyleBtn) {
		restoreStyleBtn.addEventListener('click', () => {
			restoreStyleSettings({ showAlert: true, askConfirmation: true });
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
	applyChatTextColors(
		lastSavedSettings.chat_text_color_main,
		lastSavedSettings.chat_text_color_italic,
		lastSavedSettings.chat_text_color_bold,
		lastSavedSettings.chat_text_color_underlined,
		lastSavedSettings.chat_text_color_quote
	);
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

function saveGenerationSettingsScoped() {
	const tempInput = document.getElementById('temp');
	const tokensInput = document.getElementById('tokens');
	const maxResponseLengthInput = document.getElementById('max-response-length');
	const stopStringsInput = document.getElementById('stop-strings');
	const topKInput = document.getElementById('top-k');
	const enableRepeatPenaltyInput = document.getElementById('enable-repeat-penalty');
	const repeatPenaltyInput = document.getElementById('repeat-penalty');
	const enableTopPMaxInput = document.getElementById('enable-top-p-max');
	const topPMaxInput = document.getElementById('top-p-max');
	const enableTopPMinInput = document.getElementById('enable-top-p-min');
	const topPMinInput = document.getElementById('top-p-min');
	if (!tempInput || !tokensInput || !maxResponseLengthInput || !stopStringsInput || !topKInput || !enableRepeatPenaltyInput || !repeatPenaltyInput || !enableTopPMaxInput || !topPMaxInput || !enableTopPMinInput || !topPMinInput) {
		return Promise.resolve();
	}
	const payload = {
		temperature: parseFloat(tempInput.value),
		max_tokens: parseInt(tokensInput.value, 10),
		max_response_length: parseInt(maxResponseLengthInput.value, 10),
		stop_strings: parseStopStringsInput(stopStringsInput.value),
		top_k: parseInt(topKInput.value, 10),
		enable_repeat_penalty: enableRepeatPenaltyInput.checked,
		repeat_penalty: parseFloat(repeatPenaltyInput.value),
		enable_top_p_max: enableTopPMaxInput.checked,
		top_p_max: parseFloat(topPMaxInput.value),
		enable_top_p_min: enableTopPMinInput.checked,
		top_p_min: parseFloat(topPMinInput.value)
	};
	return saveSettingsPatch(payload, true);
}

function saveStyleSettingsScoped() {
	const themeInput = document.getElementById('theme');
	const uiFontSizeInput = document.getElementById('ui-fontsize');
	const chatFontSizeInput = document.getElementById('chat-fontsize');
	if (!themeInput || !uiFontSizeInput || !chatFontSizeInput) {
		return Promise.resolve();
	}
	const payload = {
		theme: themeInput.value || 'default',
		ui_font_size: parseInt(uiFontSizeInput.value, 10),
		chat_font_size: parseInt(chatFontSizeInput.value, 10),
		chat_text_color_main: normalizeHexColor(document.getElementById('chat-text-color-main-hex')?.value, '#d5e2ff'),
		chat_text_color_italic: normalizeHexColor(document.getElementById('chat-text-color-italic-hex')?.value, '#aeb6cb'),
		chat_text_color_bold: normalizeHexColor(document.getElementById('chat-text-color-bold-hex')?.value, '#f2f4ff'),
		chat_text_color_underlined: normalizeHexColor(document.getElementById('chat-text-color-underlined-hex')?.value, '#bdeed5'),
		chat_text_color_quote: normalizeHexColor(document.getElementById('chat-text-color-quote-hex')?.value, '#e39a35')
	};
	return saveSettingsPatch(payload, true);
}

function normalizeAndApplySettingsState(settings) {
	const normalized = {
		...lastSavedSettings,
		...settings
	};
	const providerValue = normalizeApiProvider(normalized.api_provider || 'localhost');
	normalized.api_provider = providerValue;
	normalized.api_base_url = normalized.api_base_url || getDefaultApiBaseUrl(providerValue);
	normalized.model = resolveModelValue(normalized.model, providerValue);
	normalized.theme = normalized.theme || 'default';
	normalized.show_message_timestamps = normalized.show_message_timestamps ?? true;
	normalized.show_thinking = normalized.show_thinking ?? false;
	normalized.enable_text_streaming = normalized.enable_text_streaming ?? true;
	normalized.enable_controlled_streaming = normalized.enable_controlled_streaming ?? true;
	normalized.controlled_streaming_tps = Math.max(1, Math.min(100, parseInt(normalized.controlled_streaming_tps ?? 15, 10) || 15));
	normalized.debug_mode = normalized.debug_mode ?? false;
	normalized.ui_font_size = normalized.ui_font_size ?? normalized.font_size ?? 12;
	normalized.chat_font_size = normalized.chat_font_size ?? normalized.font_size ?? 20;
	normalized.chat_text_color_main = normalizeHexColor(normalized.chat_text_color_main, '#d5e2ff');
	normalized.chat_text_color_italic = normalizeHexColor(normalized.chat_text_color_italic, '#aeb6cb');
	normalized.chat_text_color_bold = normalizeHexColor(normalized.chat_text_color_bold, '#f2f4ff');
	normalized.chat_text_color_underlined = normalizeHexColor(normalized.chat_text_color_underlined, '#bdeed5');
	normalized.chat_text_color_quote = normalizeHexColor(normalized.chat_text_color_quote, '#e39a35');
	normalized.temperature = normalized.temperature ?? 0.7;
	normalized.max_tokens = normalized.max_tokens ?? 10000;
	normalized.max_response_length = normalized.max_response_length ?? 300;
	normalized.stop_strings = normalizeStopStrings(normalized.stop_strings ?? []);
	normalized.top_k = normalized.top_k ?? 40;
	normalized.enable_repeat_penalty = normalized.enable_repeat_penalty ?? true;
	normalized.repeat_penalty = normalized.repeat_penalty ?? 1.0;
	normalized.enable_top_p_max = normalized.enable_top_p_max ?? true;
	normalized.top_p_max = normalized.top_p_max ?? 0.95;
	normalized.enable_top_p_min = normalized.enable_top_p_min ?? true;
	normalized.top_p_min = normalized.top_p_min ?? 0.05;

	lastSavedTheme = normalized.theme;
	lastSavedSettings = { ...normalized };
	settingsDraft = { ...normalized };
	applyTheme(lastSavedTheme);
	applyFontSizes(normalized.ui_font_size, normalized.chat_font_size);
	applyChatTextColors(
		normalized.chat_text_color_main,
		normalized.chat_text_color_italic,
		normalized.chat_text_color_bold,
		normalized.chat_text_color_underlined,
		normalized.chat_text_color_quote
	);
	window.dispatchEvent(new CustomEvent('nova:settings-updated', { detail: { ...normalized } }));
	updateBotPanel();
}

function saveSettingsPatch(settingsPatch, showAlert = true) {
	const payload = { ...settingsPatch };
	return fetch('/api/settings', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'update', settings: payload })
	})
		.then(async r => {
			let data = null;
			try {
				data = await r.json();
			} catch (_error) {
				data = null;
			}
			if (!r.ok) {
				const statusText = `${r.status} ${r.statusText || ''}`.trim();
				throw new Error(`Settings API request failed (${statusText}).`);
			}
			if (!data || data.success !== true) {
				throw new Error('Settings could not be saved by the backend.');
			}
			return data;
		})
		.then(() => {
			normalizeAndApplySettingsState(payload);
			if (currentView === 'settings') {
				// Refresh fields and ensure listeners stay bound after save.
				updateSettings({ ...lastSavedSettings }, { showSettingsOnMissing: false });
			}
			if (showAlert) {
				alert('Settings saved!');
			}
		})
		.catch(error => {
			const message = (error && error.message) ? error.message : 'Unknown settings save error.';
			alert(`Failed to save settings: ${message}`);
			throw error;
		});
}

function restoreGenerationSettings(options = {}) {
	const showAlert = options.showAlert ?? true;
	const askConfirmation = options.askConfirmation ?? true;
	if (askConfirmation && !confirm('Restore Generation settings to defaults?')) {
		return Promise.resolve();
	}
	const payload = getGenerationDefaultSettings();
	return saveSettingsPatch(payload, false)
		.then(() => {
			if (currentView === 'settings') {
				updateSettings({ ...lastSavedSettings, ...payload }, { showSettingsOnMissing: false });
			}
			if (showAlert) {
				alert('Generation settings restored to defaults!');
			}
		});
}

function restoreStyleSettings(options = {}) {
	const showAlert = options.showAlert ?? true;
	const askConfirmation = options.askConfirmation ?? true;
	if (askConfirmation && !confirm('Restore Style settings to defaults?')) {
		return Promise.resolve();
	}
	const payload = getStyleDefaultSettings();
	return saveSettingsPatch(payload, false)
		.then(() => {
			if (currentView === 'settings') {
				updateSettings({ ...lastSavedSettings, ...payload }, { showSettingsOnMissing: false });
			}
			if (showAlert) {
				alert('Style settings restored to defaults!');
			}
		});
}

function updateSettings(settings, options = {}) {
	if (!settings) {
		return;
	}
	const showSettingsOnMissing = options.showSettingsOnMissing ?? true;

	const temp = document.getElementById('temp');
	const tempValue = document.getElementById('temp-value');
	const tokens = document.getElementById('tokens');
	const maxResponseLength = document.getElementById('max-response-length');
	const stopStrings = document.getElementById('stop-strings');
	const topK = document.getElementById('top-k');
	const enableRepeatPenalty = document.getElementById('enable-repeat-penalty');
	const repeatPenalty = document.getElementById('repeat-penalty');
	const enableTopPMax = document.getElementById('enable-top-p-max');
	const topPMax = document.getElementById('top-p-max');
	const enableTopPMin = document.getElementById('enable-top-p-min');
	const topPMin = document.getElementById('top-p-min');
	const provider = document.getElementById('provider');
	const apiBaseUrl = document.getElementById('api-base-url');
	const model = document.getElementById('model');
	const apiKey = document.getElementById('apikey');
	const theme = document.getElementById('theme');
	const uiFontSize = document.getElementById('ui-fontsize');
	const chatFontSize = document.getElementById('chat-fontsize');
	const chatTextColorMain = document.getElementById('chat-text-color-main');
	const chatTextColorMainHex = document.getElementById('chat-text-color-main-hex');
	const chatTextColorItalic = document.getElementById('chat-text-color-italic');
	const chatTextColorItalicHex = document.getElementById('chat-text-color-italic-hex');
	const chatTextColorBold = document.getElementById('chat-text-color-bold');
	const chatTextColorBoldHex = document.getElementById('chat-text-color-bold-hex');
	const chatTextColorUnderlined = document.getElementById('chat-text-color-underlined');
	const chatTextColorUnderlinedHex = document.getElementById('chat-text-color-underlined-hex');
	const chatTextColorQuote = document.getElementById('chat-text-color-quote');
	const chatTextColorQuoteHex = document.getElementById('chat-text-color-quote-hex');
	const autosave = document.getElementById('autosave');
	const autoload = document.getElementById('autoload');
	const showTimestamps = document.getElementById('showtimestamps');
	const showThinking = document.getElementById('showthinking');
	const textStreaming = document.getElementById('textstreaming');
	const controlledStreaming = document.getElementById('controlledstreaming');
	const controlledStreamingWrap = document.getElementById('controlledstreaming-wrap');
	const controlledStreamingRateWrap = document.getElementById('controlledstreamingrate-wrap');
	const controlledStreamingRate = document.getElementById('controlledstreamingrate');
	const controlledStreamingRateValue = document.getElementById('controlledstreamingrate-value');
	const debugMode = document.getElementById('debugmode');

	if (!temp || !tokens || !maxResponseLength || !stopStrings || !topK || !enableRepeatPenalty || !repeatPenalty || !enableTopPMax || !topPMax || !enableTopPMin || !topPMin || !provider || !apiBaseUrl || !model || !apiKey || !theme || !uiFontSize || !chatFontSize || !chatTextColorMain || !chatTextColorMainHex || !chatTextColorItalic || !chatTextColorItalicHex || !chatTextColorBold || !chatTextColorBoldHex || !chatTextColorUnderlined || !chatTextColorUnderlinedHex || !chatTextColorQuote || !chatTextColorQuoteHex || !autosave || !autoload || !showTimestamps || !showThinking || !textStreaming || !controlledStreaming || !controlledStreamingRate || !debugMode) {
		normalizeAndApplySettingsState(settings);
		if (showSettingsOnMissing) {
			showSettings();
		}
		return;
	}

	temp.value = settings.temperature ?? 0.7;
	if (tempValue) {
		tempValue.textContent = Number(temp.value).toFixed(2);
	}
	tokens.value = settings.max_tokens ?? 10000;
	maxResponseLength.value = settings.max_response_length ?? 300;
	stopStrings.value = formatStopStringsForInput(settings.stop_strings ?? []);
	topK.value = settings.top_k ?? 40;
	enableRepeatPenalty.checked = settings.enable_repeat_penalty ?? true;
	repeatPenalty.value = settings.repeat_penalty ?? 1.0;
	repeatPenalty.disabled = !enableRepeatPenalty.checked;
	enableTopPMax.checked = settings.enable_top_p_max ?? true;
	topPMax.value = settings.top_p_max ?? 0.95;
	topPMax.disabled = !enableTopPMax.checked;
	enableTopPMin.checked = settings.enable_top_p_min ?? true;
	topPMin.value = settings.top_p_min ?? 0.05;
	topPMin.disabled = !enableTopPMin.checked;
	const providerValue = normalizeApiProvider(settings.api_provider || 'localhost');
	const apiBaseUrlValue = settings.api_base_url || getDefaultApiBaseUrl(providerValue);
	model.value = resolveModelValue(settings.model, providerValue);
	model.placeholder = getModelPlaceholder(providerValue);
	apiBaseUrl.value = apiBaseUrlValue;
	apiKey.value = settings.api_key || '';
	uiFontSize.value = settings.ui_font_size ?? settings.font_size ?? 12;
	chatFontSize.value = settings.chat_font_size ?? settings.font_size ?? 20;
	chatTextColorMain.value = normalizeHexColor(settings.chat_text_color_main, '#d5e2ff');
	chatTextColorMainHex.value = chatTextColorMain.value;
	chatTextColorItalic.value = normalizeHexColor(settings.chat_text_color_italic, '#aeb6cb');
	chatTextColorItalicHex.value = chatTextColorItalic.value;
	chatTextColorBold.value = normalizeHexColor(settings.chat_text_color_bold, '#f2f4ff');
	chatTextColorBoldHex.value = chatTextColorBold.value;
	chatTextColorUnderlined.value = normalizeHexColor(settings.chat_text_color_underlined, '#bdeed5');
	chatTextColorUnderlinedHex.value = chatTextColorUnderlined.value;
	chatTextColorQuote.value = normalizeHexColor(settings.chat_text_color_quote, '#e39a35');
	chatTextColorQuoteHex.value = chatTextColorQuote.value;
	autosave.checked = !!settings.auto_save_chats;
	autoload.checked = !!settings.auto_load_last_chat;
	showTimestamps.checked = settings.show_message_timestamps ?? true;
	showThinking.checked = !!settings.show_thinking;
	textStreaming.checked = !!settings.enable_text_streaming;
	controlledStreaming.checked = !!settings.enable_controlled_streaming;
	controlledStreamingRate.value = `${Math.max(1, Math.min(100, parseInt(settings.controlled_streaming_tps ?? 15, 10) || 15))}`;
	if (controlledStreamingRateValue) {
		controlledStreamingRateValue.textContent = `${controlledStreamingRate.value} t/s`;
	}
	if (controlledStreamingWrap) {
		controlledStreamingWrap.style.display = textStreaming.checked ? 'block' : 'none';
	}
	if (controlledStreamingRateWrap) {
		controlledStreamingRateWrap.style.display = (textStreaming.checked && controlledStreaming.checked) ? 'block' : 'none';
	}
	debugMode.checked = !!settings.debug_mode;

	if (provider) {
		provider.value = providerValue;
	}
	renderLocalModelPicker(providerValue);

	if (theme) {
		loadThemes(settings.theme || 'default');
	}
	normalizeAndApplySettingsState({ ...settings, api_provider: providerValue, api_base_url: apiBaseUrlValue, show_message_timestamps: showTimestamps.checked, show_thinking: showThinking.checked, enable_text_streaming: textStreaming.checked, enable_controlled_streaming: controlledStreaming.checked, controlled_streaming_tps: parseInt(controlledStreamingRate.value, 10), debug_mode: debugMode.checked });
}

function saveSettings() {
	try {
		const fallback = { ...(lastSavedSettings || {}), ...(settingsDraft || {}) };
		const readText = (id, defaultValue = '') => {
			const element = document.getElementById(id);
			if (!element) {
				return `${defaultValue ?? ''}`;
			}
			return `${element.value ?? defaultValue ?? ''}`;
		};
		const readInt = (id, defaultValue = 0) => {
			const parsed = parseInt(readText(id, defaultValue), 10);
			return Number.isFinite(parsed) ? parsed : parseInt(`${defaultValue}`, 10) || 0;
		};
		const readFloat = (id, defaultValue = 0) => {
			const parsed = parseFloat(readText(id, defaultValue));
			return Number.isFinite(parsed) ? parsed : parseFloat(`${defaultValue}`) || 0;
		};
		const readChecked = (id, defaultValue = false) => {
			const element = document.getElementById(id);
			if (!element) {
				return !!defaultValue;
			}
			return !!element.checked;
		};

		const settings = {
			temperature: readFloat('temp', fallback.temperature ?? 0.7),
			max_tokens: readInt('tokens', fallback.max_tokens ?? 10000),
			max_response_length: readInt('max-response-length', fallback.max_response_length ?? 300),
			stop_strings: parseStopStringsInput(readText('stop-strings', formatStopStringsForInput(fallback.stop_strings ?? []))),
			top_k: readInt('top-k', fallback.top_k ?? 40),
			enable_repeat_penalty: readChecked('enable-repeat-penalty', fallback.enable_repeat_penalty ?? true),
			repeat_penalty: readFloat('repeat-penalty', fallback.repeat_penalty ?? 1.0),
			enable_top_p_max: readChecked('enable-top-p-max', fallback.enable_top_p_max ?? true),
			top_p_max: readFloat('top-p-max', fallback.top_p_max ?? 0.95),
			enable_top_p_min: readChecked('enable-top-p-min', fallback.enable_top_p_min ?? true),
			top_p_min: readFloat('top-p-min', fallback.top_p_min ?? 0.05),
			api_provider: readText('provider', fallback.api_provider ?? 'localhost'),
			api_base_url: readText('api-base-url', fallback.api_base_url ?? '').trim(),
			api_key: readText('apikey', fallback.api_key ?? ''),
			model: readText('model', fallback.model ?? ''),
			theme: readText('theme', fallback.theme ?? 'default') || 'default',
			ui_font_size: readInt('ui-fontsize', fallback.ui_font_size ?? 14),
			chat_font_size: readInt('chat-fontsize', fallback.chat_font_size ?? 20),
			chat_text_color_main: normalizeHexColor(readText('chat-text-color-main-hex', fallback.chat_text_color_main ?? '#d5e2ff'), '#d5e2ff'),
			chat_text_color_italic: normalizeHexColor(readText('chat-text-color-italic-hex', fallback.chat_text_color_italic ?? '#aeb6cb'), '#aeb6cb'),
			chat_text_color_bold: normalizeHexColor(readText('chat-text-color-bold-hex', fallback.chat_text_color_bold ?? '#f2f4ff'), '#f2f4ff'),
			chat_text_color_underlined: normalizeHexColor(readText('chat-text-color-underlined-hex', fallback.chat_text_color_underlined ?? '#bdeed5'), '#bdeed5'),
			chat_text_color_quote: normalizeHexColor(readText('chat-text-color-quote-hex', fallback.chat_text_color_quote ?? '#e39a35'), '#e39a35'),
			auto_save_chats: readChecked('autosave', fallback.auto_save_chats ?? true),
			auto_load_last_chat: readChecked('autoload', fallback.auto_load_last_chat ?? true),
			show_message_timestamps: readChecked('showtimestamps', fallback.show_message_timestamps ?? true),
			show_thinking: readChecked('showthinking', fallback.show_thinking ?? false),
			enable_text_streaming: readChecked('textstreaming', fallback.enable_text_streaming ?? true),
			enable_controlled_streaming: readChecked('controlledstreaming', fallback.enable_controlled_streaming ?? true),
			controlled_streaming_tps: Math.max(1, Math.min(100, readInt('controlledstreamingrate', fallback.controlled_streaming_tps ?? 15))),
			debug_mode: readChecked('debugmode', fallback.debug_mode ?? false)
		};
		saveSettingsPatch(settings, true);
	} catch (error) {
		const message = (error && error.message) ? error.message : 'Failed to collect settings form values.';
		alert(`Failed to save settings: ${message}`);
	}
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
					clearAllCollapsedStates();
					updateSettings(data, { showSettingsOnMissing: true });
					expandAllCollapsibleSections(messagesContainer);
					scheduleMasonryRefresh(messagesContainer);
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
			applyFontSizes(settings.ui_font_size ?? settings.font_size ?? 12, settings.chat_font_size ?? settings.font_size ?? 20);
			applyChatTextColors(
				settings.chat_text_color_main,
				settings.chat_text_color_italic,
				settings.chat_text_color_bold,
				settings.chat_text_color_underlined,
				settings.chat_text_color_quote
			);
			applyTheme(lastSavedTheme);
			loadDefaultPersona();
			if (settings && settings.auto_load_last_chat) {
				autoLoadLastChat(settings);
			} else if (typeof switchToMainPage === 'function') {
				switchToMainPage();
			}
			updateBotPanel();
			updateDevTabVisibility();
		});
}
