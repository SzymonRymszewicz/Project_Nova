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
			const iconArt = bot && bot.icon_art ? bot.icon_art : (bot && bot.cover_art ? bot.cover_art : '');
			const iconFit = bot && bot.icon_fit ? bot.icon_fit : (bot && bot.cover_art_fit ? bot.cover_art_fit : null);
			// Use bot icon/coverart if available, otherwise gradient with initial
			const coverStyle = iconArt
				? buildImageStyle(iconArt, iconFit)
				: `background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);`;
			const coverContent = iconArt ? '' : `<div>${initial}</div>`;
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
			updateBotPanel();
		});
}

function loadChat(chatId) {
	if (!currentBotName || !chatId) {
		return;
	}
	openChat(chatId, currentBotName);
}
