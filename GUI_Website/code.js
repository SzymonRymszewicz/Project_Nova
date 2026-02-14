const navItems = document.querySelectorAll('.nav-item');
const messagesContainer = document.getElementById('messages');
const inputArea = document.getElementById('inputArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatHeader = document.getElementById('chatHeader');
const themeStylesheet = document.getElementById('themeStylesheet');
let currentView = 'last-chat';
let currentBotName = null;
let currentBotInfo = null;
let currentPersonaInfo = null;
let currentChatId = null;
let currentChatMessages = [];
let lastSavedTheme = 'default';
let lastSavedSettings = {};
let settingsDraft = {};

function showView(view) {
	const previousView = currentView;
	currentView = view;
	if (previousView === 'settings' && view !== 'settings') {
		revertUnsavedSettings();
	}
	messagesContainer.innerHTML = '';
	if (view === 'last-chat') {
		showLastChat();
	} else if (view === 'bots') {
		showBots();
	} else if (view === 'bot-create') {
		showBotCreation();
	} else if (view === 'chats') {
		showChats();
	} else if (view === 'personas') {
		showPersonas();
	} else if (view === 'settings') {
		showSettings();
	}
}

function showLastChat() {
	renderCurrentChat();
}

function shouldShowTimestamps() {
	if (settingsDraft && typeof settingsDraft.show_message_timestamps === 'boolean') {
		return settingsDraft.show_message_timestamps;
	}
	if (lastSavedSettings && typeof lastSavedSettings.show_message_timestamps === 'boolean') {
		return lastSavedSettings.show_message_timestamps;
	}
	return true;
}

function formatTimestamp(timestamp) {
	if (!timestamp) {
		return '';
	}
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const datePart = date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
	return `${timePart} ${datePart}`;
}

function renderCurrentChat() {
	if (!currentChatId) {
		inputArea.classList.remove('visible');
		chatHeader.innerHTML = '<div><div class="chat-title">Chat</div><div class="chat-subtitle">Continue your conversation</div></div>';
		messagesContainer.innerHTML = '<div style="padding:40px;color:#91a1b7;text-align:center;"><div style="font-size:18px;margin-bottom:12px;">No recent chats</div><p>Select a bot from the left to start chatting</p></div>';
		return;
	}

	inputArea.classList.add('visible');
	const title = currentBotName ? currentBotName : 'Chat';
	chatHeader.innerHTML = `<div><div class="chat-title">${title}</div><div class="chat-subtitle">Conversation</div></div>`;
	messagesContainer.innerHTML = '';
	if (!currentChatMessages || currentChatMessages.length === 0) {
		messagesContainer.innerHTML = '<div class="chat-empty">No messages in this chat yet.</div>';
		return;
	}

	currentChatMessages.forEach(msg => {
		addMessage(msg.content, msg.role === 'user', msg.timestamp);
	});
}

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
				card.innerHTML = `<div class="card-cover" style="background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);"><div>${initial}</div></div><div class="card-content"><div class="card-title">${bot.name}</div><div class="card-desc">${bot.short_description || bot.description || 'No description'}</div></div>`;
				card.onclick = () => selectBot(bot);
				grid.appendChild(card);
			});
			messagesContainer.appendChild(grid);
		});
}

