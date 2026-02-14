const navItems = document.querySelectorAll('.nav-item');
const messagesContainer = document.getElementById('messages');
const inputArea = document.getElementById('inputArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatHeader = document.getElementById('chatHeader');
let currentView = 'last-chat';
let currentBotName = null;
let currentChatId = null;

function showView(view) {
	currentView = view;
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
	if (!currentChatId) {
		inputArea.classList.remove('visible');
		messagesContainer.innerHTML = '<div style="padding:40px;color:#91a1b7;text-align:center;"><div style="font-size:18px;margin-bottom:12px;">No recent chats</div><p>Select a bot from the left to start chatting</p></div>';
	} else {
		inputArea.classList.add('visible');
	}
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
				card.innerHTML = `<div class="card-cover" style="background:${bgGrad};"><div>${initial}</div></div><div class="card-content"><div class="card-title">${p.name}</div><div class="card-desc">${p.description || 'No description'}</div></div>`;
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
	fetch('/api/chats')
		.then(r => r.json())
		.then(chats => {
			if (chats.length === 0) {
				messagesContainer.innerHTML = '<div style="padding:20px;color:#91a1b7;">No chats yet. Start a new conversation!</div>';
				return;
			}
			const list = document.createElement('div');
			list.style.cssText = 'padding:20px;';
			chats.forEach(chat => {
				const item = document.createElement('div');
				item.style.cssText = 'background:#0c131c;padding:16px;border-radius:8px;margin-bottom:12px;cursor:pointer;border:1px solid #17202b;transition:all 0.2s;';
				item.innerHTML = `<div style="font-weight:600;color:#19f2ff;">${chat.title}</div><div style="font-size:12px;color:#91a1b7;margin-top:4px;">Bot: ${chat.bot}</div><div style="font-size:12px;color:#91a1b7;">Messages: ${chat.message_count}</div>`;
				item.onmouseover = () => {
					item.style.borderColor = '#19f2ff';
				};
				item.onmouseout = () => {
					item.style.borderColor = '#17202b';
				};
				item.onclick = () => {
					currentChatId = chat.id;
					currentBotName = chat.bot;
					messagesContainer.innerHTML = '';
					fetch('/api/load-chat', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ chat_id: chat.id, bot_name: chat.bot })
					})
						.then(r => r.json())
						.then(data => {
							if (data && data.messages) {
								data.messages.forEach(msg => {
									addMessage(msg.content, msg.role === 'user');
								});
								switchToLastChat();
							}
						});
				};
				list.appendChild(item);
			});
			messagesContainer.appendChild(list);
		});
}

function showSettings() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Settings</div><div class="chat-subtitle">Manage preferences</div></div>';
	fetch('/api/settings')
		.then(r => r.json())
		.then(settings => {
			const container = document.createElement('div');
			container.className = 'settings-container';
			const temp = settings.temperature || 0.7;
			const tokens = settings.max_tokens || 2048;
			container.innerHTML = `<h3 style="color:#19f2ff;margin-bottom:16px;">Generation Settings</h3><div class="setting-item"><label class="setting-label">Temperature</label><input type="range" class="setting-input" min="0" max="2" step="0.1" value="${temp}" id="temp"></div><div class="setting-item"><label class="setting-label">Max Tokens</label><input type="number" class="setting-input" value="${tokens}" id="tokens"></div><h3 style="color:#19f2ff;margin-bottom:16px;margin-top:24px;">API Client Settings</h3><div class="setting-item"><label class="setting-label">API Provider</label><select class="setting-select" id="provider"><option value="openai" ${settings.api_provider === 'openai' ? 'selected' : ''}>OpenAI</option></select></div><div class="setting-item"><label class="setting-label">Model</label><input type="text" class="setting-input" value="${settings.model || 'gpt-3.5-turbo'}" id="model"></div><div class="setting-item"><label class="setting-label">API Key</label><input type="password" class="setting-input" placeholder="Enter API key" id="apikey"></div><h3 style="color:#19f2ff;margin-bottom:16px;margin-top:24px;">Style Settings</h3><div class="setting-item"><label class="setting-label">Theme</label><select class="setting-select" id="theme"><option value="cyberpunk" ${settings.theme === 'cyberpunk' ? 'selected' : ''}>Cyberpunk</option></select></div><div class="setting-item"><label class="setting-label">Font Size</label><input type="number" class="setting-input" value="${settings.font_size || 12}" id="fontsize" min="10" max="18"></div><h3 style="color:#19f2ff;margin-bottom:16px;margin-top:24px;">Other</h3><div class="setting-item"><label><input type="checkbox" id="autosave" ${settings.auto_save_chats ? 'checked' : ''} > Auto-save Chats</label></div><div class="setting-item"><label><input type="checkbox" id="autoload" ${settings.auto_load_last_chat ? 'checked' : ''} > Auto-load Last Chat</label></div><button class="btn btn-primary" onclick="saveSettings()" style="width:100%;margin-top:24px;">Save Settings</button><button class="btn btn-secondary" onclick="resetSettings()" style="width:100%;margin-top:12px;">Restore Defaults</button>`;
			messagesContainer.appendChild(container);
		});
}

