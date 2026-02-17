const chatGroupExpandedState = {};

function buildChatGroupPersonaPicker(botName) {
	const picker = document.createElement('div');
	picker.className = 'persona-picker';

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'btn btn-secondary persona-picker-btn';

	const menu = document.createElement('div');
	menu.className = 'persona-picker-menu hidden';

	picker.appendChild(button);
	picker.appendChild(menu);

	if (typeof setPersonaPickerButtonContent === 'function') {
		setPersonaPickerButtonContent(button, currentPersonaInfo);
	}

	const closeMenu = (event) => {
		if (!picker.contains(event.target)) {
			menu.classList.add('hidden');
			document.removeEventListener('click', closeMenu);
		}
	};

	button.addEventListener('click', (event) => {
		event.stopPropagation();
		const opening = menu.classList.contains('hidden');
		if (opening) {
			if (typeof loadPersonaPickerOptions === 'function') {
				loadPersonaPickerOptions(menu, button);
			}
			setTimeout(() => {
				document.addEventListener('click', closeMenu);
			}, 0);
		} else {
			document.removeEventListener('click', closeMenu);
		}
		menu.classList.toggle('hidden');
	});

	return picker;
}

function showChats() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Chats</div><div class="chat-subtitle">All conversations</div></div>';
	messagesContainer.innerHTML = '';
	// Fetch both chats and bots to get coverart
	Promise.all([
		fetch('/api/chats').then(r => r.json()),
		fetch('/api/bots').then(r => r.json())
	]).then(([chats, bots]) => {
		if (chats.length === 0) {
			messagesContainer.innerHTML = '<div class="chat-empty">No chats yet. Start a new conversation!</div>';
			return;
		}

		const sortedChats = [...chats].sort((a, b) => {
			const aKey = (a.last_opened || a.last_updated || '').toString();
			const bKey = (b.last_opened || b.last_updated || '').toString();
			return bKey.localeCompare(aKey);
		});
		const lastOpenedChatId = sortedChats[0] ? sortedChats[0].id : null;

		// Create bot lookup map by name
		const botMap = {};
		bots.forEach(bot => {
			botMap[bot.name] = bot;
		});

		const groupedChats = {};
		const orderedBots = [];
		sortedChats.forEach(chat => {
			const botName = chat.bot || 'Unknown';
			if (!groupedChats[botName]) {
				groupedChats[botName] = [];
				orderedBots.push(botName);
			}
			groupedChats[botName].push(chat);
		});

		const groupList = document.createElement('div');
		groupList.className = 'chat-group-list';

		orderedBots.forEach(botName => {
			const botChats = groupedChats[botName] || [];
			const bot = botMap[botName] || null;
			const initial = botName ? botName[0].toUpperCase() : 'B';
			const iconArt = bot && bot.icon_art ? bot.icon_art : (bot && bot.cover_art ? bot.cover_art : '');
			const iconFit = bot && bot.icon_fit ? bot.icon_fit : (bot && bot.cover_art_fit ? bot.cover_art_fit : null);
			const coverStyle = iconArt
				? buildImageStyle(iconArt, iconFit)
				: 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);';
			const coverContent = iconArt ? '' : `<div>${initial}</div>`;

			const group = document.createElement('div');
			group.className = 'chat-group';
			const expanded = chatGroupExpandedState[botName] === true;

			const personaPicker = buildChatGroupPersonaPicker(botName);
			const newChatBtn = document.createElement('button');
			newChatBtn.type = 'button';
			newChatBtn.className = 'btn btn-primary';
			newChatBtn.textContent = 'Start New Chat';
			newChatBtn.addEventListener('click', (event) => {
				event.stopPropagation();
				if (bot) {
					currentBotInfo = bot;
				}
				startNewChat(botName);
			});

			const header = document.createElement('div');
			header.className = 'chat-group-header';
			header.setAttribute('role', 'button');
			header.setAttribute('tabindex', '0');
			header.innerHTML = `
				<div class="chat-group-title-wrap">
					<div class="chat-group-icon" style="${coverStyle}">${coverContent}</div>
					<div class="chat-group-title-block">
						<div class="chat-group-title">${botName}</div>
						<div class="chat-group-count">${botChats.length} chat${botChats.length === 1 ? '' : 's'}</div>
					</div>
				</div>
			`;

			const headerActions = document.createElement('div');
			headerActions.className = 'chat-group-header-actions';
			const toggle = document.createElement('span');
			toggle.className = 'chat-group-toggle';
			toggle.textContent = expanded ? 'v' : '<';
			headerActions.appendChild(personaPicker);
			headerActions.appendChild(newChatBtn);
			headerActions.appendChild(toggle);
			header.appendChild(headerActions);

			const body = document.createElement('div');
			body.className = 'chat-group-body' + (expanded ? '' : ' hidden');

			const list = document.createElement('div');
			list.className = 'chat-list';
			botChats.forEach(chat => {
			const item = document.createElement('div');
			item.className = 'chat-item';
			const isLastOpened = chat.id === lastOpenedChatId;
			item.innerHTML = `<div class="chat-item-icon chat-item-icon-small" style="${coverStyle}">${coverContent}</div><div class="chat-item-content"><div class="chat-item-title-row"><div class="chat-item-title">${chat.title}</div>${isLastOpened ? '<span class="chat-last-opened-badge">Last opened</span>' : ''}</div><div class="chat-item-meta">Messages: ${chat.message_count}</div></div><button class="chat-delete-btn" type="button" title="Delete chat" aria-label="Delete chat"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 2a1 1 0 00-1 1v1H5a1 1 0 100 2h.293l.853 10.24A2 2 0 008.14 18h3.72a2 2 0 001.994-1.76L14.707 6H15a1 1 0 100-2h-2V3a1 1 0 00-1-1H8zm3 2V4H9V4h2zm-2 4a1 1 0 10-2 0v6a1 1 0 102 0V8zm4-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></button>`;
			const deleteBtn = item.querySelector('.chat-delete-btn');
			if (deleteBtn) {
				deleteBtn.addEventListener('click', (event) => {
					event.stopPropagation();
					deleteChat(chat.id, botName, chat.title || 'this chat');
				});
			}
			item.onclick = () => {
				openChat(chat.id, botName);
			};
			list.appendChild(item);
			});

			body.appendChild(list);

			const toggleGroup = () => {
				const nextExpanded = body.classList.contains('hidden');
				chatGroupExpandedState[botName] = nextExpanded;
				body.classList.toggle('hidden', !nextExpanded);
				toggle.textContent = nextExpanded ? 'v' : '<';
			};

			header.addEventListener('click', (event) => {
				if (event.target.closest('.persona-picker') || event.target.closest('.btn')) {
					return;
				}
				toggleGroup();
			});

			header.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter' && event.key !== ' ') {
					return;
				}
				event.preventDefault();
				toggleGroup();
			});

			group.appendChild(header);
			group.appendChild(body);
			groupList.appendChild(group);
		});

		messagesContainer.appendChild(groupList);
	});
}

function deleteChat(chatId, botName, chatTitle) {
	if (!chatId) {
		return;
	}
	const confirmed = confirm(`Deleting the chat "${chatTitle}" is permanent. Do you want to continue?`);
	if (!confirmed) {
		return;
	}

	fetch('/api/chats', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'delete', chat_id: chatId, bot_name: botName })
	})
		.then(r => r.json())
		.then(result => {
			if (!result || !result.success) {
				alert('Failed to delete chat.');
				return;
			}

			if (currentChatId === chatId) {
				currentChatId = null;
				currentChatMessages = [];
			}

			showChats();
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
			updateBotPanel();
		});
}

function loadChat(chatId) {
	if (!currentBotName || !chatId) {
		return;
	}
	openChat(chatId, currentBotName);
}
