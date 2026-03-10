const BOTS_FALLBACK_COVER_STYLE = 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);';

function postJson(url, payload) {
	return fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
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
				const coverStyle = bot.cover_art ? buildImageStyle(bot.cover_art, bot.cover_art_fit || null) : BOTS_FALLBACK_COVER_STYLE;
				const coverContent = bot.cover_art ? '' : `<div>${initial}</div>`;
				card.innerHTML = `<div class="card-cover" style="${coverStyle}">${coverContent}</div><div class="card-content"><div class="card-title">${bot.name}</div><div class="card-desc">${bot.short_description || bot.description || 'No description'}</div></div>`;
				card.onclick = () => selectBot(bot);
				grid.appendChild(card);
			});
			messagesContainer.appendChild(grid);
		});
}

function selectBot(bot) {
	currentBotName = bot.name;
	currentBotInfo = bot;
	postJson('/api/bot/select', { bot_name: bot.name })
		.then(r => r.json())
		.then(data => {
			if (data.success) {
				currentBotInfo = data.bot;
				showBotDetail(data.bot);
				updateBotPanel();
			}
		});
}

function showBotDetail(bot) {
	renderBotDetailView(bot);
}

function getPersonaDisplay(persona) {
	const name = (persona && persona.name) ? persona.name : 'User';
	const iconArt = (persona && persona.icon_art) ? persona.icon_art : ((persona && persona.cover_art) ? persona.cover_art : '');
	const iconFit = (persona && persona.icon_fit) ? persona.icon_fit : ((persona && persona.cover_art_fit) ? persona.cover_art_fit : null);
	const initial = name ? name[0].toUpperCase() : 'U';
	return { name, iconArt, iconFit, initial };
}

function setPersonaPickerButtonContent(buttonEl, persona) {
	if (!buttonEl) {
		return;
	}
	const display = getPersonaDisplay(persona);
	buttonEl.innerHTML = '';

	const icon = document.createElement('span');
	icon.className = 'persona-chip-icon';
	if (display.iconArt) {
		icon.style.cssText = buildImageStyle(display.iconArt, display.iconFit);
		icon.textContent = '';
	} else {
		icon.textContent = display.initial;
	}

	const label = document.createElement('span');
	label.className = 'persona-chip-label';
	label.textContent = `Persona: ${display.name}`;

	buttonEl.appendChild(icon);
	buttonEl.appendChild(label);
}

function loadPersonaPickerOptions(menuEl, buttonEl) {
	if (!menuEl || !buttonEl) {
		return;
	}
	menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Loading personas...</button>';

	fetch('/api/personas')
		.then(r => r.json())
		.then(personas => {
			const list = Array.isArray(personas) ? personas : [];
			if (!list.length) {
				menuEl.innerHTML = '<button class="persona-option" type="button" disabled>No personas available</button>';
				return;
			}

			if (!currentPersonaInfo) {
				currentPersonaInfo = list.find(p => p.id === 'User') || list[0];
			}

			setPersonaPickerButtonContent(buttonEl, currentPersonaInfo);
			menuEl.innerHTML = '';
			list.forEach(persona => {
				const display = getPersonaDisplay(persona);
				const option = document.createElement('button');
				option.type = 'button';
				option.className = 'persona-option' + ((currentPersonaInfo && currentPersonaInfo.id === persona.id) ? ' active' : '');

				const icon = document.createElement('span');
				icon.className = 'persona-option-icon';
				if (display.iconArt) {
					icon.style.cssText = buildImageStyle(display.iconArt, display.iconFit);
					icon.textContent = '';
				} else {
					icon.textContent = display.initial;
				}

				const text = document.createElement('span');
				text.className = 'persona-option-text';
				text.textContent = display.name;

				option.appendChild(icon);
				option.appendChild(text);
				option.addEventListener('click', (event) => {
					event.stopPropagation();
					currentPersonaInfo = persona;
					setPersonaPickerButtonContent(buttonEl, currentPersonaInfo);
					menuEl.classList.add('hidden');
				});
				menuEl.appendChild(option);
			});
		})
		.catch(() => {
			menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Failed to load personas</button>';
		});
}