function selectBot(bot) {
	currentBotName = bot.name;
	fetch('/api/bot/select', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ bot_name: bot.name })
	})
		.then(r => r.json())
		.then(data => {
			if (data.success) {
				showBotDetail(data.bot);
			}
		});
}

function showBotDetail(bot) {
	chatHeader.innerHTML = `<div><div class="chat-title">${bot.name}</div><div class="chat-subtitle">Bot Details</div></div>`;
	const detail = document.createElement('div');
	detail.className = 'bot-detail';
	const initial = bot.name[0].toUpperCase();
	detail.innerHTML = `<div class="detail-cover" style="background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);"><div>${initial}</div></div><div class="detail-info"><h2>${bot.name}</h2><p>${bot.description || 'No description provided.'}</p><div class="detail-actions"><button class="btn btn-primary" onclick="startNewChat('${bot.name}')">Start New Chat</button><button class="btn btn-secondary" onclick="continuePreviousChat('${bot.name}')">Continue Last Chat</button></div></div>`;
	messagesContainer.appendChild(detail);
}

function startNewChat(botName) {
	const title = prompt('Chat title (optional):') || 'Chat with ' + botName;
	fetch('/api/chats', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'create', bot_name: botName, title: title })
	})
		.then(r => r.json())
		.then(chat => {
			currentChatId = chat.id;
			loadChat(chat.id);
			switchToLastChat();
		});
}

function continuePreviousChat(botName) {
	fetch('/api/last-chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ bot_name: botName })
	})
		.then(r => r.json())
		.then(data => {
			if (data && data.chat_info) {
				currentChatId = data.chat_info.id;
				currentBotName = data.chat_info.bot;
				messagesContainer.innerHTML = '';
				data.messages.forEach(msg => {
					addMessage(msg.content, msg.role === 'user');
				});
				switchToLastChat();
			} else {
				alert('No previous chat found for this bot');
				startNewChat(botName);
			}
		});
}

function loadChat(chatId) {
	currentChatId = chatId;
	switchToLastChat();
}

function addMessage(text, isUser) {
	const msg = document.createElement('div');
	msg.className = 'message' + (isUser ? ' user' : '');
	const avatar = document.createElement('div');
	avatar.className = 'message-avatar';
	avatar.textContent = isUser ? 'U' : (currentBotName ? currentBotName[0].toUpperCase() : 'AI');
	const content = document.createElement('div');
	content.className = 'message-content';
	const bubble = document.createElement('div');
	bubble.className = 'message-bubble';
	bubble.textContent = text;
	const time = document.createElement('div');
	time.className = 'message-time';
	time.textContent = 'Just now';
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
	addMessage(text, true);
	messageInput.value = '';
	fetch('/api/message', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: text })
	})
		.then(r => r.json())
		.then(data => {
			if (data.response) {
				addMessage(data.response, false);
				fetch('/api/message', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ message: data.response, save_response: true, chat_id: currentChatId, bot_name: currentBotName })
				});
			}
		});
}

function selectPersona(persona) {
	console.log('Persona selected:', persona.name);
	alert('Persona: ' + persona.name);
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
		theme: document.getElementById('theme').value,
		font_size: parseInt(document.getElementById('fontsize').value, 10),
		auto_save_chats: document.getElementById('autosave').checked,
		auto_load_last_chat: document.getElementById('autoload').checked
	};
	fetch('/api/settings', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'update', settings: settings })
	})
		.then(r => r.json())
		.then(() => {
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
					showSettings();
				} else {
					alert('Failed to reset settings');
				}
			});
	}
}

function switchToLastChat() {
	navItems[0].click();
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