function showPersonas() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Personas</div><div class="chat-subtitle">Choose your persona</div></div>';
	fetch('/api/personas')
		.then(r => r.json())
		.then(personas => {
			const grid = document.createElement('div');
			grid.className = 'bot-grid';
			personas.forEach(p => {
				const card = document.createElement('div');
				card.className = 'persona-card';
				const isUser = p.id === 'user_default';
				const initial = isUser ? 'U' : p.name[0].toUpperCase();
				const bgGrad = isUser ? 'linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%)' : 'linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%)';
				// Use coverart if available
				const coverStyle = p.cover_art ? `background-image:url('${p.cover_art}');background-size:cover;background-position:center;` : `background:${bgGrad};`;
				const coverContent = p.cover_art ? '' : `<div>${initial}</div>`;
				card.innerHTML = `<div class="card-cover" style="${coverStyle}">${coverContent}</div><div class="card-content"><div class="card-title">${p.name}</div><div class="card-desc">${p.description || 'No description'}</div></div>`;
				card.onclick = () => selectPersona(p);
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

function showChats() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Chats</div><div class="chat-subtitle">All conversations</div></div>';
	// Fetch both chats and bots to get coverart
	Promise.all([
		fetch('/api/chats').then(r => r.json()),
		fetch('/api/bots').then(r => r.json())
	]).then(([chats, bots]) => {
		if (chats.length === 0) {
			messagesContainer.innerHTML = '<div class="chat-empty">No chats yet. Start a new conversation!</div>';
			return;
		}
		// Create bot lookup map by name
		const botMap = {};
		bots.forEach(bot => {
			botMap[bot.name] = bot;
		});
		const list = document.createElement('div');
		list.className = 'chat-list';
		chats.forEach(chat => {
			const item = document.createElement('div');
			item.className = 'chat-item';
			const bot = botMap[chat.bot];
			const initial = chat.bot[0].toUpperCase();
			// Use bot coverart if available, otherwise gradient with initial
			const coverStyle = bot && bot.cover_art 
				? `background-image:url('${bot.cover_art}');background-size:cover;background-position:center;` 
				: `background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);`;
			const coverContent = bot && bot.cover_art ? '' : `<div>${initial}</div>`;
			item.innerHTML = `<div class="chat-item-icon" style="${coverStyle}">${coverContent}</div><div class="chat-item-content"><div class="chat-item-title">${chat.title}</div><div class="chat-item-meta">Bot: ${chat.bot}</div><div class="chat-item-meta">Messages: ${chat.message_count}</div></div>`;
			item.onclick = () => {
				openChat(chat.id, chat.bot);
			};
			list.appendChild(item);
		});
		messagesContainer.appendChild(list);
	});
}

function openChat(chatId, botName) {
	if (!chatId || !botName) {
		return;
	}
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
			// Then load the chat
			return fetch('/api/load-chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chat_id: chatId, bot_name: botName })
			});
		})
		.then(r => r.json())
		.then(data => {
			currentChatId = chatId;
			currentBotName = botName;
			currentChatMessages = (data && data.messages) ? data.messages : [];
			switchToLastChat();
		});
}

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
	themeStylesheet.setAttribute('href', `/${safeTheme}.css`);
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
			}
		});
}

function showBotDetail(bot) {
	chatHeader.innerHTML = `<div><div class="chat-title">${bot.name}</div><div class="chat-subtitle">Bot Details</div></div>`;
	// Clear the messages container to replace the bot grid
	messagesContainer.innerHTML = '';
	const detail = document.createElement('div');
	detail.className = 'bot-detail';
	const initial = bot.name[0].toUpperCase();
	// Use coverart if available, otherwise use gradient with initial
	const coverStyle = bot.cover_art 
		? `background-image:url('${bot.cover_art}');background-size:cover;background-position:center;` 
		: `background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);`;
	const coverContent = bot.cover_art ? '' : `<div>${initial}</div>`;
	detail.innerHTML = `<div class="detail-cover" style="${coverStyle}">${coverContent}</div><div class="detail-info"><h2>${bot.name}</h2><p>${bot.description || 'No description provided.'}</p><div class="detail-actions"><button class="btn btn-primary" onclick="startNewChat('${bot.name}')">Start New Chat</button><button class="btn btn-secondary" onclick="continuePreviousChat('${bot.name}')">Continue Last Chat</button></div></div>`;
	messagesContainer.appendChild(detail);
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
			currentChatMessages = [];
			renderCurrentChat();
			switchToLastChat();
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
			} else {
				alert('No previous chat found for this bot');
				startNewChat(botName);
			}
		});
}

function loadChat(chatId) {
	if (!currentBotName || !chatId) {
		return;
	}
	openChat(chatId, currentBotName);
}

