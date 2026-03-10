const MAIN_PAGE_DRAFT_KEY = 'nova.mainPage.quickDraft';

function postMainPageJson(url, payload) {
	return fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
}

function parseJsonResponseSafe(response, fallbackErrorMessage) {
	return response.text().then(text => {
		let parsed = null;
		if (text && text.trim()) {
			try {
				parsed = JSON.parse(text);
			} catch (_err) {
				parsed = null;
			}
		}

		if (!response.ok) {
			const backendError = parsed && (parsed.error || parsed.message);
			throw new Error(backendError || fallbackErrorMessage || `Request failed (${response.status})`);
		}

		if (parsed !== null) {
			return parsed;
		}

		if (!text || !text.trim()) {
			return {};
		}

		throw new Error('Received invalid JSON response from server.');
	});
}

function getCurrentPersonaNameForMainPage() {
	return (currentPersonaInfo && currentPersonaInfo.name) ? currentPersonaInfo.name : 'User';
}

function setMainPageQuickDraft(value) {
	if (!`${value || ''}`.trim()) {
		localStorage.removeItem(MAIN_PAGE_DRAFT_KEY);
		return;
	}
	localStorage.setItem(MAIN_PAGE_DRAFT_KEY, String(value));
}

function getMainPageQuickDraft() {
	return localStorage.getItem(MAIN_PAGE_DRAFT_KEY) || '';
}

