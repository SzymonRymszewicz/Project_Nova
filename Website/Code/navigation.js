function postNavigationJson(url, payload) {
	return fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
}

function requestStopGenerationFallback(chatId, botName) {
	if (!chatId || !botName) {
		return;
	}
	postNavigationJson('/api/stop-generation', { chat_id: chatId, bot_name: botName }).catch(() => {});
}

function maybeStopGenerationBeforeNavigation(previousView, nextView) {
	if (previousView !== 'last-chat' || nextView === 'last-chat') {
		return;
	}
	if (typeof stopMessageGeneration === 'function') {
		stopMessageGeneration(true);
	}
	// Safety fallback in case UI lock state is temporarily out of sync.
	requestStopGenerationFallback(window.currentChatId, window.currentBotName);
}

function renderViewByName(view) {
	const handlers = {
		'last-chat': showLastChat,
		'main-page': showMainPage,
		bots: showBots,
		'bot-create': showBotCreation,
		chats: showChats,
		personas: showPersonas,
		'persona-create': showPersonaCreation,
		dataset: showDataset,
		settings: showSettings,
		'help-me': showHelpMe,
		dev: showDev
	};
	const handler = handlers[view];
	if (typeof handler === 'function') {
		handler();
	}
}

function clickNavItemByView(view) {
	const target = document.querySelector(`.nav-item[data-view="${view}"]`);
	if (target) {
		target.click();
	}
}

function showView(view) {
	const previousView = currentView;
	maybeStopGenerationBeforeNavigation(previousView, view);
	currentView = view;
	const appRoot = document.querySelector('.app');
	const botPanel = document.getElementById('botPanel');
	if (botPanel) {
		botPanel.classList.toggle('visible', view === 'last-chat');
		if (typeof window.setBotPanelExpanded === 'function' && view !== 'last-chat') {
			window.setBotPanelExpanded(false);
		}
		if (view === 'last-chat') {
			updateBotPanel();
			if (typeof window.ensureBotPanelExpandToggle === 'function') {
				window.ensureBotPanelExpandToggle();
			}
		}
	}
	if (appRoot) {
		appRoot.classList.toggle('chat-layout', view === 'last-chat');
		appRoot.classList.toggle('main-page-view', view === 'main-page');
		appRoot.classList.toggle('help-me-view', view === 'help-me');
		appRoot.classList.toggle('dataset-view', view === 'dataset');
	}
	if (previousView === 'settings' && view !== 'settings') {
		revertUnsavedSettings();
	}
	messagesContainer.innerHTML = '';
	renderViewByName(view);
}

function switchToLastChat() {
	clickNavItemByView('last-chat');
}

function switchToMainPage() {
	clickNavItemByView('main-page');
}

function ensureAppFaviconLink() {
	let favicon = document.getElementById('appFavicon');
	if (!favicon) {
		favicon = document.createElement('link');
		favicon.id = 'appFavicon';
		favicon.rel = 'icon';
		document.head.appendChild(favicon);
	}
	return favicon;
}

function buildCircularFavicon(iconUrl, fit = null) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			const sizePx = 96;
			const canvas = document.createElement('canvas');
			canvas.width = sizePx;
			canvas.height = sizePx;
			const context = canvas.getContext('2d');
			if (!context) {
				reject(new Error('Canvas context unavailable'));
				return;
			}

			const scale = Number.isFinite(fit && fit.size) ? fit.size : 100;
			const posX = Number.isFinite(fit && fit.x) ? fit.x : 50;
			const posY = Number.isFinite(fit && fit.y) ? fit.y : 50;

			const targetWidth = sizePx * (scale / 100);
			const aspectRatio = image.naturalWidth > 0 ? (image.naturalHeight / image.naturalWidth) : 1;
			const targetHeight = targetWidth * aspectRatio;
			const drawX = (sizePx - targetWidth) * (posX / 100);
			const drawY = (sizePx - targetHeight) * (posY / 100);

			context.clearRect(0, 0, sizePx, sizePx);
			context.beginPath();
			context.arc(sizePx / 2, sizePx / 2, sizePx / 2, 0, Math.PI * 2);
			context.closePath();
			context.clip();
			context.drawImage(image, drawX, drawY, targetWidth, targetHeight);

			resolve(canvas.toDataURL('image/png'));
		};
		image.onerror = () => reject(new Error('Failed to load icon image'));
		image.src = iconUrl;
	});
}

function syncNovaFavicon() {
	fetch('/api/bots')
		.then(r => r.json())
		.then(bots => {
			const botList = Array.isArray(bots) ? bots : [];
			const novaBot = botList.find(bot => `${(bot && bot.name) || ''}`.trim().toLowerCase() === 'nova');
			if (!novaBot) {
				return;
			}
			const iconUrl = `${novaBot.icon_art || novaBot.cover_art || ''}`.trim();
			if (!iconUrl) {
				return;
			}
			return buildCircularFavicon(iconUrl, novaBot.icon_fit)
				.then(faviconDataUrl => {
					const favicon = ensureAppFaviconLink();
					favicon.type = 'image/png';
					favicon.href = faviconDataUrl;
				})
				.catch(() => {
					const favicon = ensureAppFaviconLink();
					favicon.type = 'image/png';
					favicon.href = iconUrl;
				});
		})
		.catch(() => {
			// Ignore favicon sync failures.
		});
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('input', autoResizeMessageInput);
messageInput.addEventListener('keydown', event => {
	if (event.isComposing) {
		return;
	}
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		sendMessage();
	}
});
navItems.forEach(item => {
	item.addEventListener('click', () => {
		const targetView = item.dataset.view;
		const leavingChat = currentView === 'last-chat' && targetView !== 'last-chat';
		if (leavingChat) {
			// Stop active generation but keep navigation intent on the clicked tab.
			if (typeof stopMessageGeneration === 'function') {
				stopMessageGeneration(true);
			}
		}
		navItems.forEach(i => i.classList.remove('active'));
		item.classList.add('active');
		showView(targetView);
	});
});

resetMessageInputHeight();
syncNovaFavicon();
switchToMainPage();
initSettings();