function addMessage(text, isUser, timestamp) {
	const msg = document.createElement('div');
	msg.className = 'message' + (isUser ? ' user' : '');
	const avatar = document.createElement('div');
	avatar.className = 'message-avatar';
	
	// Set avatar with coverart or fallback to text initial
	if (isUser) {
		if (currentPersonaInfo && currentPersonaInfo.cover_art) {
			avatar.style.backgroundImage = `url('${currentPersonaInfo.cover_art}')`;
			avatar.textContent = '';
		} else {
			avatar.textContent = 'U';
		}
	} else {
		if (currentBotInfo && currentBotInfo.cover_art) {
			avatar.style.backgroundImage = `url('${currentBotInfo.cover_art}')`;
			avatar.textContent = '';
		} else {
			avatar.textContent = currentBotName ? currentBotName[0].toUpperCase() : 'AI';
		}
	}
	
	const content = document.createElement('div');
	content.className = 'message-content';
	const bubble = document.createElement('div');
	bubble.className = 'message-bubble';
	bubble.textContent = text;
	const time = document.createElement('div');
	time.className = 'message-time';
	const showTime = shouldShowTimestamps();
	const formatted = formatTimestamp(timestamp);
	time.textContent = formatted || '';
	if (!showTime) {
		time.classList.add('hidden');
	}
	content.appendChild(bubble);
	content.appendChild(time);
	msg.appendChild(avatar);
	msg.appendChild(content);
	messagesContainer.appendChild(msg);
	messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendMessage() {
	const text = messageInput.value.trim();
	if (!text || !currentChatId) {
		return;
	}
	const timestamp = new Date().toISOString();
	addMessage(text, true, timestamp);
	currentChatMessages = currentChatMessages || [];
	currentChatMessages.push({ role: 'user', content: text, timestamp: timestamp });
	messageInput.value = '';
	fetch('/api/message', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: text })
	})
		.then(r => r.json())
		.then(data => {
			if (data.response) {
				const responseTimestamp = new Date().toISOString();
				addMessage(data.response, false, responseTimestamp);
				currentChatMessages.push({ role: 'assistant', content: data.response, timestamp: responseTimestamp });
				fetch('/api/message', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ message: data.response, save_response: true, chat_id: currentChatId, bot_name: currentBotName })
				});
			}
		});
}

function selectPersona(persona) {
	currentPersonaInfo = persona;
	console.log('Persona selected:', persona.name);
	showPersonaDetail(persona);
}

function showPersonaDetail(persona) {
	chatHeader.innerHTML = `<div><div class="chat-title">${persona.name}</div><div class="chat-subtitle">Persona Details</div></div>`;
	// Clear the messages container to replace the persona grid
	messagesContainer.innerHTML = '';
	const detail = document.createElement('div');
	detail.className = 'bot-detail';
	const isUser = persona.id === 'user_default';
	const initial = isUser ? 'U' : persona.name[0].toUpperCase();
	const defaultGrad = isUser ? 'linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%)' : 'linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%)';
	// Use coverart if available, otherwise use gradient with initial
	const coverStyle = persona.cover_art 
		? `background-image:url('${persona.cover_art}');background-size:cover;background-position:center;` 
		: `background:${defaultGrad};`;
	const coverContent = persona.cover_art ? '' : `<div>${initial}</div>`;
	detail.innerHTML = `<div class="detail-cover" style="${coverStyle}">${coverContent}</div><div class="detail-info"><h2>${persona.name}</h2><p>${persona.description || 'No description provided.'}</p></div>`;
	messagesContainer.appendChild(detail);
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

function switchToLastChat() {
	navItems[0].click();
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
		});
}

function loadDefaultPersona() {
	fetch('/api/personas')
		.then(r => r.json())
		.then(personas => {
			const defaultPersona = personas.find(p => p.id === 'user_default') || personas[0];
			if (defaultPersona) {
				currentPersonaInfo = defaultPersona;
			}
		})
		.catch(() => {
			currentPersonaInfo = { name: 'User', cover_art: '' };
		});
}

function autoLoadLastChat(settings) {
	if (!settings || !settings.auto_load_last_chat) {
		return;
	}
	const defaultBot = settings.default_bot;
	if (!defaultBot) {
		return;
	}
	fetch('/api/last-chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ bot_name: defaultBot })
	})
		.then(r => r.json())
		.then(data => {
			if (data && data.chat_info) {
				currentChatId = data.chat_info.id;
				currentBotName = data.chat_info.bot || defaultBot;
				currentChatMessages = data.messages || [];
				// Fetch bot info for coverart
				fetch('/api/bot/select', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ bot_name: currentBotName })
				})
					.then(r => r.json())
					.then(botData => {
						if (botData.success) {
							currentBotInfo = botData.bot;
						}
						switchToLastChat();
					});
			}
		});
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', e => {
	if (e.key === 'Enter') {
		sendMessage();
	}
});
navItems.forEach(item => {
	item.addEventListener('click', () => {
		navItems.forEach(i => i.classList.remove('active'));
		item.classList.add('active');
		showView(item.dataset.view);
	});
});

showView('last-chat');
initSettings();
