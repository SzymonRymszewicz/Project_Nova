function showLastChat() {
	renderCurrentChat();
}

function autoResizeMessageInput() {
	if (!messageInput) {
		return;
	}
	const computedStyle = window.getComputedStyle(messageInput);
	const minHeight = parseFloat(computedStyle.minHeight) || 52;
	const maxHeight = parseFloat(computedStyle.maxHeight) || 192;
	const minSnapTolerance = 3;

	messageInput.style.height = 'auto';
	let nextHeight = Math.min(Math.max(messageInput.scrollHeight, minHeight), maxHeight);
	if (nextHeight <= minHeight + minSnapTolerance) {
		nextHeight = minHeight;
	}
	messageInput.style.height = `${nextHeight}px`;
	messageInput.style.overflowY = messageInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function resetMessageInputHeight() {
	if (!messageInput) {
		return;
	}
	messageInput.style.height = '';
	messageInput.style.overflowY = 'hidden';
	autoResizeMessageInput();
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
	renderChatIamHeaderPicker();
	messagesContainer.innerHTML = '';
	if (!currentChatMessages || currentChatMessages.length === 0) {
		messagesContainer.innerHTML = '<div class="chat-empty">No messages in this chat yet.</div>';
		return;
	}

	currentChatMessages.forEach(msg => {
		addMessage(msg.content, msg.role === 'user', msg.timestamp);
	});
}

function renderChatIamHeaderPicker() {
	if (!chatHeader || !currentBotName || !currentChatId) {
		return;
	}
	const existingPicker = document.getElementById('chat-header-iam-picker');
	if (existingPicker) {
		existingPicker.remove();
	}
	const hasUserMessage = Array.isArray(currentChatMessages) && currentChatMessages.some(msg => (msg || {}).role === 'user');
	if (hasUserMessage) {
		return;
	}

	window.__novaChatIamPickerToken = (window.__novaChatIamPickerToken || 0) + 1;
	const pickerToken = window.__novaChatIamPickerToken;
	const botAtRender = currentBotName;
	const chatAtRender = currentChatId;

	fetch('/api/bot/iam', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'list_sets', bot_name: currentBotName })
	})
		.then(r => r.json())
		.then(data => {
			if (pickerToken !== window.__novaChatIamPickerToken || botAtRender !== currentBotName || chatAtRender !== currentChatId) {
				return;
			}
			const defaultIamSet = (typeof DEFAULT_IAM_SET !== 'undefined' && DEFAULT_IAM_SET) ? DEFAULT_IAM_SET : 'IAM_1';
			const setNames = (typeof getSortedIamSetNames === 'function')
				? getSortedIamSetNames((data && data.sets) ? data.sets : [defaultIamSet])
				: ((data && data.sets) || [defaultIamSet]);
			currentChatIamSetNames = setNames;
			if (!setNames || setNames.length <= 1) {
				return;
			}

			if (!chatBotIamSelections[currentBotName] || !setNames.includes(chatBotIamSelections[currentBotName])) {
				chatBotIamSelections[currentBotName] = (data && data.current_set && setNames.includes(data.current_set)) ? data.current_set : setNames[0];
			}

			const selected = chatBotIamSelections[currentBotName];
			const numberMatch = /^IAM_(\d+)$/i.exec(selected || '');
			const displayNumber = numberMatch ? numberMatch[1] : selected;

			const picker = document.createElement('div');
			picker.id = 'chat-header-iam-picker';
			picker.className = 'iam-set-nav';
			chatHeader.style.position = 'relative';
			picker.style.position = 'absolute';
			picker.style.left = '50%';
			picker.style.top = '50%';
			picker.style.transform = 'translate(-50%, -50%)';
			picker.innerHTML = `<button type="button" class="action-btn cancel-btn" id="chat-header-iam-prev">&lt;</button><span class="iam-set-label" id="chat-header-iam-label">${displayNumber}</span><button type="button" class="action-btn cancel-btn" id="chat-header-iam-next">&gt;</button>`;
			chatHeader.appendChild(picker);

			const rotate = (direction) => {
				const current = chatBotIamSelections[currentBotName];
				const currentIndex = Math.max(0, setNames.indexOf(current));
				const nextIndex = (currentIndex + direction + setNames.length) % setNames.length;
				const nextSet = setNames[nextIndex];
				fetch('/api/chats', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'switch_iam',
						chat_id: currentChatId,
						bot_name: currentBotName,
						iam_set: nextSet,
						persona_name: (currentPersonaInfo && currentPersonaInfo.name) ? currentPersonaInfo.name : 'User'
					})
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							return;
						}
						chatBotIamSelections[currentBotName] = nextSet;
						currentChatMessages = result.messages || [];
						renderCurrentChat();
					});
			};

			const prevBtn = document.getElementById('chat-header-iam-prev');
			const nextBtn = document.getElementById('chat-header-iam-next');
			if (prevBtn) {
				prevBtn.addEventListener('click', () => rotate(-1));
			}
			if (nextBtn) {
				nextBtn.addEventListener('click', () => rotate(1));
			}
		});
}