function renderBotDetailView(bot) {
	chatHeader.innerHTML = `<div><div class="chat-title">${bot.name}</div><div class="chat-subtitle">Bot Details</div></div>`;
	messagesContainer.innerHTML = '';
	const detail = document.createElement('div');
	detail.className = 'bot-detail';
	const initial = bot.name[0].toUpperCase();
	const coverStyle = bot.cover_art
		? buildImageStyle(bot.cover_art, bot.cover_art_fit || null)
		: BOTS_FALLBACK_COVER_STYLE;
	const coverContent = bot.cover_art ? '' : `<div>${initial}</div>`;
	detail.innerHTML = `<div class="detail-cover" style="${coverStyle}">${coverContent}</div><div class="detail-info"><div class="detail-title-row"><h2>${bot.name}</h2><button class="icon-btn bot-edit-btn" type="button" title="Edit bot" aria-label="Edit bot"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-1 1-3.828-3.828 1-1a2 2 0 012.828 0zM2 13.586l9.586-9.586 3.828 3.828L5.828 17.414H2v-3.828z"/></svg></button></div><p>${bot.description || 'No description provided.'}</p><div class="detail-actions detail-actions-inline"><button class="btn btn-primary" onclick="startNewChat('${bot.name}')">Start New Chat</button><div class="persona-picker"><button class="btn btn-secondary persona-picker-btn" type="button" id="personaPickerBtn"></button><div class="persona-picker-menu hidden" id="personaPickerMenu"></div></div><button class="btn btn-secondary" onclick="continuePreviousChat('${bot.name}')">Continue Last Chat</button></div></div>`;
	messagesContainer.appendChild(detail);
	const editBtn = detail.querySelector('.bot-edit-btn');
	const personaPickerBtn = detail.querySelector('#personaPickerBtn');
	const personaPickerMenu = detail.querySelector('#personaPickerMenu');
	if (editBtn) {
		editBtn.addEventListener('click', () => {
			showBotEditor(bot);
		});
	}
	if (personaPickerBtn && personaPickerMenu) {
		setPersonaPickerButtonContent(personaPickerBtn, currentPersonaInfo);
		const closePersonaPicker = (event) => {
			if (!detail.contains(event.target)) {
				personaPickerMenu.classList.add('hidden');
				document.removeEventListener('click', closePersonaPicker);
			}
		};
		loadPersonaPickerOptions(personaPickerMenu, personaPickerBtn);
		personaPickerBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			const isHidden = personaPickerMenu.classList.contains('hidden');
			if (isHidden) {
				loadPersonaPickerOptions(personaPickerMenu, personaPickerBtn);
				setTimeout(() => {
					document.addEventListener('click', closePersonaPicker);
				}, 0);
			} else {
				document.removeEventListener('click', closePersonaPicker);
			}
			personaPickerMenu.classList.toggle('hidden');
		});
	}
}

function startNewChat(botName) {
	const title = prompt('Chat title (optional):') || 'Chat with ' + botName;
	postJson('/api/bot/select', { bot_name: botName })
		.then(r => r.json())
		.then(botData => {
			if (botData.success) {
				currentBotInfo = botData.bot;
			}
			return postJson('/api/bot/iam', { action: 'list_sets', bot_name: botName })
				.then(r => r.json())
				.then(iamData => {
					const defaultIamSet = (typeof DEFAULT_IAM_SET !== 'undefined' && DEFAULT_IAM_SET) ? DEFAULT_IAM_SET : 'IAM_1';
					const setNames = (typeof getSortedIamSetNames === 'function')
						? getSortedIamSetNames((iamData && iamData.sets) ? iamData.sets : [defaultIamSet])
						: ((iamData && iamData.sets) || [defaultIamSet]);
					const selectedIamSet = setNames && setNames.length ? setNames[0] : defaultIamSet;
					chatBotIamSelections[botName] = selectedIamSet;

					return postJson('/api/chats', { action: 'create', bot_name: botName, title: title, persona_name: (currentPersonaInfo && currentPersonaInfo.name) ? currentPersonaInfo.name : 'User', iam_set: selectedIamSet });
				});
		})
		.then(r => r.json())
		.then(chat => {
			currentChatId = chat.id;
			currentBotName = botName;
			return postJson('/api/load-chat', { chat_id: chat.id, bot_name: botName });
		})
		.then(r => r.json())
		.then(data => {
			currentChatMessages = (data && data.messages) ? data.messages : [];
			setCurrentChatContextStats((data && data.context) ? data.context : null);
			renderCurrentChat();
			switchToLastChat();
			updateBotPanel();
		});
}

function continuePreviousChat(botName) {
	postJson('/api/bot/select', { bot_name: botName })
		.then(r => r.json())
		.then(botData => {
			if (botData.success) {
				currentBotInfo = botData.bot;
			}
			return postJson('/api/last-chat', { bot_name: botName });
		})
		.then(r => r.json())
		.then(data => {
			if (data && data.chat_info) {
				currentChatId = data.chat_info.id;
				currentBotName = data.chat_info.bot || botName;
				currentChatMessages = data.messages || [];
				setCurrentChatContextStats(data.context || null);
				switchToLastChat();
				updateBotPanel();
			} else {
				alert('No previous chat found for this bot');
				startNewChat(botName);
			}
		});
}

function createBot() {
	createBotFromDraft();
}
