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
		const list = document.createElement('div');
		list.className = 'chat-list';
		sortedChats.forEach(chat => {
			const item = document.createElement('div');
			item.className = 'chat-item';
			const bot = botMap[chat.bot];
			const initial = chat.bot[0].toUpperCase();
			const isLastOpened = chat.id === lastOpenedChatId;
			const iconArt = bot && bot.icon_art ? bot.icon_art : (bot && bot.cover_art ? bot.cover_art : '');
			const iconFit = bot && bot.icon_fit ? bot.icon_fit : (bot && bot.cover_art_fit ? bot.cover_art_fit : null);
			// Use bot icon/coverart if available, otherwise gradient with initial
			const coverStyle = iconArt
				? buildImageStyle(iconArt, iconFit)
				: `background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);`;
			const coverContent = iconArt ? '' : `<div>${initial}</div>`;
			item.innerHTML = `<div class="chat-item-icon" style="${coverStyle}">${coverContent}</div><div class="chat-item-content"><div class="chat-item-title-row"><div class="chat-item-title">${chat.title}</div>${isLastOpened ? '<span class="chat-last-opened-badge">Last opened</span>' : ''}</div><div class="chat-item-meta">Bot: ${chat.bot}</div><div class="chat-item-meta">Messages: ${chat.message_count}</div></div><button class="chat-delete-btn" type="button" title="Delete chat" aria-label="Delete chat"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 2a1 1 0 00-1 1v1H5a1 1 0 100 2h.293l.853 10.24A2 2 0 008.14 18h3.72a2 2 0 001.994-1.76L14.707 6H15a1 1 0 100-2h-2V3a1 1 0 00-1-1H8zm3 2V4H9V4h2zm-2 4a1 1 0 10-2 0v6a1 1 0 102 0V8zm4-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></button>`;
			const deleteBtn = item.querySelector('.chat-delete-btn');
			if (deleteBtn) {
				deleteBtn.addEventListener('click', (event) => {
					event.stopPropagation();
					deleteChat(chat.id, chat.bot, chat.title || 'this chat');
				});
			}
			item.onclick = () => {
				openChat(chat.id, chat.bot);
			};
			list.appendChild(item);
		});
		messagesContainer.appendChild(list);
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