function addMessage(text, isUser, timestamp) {
	const msg = document.createElement('div');
	msg.className = 'message' + (isUser ? ' user' : '');
	const avatar = document.createElement('div');
	avatar.className = 'message-avatar';

	// Set avatar with coverart/icon or fallback to text initial
	if (isUser) {
		const iconArt = currentPersonaInfo && currentPersonaInfo.icon_art ? currentPersonaInfo.icon_art : (currentPersonaInfo && currentPersonaInfo.cover_art ? currentPersonaInfo.cover_art : '');
		const iconFit = currentPersonaInfo && currentPersonaInfo.icon_fit ? currentPersonaInfo.icon_fit : (currentPersonaInfo && currentPersonaInfo.cover_art_fit ? currentPersonaInfo.cover_art_fit : null);
		if (iconArt) {
			avatar.style.cssText = buildImageStyle(iconArt, iconFit);
			avatar.textContent = '';
		} else {
			avatar.textContent = 'U';
		}
	} else {
		const iconArt = currentBotInfo && currentBotInfo.icon_art ? currentBotInfo.icon_art : (currentBotInfo && currentBotInfo.cover_art ? currentBotInfo.cover_art : '');
		const iconFit = currentBotInfo && currentBotInfo.icon_fit ? currentBotInfo.icon_fit : (currentBotInfo && currentBotInfo.cover_art_fit ? currentBotInfo.cover_art_fit : null);
		if (iconArt) {
			avatar.style.cssText = buildImageStyle(iconArt, iconFit);
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
	const meta = document.createElement('div');
	meta.className = 'message-time';
	const showTime = shouldShowTimestamps();
	const formatted = formatTimestamp(timestamp);
	const name = document.createElement('span');
	name.className = 'message-meta-name';
	name.textContent = isUser ? (currentPersonaInfo && currentPersonaInfo.name ? currentPersonaInfo.name : 'User') : (currentBotName || 'Bot');
	const timeText = document.createElement('span');
	timeText.className = 'message-meta-time';
	timeText.textContent = formatted || '';
	if (!showTime) {
		meta.classList.add('hidden');
	}
	meta.appendChild(name);
	meta.appendChild(timeText);
	content.appendChild(bubble);
	content.appendChild(meta);
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
	renderCurrentChat();
	messageInput.value = '';
	resetMessageInputHeight();
	fetch('/api/message', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			message: text,
			chat_id: currentChatId,
			bot_name: currentBotName,
			persona_id: (currentPersonaInfo && currentPersonaInfo.id) ? currentPersonaInfo.id : 'User',
			persona_name: (currentPersonaInfo && currentPersonaInfo.name) ? currentPersonaInfo.name : 'User'
		})
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

function autoLoadLastChat(settings) {
	if (!settings || !settings.auto_load_last_chat) {
		return;
	}
	// Always load the most recent chat globally on app startup.
	fetch('/api/last-chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ bot_name: null })
	})
		.then(r => r.json())
		.then(data => {
			if (data && data.chat_info) {
				currentChatId = data.chat_info.id;
				currentBotName = data.chat_info.bot || null;
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