function showMainPage() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Main Page <span id="mainPageStatusChip" class="main-page-status-chip main-page-status-checking">Checking Nova...</span></div><div class="chat-subtitle">Quick start</div></div>';
	messagesContainer.innerHTML = `
		<div class="main-page-layout">
			<div class="main-page-bg main-page-bg-circuit" aria-hidden="true"></div>
			<div class="main-page-bg main-page-bg-beam" aria-hidden="true"></div>
			<div class="main-page-bg main-page-bg-noise" aria-hidden="true"></div>
			<div id="mainPageCodeRain" class="main-page-code-rain" aria-hidden="true"></div>
			<div class="main-page-quick-chat-wrap" id="mainPageQuickChatWrap">
				<div class="main-page-quick-chat-title">Quick chat with Nova</div>
				<div class="main-page-quick-chat-subtitle">Open a fresh conversation instantly and send your first message.</div>
				<div class="main-page-quick-chat-actions">
					<button type="button" class="main-page-chip-btn" data-template="Hey Nova!">Say hi</button>
					<button type="button" class="main-page-chip-btn" data-template="Help me brainstorm 5 ideas for: ">Brainstorm</button>
					<button type="button" class="main-page-chip-btn" data-template="Help me write code for: ">Code help</button>
				</div>
				<div class="main-page-quick-chat-input-wrap">
					<textarea id="mainPageQuickChatInput" class="input-field main-page-quick-chat-input" placeholder="Type your message to Nova..." rows="1"></textarea>
					<button id="mainPageQuickChatSend" class="send-btn main-page-quick-chat-send" type="button">Send</button>
				</div>
				<div class="main-page-quick-chat-controls">
					<div class="main-page-quick-chat-hint" id="mainPageQuickHint">Press Enter to send • Shift+Enter for a new line</div>
					<button id="mainPageContinueBtn" type="button" class="btn btn-secondary main-page-continue-btn">Continue last Nova chat</button>
				</div>
				<div class="main-page-inline-error" id="mainPageInlineError" role="status" aria-live="polite"></div>
			</div>
			<a id="mainPageCoffeeBanner" class="main-page-coffee-banner" href="https://buymeacoffee.com/saimon_szaszakg" target="_blank" rel="noopener noreferrer">
				<div class="main-page-coffee-badge">☕</div>
				<div class="main-page-coffee-content">
					<div class="main-page-coffee-title">Support BlueNovaAI</div>
					<div class="main-page-coffee-subtitle">buymeacoffee.com/saimon_szaszakg</div>
					<div class="main-page-coffee-cta">Tap to open BuyMeACoffee</div>
				</div>
			</a>
		</div>
	`;

	const statusChip = document.getElementById('mainPageStatusChip');
	const quickWrap = document.getElementById('mainPageQuickChatWrap');
	const quickInput = document.getElementById('mainPageQuickChatInput');
	const quickSend = document.getElementById('mainPageQuickChatSend');
	const continueBtn = document.getElementById('mainPageContinueBtn');
	const codeRain = document.getElementById('mainPageCodeRain');
	const inlineError = document.getElementById('mainPageInlineError');
	const coffeeBanner = document.getElementById('mainPageCoffeeBanner');
	const quickActionButtons = Array.from(document.querySelectorAll('.main-page-chip-btn'));

	let targetBotName = 'Nova';
	let isSubmitting = false;

	const setStatusChip = (text, variant = 'checking') => {
		if (!statusChip) {
			return;
		}
		statusChip.textContent = text;
		statusChip.className = `main-page-status-chip main-page-status-${variant}`;
	};

	const setInlineError = (text) => {
		if (!inlineError) {
			return;
		}
		inlineError.textContent = text || '';
		inlineError.classList.toggle('visible', !!text);
	};

	const setBusyState = (busy, buttonText = 'Send') => {
		isSubmitting = !!busy;
		if (quickInput) {
			quickInput.disabled = !!busy;
		}
		if (quickSend) {
			quickSend.disabled = !!busy;
			quickSend.textContent = buttonText;
			quickSend.classList.toggle('is-loading', !!busy);
		}
		if (continueBtn) {
			continueBtn.disabled = !!busy;
		}
		quickActionButtons.forEach(button => {
			button.disabled = !!busy;
		});
	};

	const seedCodeRain = () => {
		if (!codeRain) {
			return;
		}
		const snippets = [
			'if (nova.ready) { chat.start(); }',
			'vector.embed(memory_chunk)',
			'prompt.compile(core, persona, iam)',
			'for await (token of stream) emit(token)',
			'model.route("Nova", task)',
			'const signal = ai.infer(context);',
			'latency=42ms • tokens=512',
			'>>> initialize neural stack',
			'pipeline.execute("reply")',
			'cache.hit(memory_signature)',
			'safety.pass == true',
			'// BlueNovaAI runtime'
		];
		const easterEggSnippets = [
			'You should also try Silly Tavern!',
			'*Cries in AI hard.*',
			'Life me, me! -Jan Izydor Sztaudynger',
			'I like feet.'
		];
		let activeEasterEggLine = null;
		let lastEasterEggText = '';
		const easterEggSpawnIntervalMs = 15000;

		const applyRandomLineState = (line) => {
			if (line.dataset.easterEgg === '1' && activeEasterEggLine === line) {
				activeEasterEggLine = null;
			}
			line.dataset.easterEgg = '0';
			line.textContent = snippets[Math.floor(Math.random() * snippets.length)];
			line.style.setProperty('--x', `${Math.random() * 100}%`);
			line.style.setProperty('--delay', `${(Math.random() * 10).toFixed(2)}s`);
			line.style.setProperty('--duration', `${(8 + Math.random() * 10).toFixed(2)}s`);
			line.style.setProperty('--size', `${(0.62 + Math.random() * 0.32).toFixed(2)}rem`);
			line.style.setProperty('--opacity', `${(0.18 + Math.random() * 0.28).toFixed(2)}`);
			line.style.setProperty('--drift', `${(-3 - Math.random() * 12).toFixed(2)}vw`);
			line.style.setProperty('--startY', `${(-6 - Math.random() * 20).toFixed(2)}vh`);
		};

		const spawnEasterEgg = () => {
			if (!codeRain || !codeRain.isConnected) {
				if (window.__novaMainPageEggTimer) {
					clearInterval(window.__novaMainPageEggTimer);
					window.__novaMainPageEggTimer = null;
				}
				return;
			}

			const lines = Array.from(codeRain.querySelectorAll('.main-page-code-line'));
			if (!lines.length) {
				return;
			}

			if (activeEasterEggLine && activeEasterEggLine.isConnected) {
				applyRandomLineState(activeEasterEggLine);
			}

			const targetLine = lines[Math.floor(Math.random() * lines.length)];
			let candidate = easterEggSnippets[Math.floor(Math.random() * easterEggSnippets.length)];
			if (easterEggSnippets.length > 1 && candidate === lastEasterEggText) {
				let guard = 0;
				while (candidate === lastEasterEggText && guard < 8) {
					candidate = easterEggSnippets[Math.floor(Math.random() * easterEggSnippets.length)];
					guard += 1;
				}
			}

			targetLine.dataset.easterEgg = '1';
			targetLine.textContent = candidate;
			lastEasterEggText = candidate;
			activeEasterEggLine = targetLine;

			targetLine.style.setProperty('--x', `${Math.random() * 100}%`);
			targetLine.style.setProperty('--delay', '0s');
			targetLine.style.setProperty('--duration', '10.80s');
			targetLine.style.setProperty('--size', `${(0.70 + Math.random() * 0.24).toFixed(2)}rem`);
			targetLine.style.setProperty('--opacity', `${(0.34 + Math.random() * 0.20).toFixed(2)}`);
			targetLine.style.setProperty('--drift', `${(-2 - Math.random() * 10).toFixed(2)}vw`);
			targetLine.style.setProperty('--startY', `${(-8 - Math.random() * 14).toFixed(2)}vh`);

			targetLine.style.animation = 'none';
			void targetLine.offsetWidth;
			targetLine.style.animation = '';
		};

		codeRain.innerHTML = '';
		for (let index = 0; index < 34; index += 1) {
			const line = document.createElement('span');
			line.className = 'main-page-code-line';
			applyRandomLineState(line);
			line.addEventListener('animationiteration', () => {
				applyRandomLineState(line);
			});
			codeRain.appendChild(line);
		}

		if (window.__novaMainPageEggTimer) {
			clearInterval(window.__novaMainPageEggTimer);
			window.__novaMainPageEggTimer = null;
		}
		window.__novaMainPageEggTimer = setInterval(spawnEasterEgg, easterEggSpawnIntervalMs);
		setTimeout(spawnEasterEgg, easterEggSpawnIntervalMs);
	};

	const autoResizeQuickInput = () => {
		if (!quickInput) {
			return;
		}
		quickInput.style.height = 'auto';
		const buttonHeight = quickSend ? Math.round(quickSend.getBoundingClientRect().height) : 0;
		const minHeight = Math.max(44, buttonHeight || 52);
		const maxHeight = 208;
		const nextHeight = Math.max(minHeight, Math.min(maxHeight, quickInput.scrollHeight));
		quickInput.style.height = `${nextHeight}px`;
		quickInput.style.overflowY = quickInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
	};

	const shouldAutoFocusQuickInput = () => {
		const active = document.activeElement;
		if (!active || active === document.body) {
			return true;
		}
		if (active.id === 'mainPageQuickChatInput') {
			return true;
		}
		const tag = `${active.tagName || ''}`.toLowerCase();
		if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') {
			return false;
		}
		return true;
	};

	const transitionToChatAndSend = (messageText) => {
		if (quickWrap) {
			quickWrap.classList.add('is-exiting');
		}
		setTimeout(() => {
			switchToLastChat();
			requestAnimationFrame(() => {
				messageInput.value = messageText;
				autoResizeMessageInput();
				sendMessage();
			});
		}, 170);
	};

	const createNewChatForBot = (botName, title) => {
		return postMainPageJson('/api/bot/select', { bot_name: botName })
			.then(r => parseJsonResponseSafe(r, 'Failed to select Nova bot.'))
			.then(botData => {
				if (!botData || !botData.success) {
					throw new Error('Nova bot is not available.');
				}
				currentBotInfo = botData.bot;
				return postMainPageJson('/api/bot/iam', { action: 'list_sets', bot_name: botName })
					.then(r => parseJsonResponseSafe(r, 'Failed to load IAM sets.'));
			})
			.then(iamData => {
				const defaultIamSet = (typeof DEFAULT_IAM_SET !== 'undefined' && DEFAULT_IAM_SET) ? DEFAULT_IAM_SET : 'IAM_1';
				const setNames = (typeof getSortedIamSetNames === 'function')
					? getSortedIamSetNames((iamData && iamData.sets) ? iamData.sets : [defaultIamSet])
					: ((iamData && iamData.sets) || [defaultIamSet]);
				const selectedIamSet = setNames && setNames.length ? setNames[0] : defaultIamSet;
				chatBotIamSelections[botName] = selectedIamSet;
				return postMainPageJson('/api/chats', {
					action: 'create',
					bot_name: botName,
					title,
					persona_name: getCurrentPersonaNameForMainPage(),
					iam_set: selectedIamSet
				});
			})
			.then(r => parseJsonResponseSafe(r, 'Failed to create chat.'))
			.then(chat => {
				if (!chat || !chat.id) {
					throw new Error('Failed to create chat.');
				}
				currentChatId = chat.id;
				currentBotName = botName;
				return postMainPageJson('/api/load-chat', { chat_id: chat.id, bot_name: botName });
			})
			.then(r => parseJsonResponseSafe(r, 'Failed to load created chat.'))
			.then(data => {
				currentChatMessages = (data && data.messages) ? data.messages : [];
				setCurrentChatContextStats((data && data.context) ? data.context : null);
				if (typeof updateBotPanel === 'function') {
					updateBotPanel();
				}
			});
	};

	const submitQuickMessage = () => {
		if (!quickInput || isSubmitting) {
			return;
		}
		const message = `${quickInput.value || ''}`.trim();
		if (!message) {
			setInlineError('Message cannot be empty.');
			return;
		}
		setInlineError('');
		setBusyState(true, 'Sending...');
		createNewChatForBot(targetBotName, 'Quick chat with Nova')
			.then(() => {
				setMainPageQuickDraft('');
				transitionToChatAndSend(message);
			})
			.catch(error => {
				const messageText = (error && error.message) ? error.message : 'Quick chat failed.';
				setInlineError(messageText);
				showToast(messageText, 'error');
				setBusyState(false, 'Send');
				if (quickInput) {
					quickInput.focus();
				}
			});
	};

	const continueLastChat = () => {
		if (isSubmitting) {
			return;
		}
		setInlineError('');
		setBusyState(true, 'Send');
		postMainPageJson('/api/last-chat', { bot_name: targetBotName })
			.then(r => parseJsonResponseSafe(r, 'Unable to continue chat.'))
			.then(data => {
				if (!data || !data.chat_info) {
					throw new Error('No previous Nova chat found.');
				}
				const chatId = data.chat_info.id;
				const botName = data.chat_info.bot || targetBotName;
				if (typeof openChat === 'function') {
					openChat(chatId, botName);
					return;
				}
				currentChatId = chatId;
				currentBotName = botName;
				currentChatMessages = data.messages || [];
				setCurrentChatContextStats(data.context || null);
				switchToLastChat();
				if (typeof updateBotPanel === 'function') {
					updateBotPanel();
				}
			})
			.catch(error => {
				setInlineError((error && error.message) ? error.message : 'Unable to continue chat.');
				setBusyState(false, 'Send');
			});
	};

	const persistedDraft = getMainPageQuickDraft();
	if (quickInput && persistedDraft) {
		quickInput.value = persistedDraft;
	}
	autoResizeQuickInput();
	seedCodeRain();

	if (quickActionButtons.length && quickInput) {
		quickActionButtons.forEach(button => {
			button.addEventListener('click', () => {
				const template = `${button.dataset.template || ''}`;
				quickInput.value = template;
				setMainPageQuickDraft(template);
				autoResizeQuickInput();
				quickInput.focus();
				const pos = quickInput.value.length;
				quickInput.setSelectionRange(pos, pos);
			});
		});
	}

	if (quickSend) {
		quickSend.addEventListener('click', submitQuickMessage);
	}
	if (continueBtn) {
		continueBtn.addEventListener('click', continueLastChat);
	}

	if (quickInput) {
		quickInput.addEventListener('keydown', event => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				submitQuickMessage();
			}
		});
		quickInput.addEventListener('input', () => {
			setInlineError('');
			setMainPageQuickDraft(quickInput.value);
			autoResizeQuickInput();
		});
		if (shouldAutoFocusQuickInput()) {
			quickInput.focus();
		}
	}

	fetch('/api/main-page')
		.then(r => parseJsonResponseSafe(r, 'Failed to load main page config.'))
		.then(config => {
			const botName = `${(config && config.quick_chat_bot_name) || ''}`.trim();
			if (botName) {
				targetBotName = botName;
			}
			const bannerUrl = `${(config && config.support_url) || ''}`.trim();
			if (coffeeBanner && bannerUrl) {
				const normalized = /^https?:\/\//i.test(bannerUrl) ? bannerUrl : `https://${bannerUrl}`;
				coffeeBanner.href = normalized;
			}
		})
		.catch(() => {});

	Promise.all([
		fetch('/api/settings').then(r => parseJsonResponseSafe(r, 'Failed to load settings.')).catch(() => ({})),
		fetch('/api/bots').then(r => parseJsonResponseSafe(r, 'Failed to load bots.')).catch(() => ([]))
	]).then(([settings, bots]) => {
		const botList = Array.isArray(bots) ? bots : [];
		const activeBot = botList.find(bot => `${(bot && bot.name) || ''}`.trim().toLowerCase() === targetBotName.toLowerCase());
		if (!activeBot) {
			setStatusChip('Nova offline', 'offline');
			return;
		}
		const provider = `${(settings && settings.api_provider) || ''}`.trim();
		const model = `${(settings && settings.model) || ''}`.trim();
		let modelDisplay = '';
		if (model) {
			modelDisplay = model.length > 26 ? `${model.slice(0, 26)}…` : model;
		}
		if (provider && modelDisplay) {
			setStatusChip(`${provider} • ${modelDisplay}`, 'online');
			return;
		}
		setStatusChip('Nova ready', 'online');
	});
}
