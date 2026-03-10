(function () {
	'use strict';
	if (window.__autoSummarySingleton && window.__autoSummarySingleton.initialized) {
		return;
	}
	window.__autoSummarySingleton = window.__autoSummarySingleton || { initialized: false };

	const CORE_MARKER = '[[AUTO_SUMMARY_CORE]]';
	const HIDDEN_MARKER = '[[AUTO_SUMMARY_HIDDEN]]';
	const STATUS_POLL_MS = 1500;
	const STATUS_POLL_BACKOFF_MS = 15000;
	const STATUS_POLL_MISSING_THRESHOLD = 3;

	let injectScheduled = false;
	let statusInterval = null;
	let originalRenderCurrentChat = null;
	let originalAddMessage = null;
	let originalPersistEditedMessage = null;
	let originalRunChatMessageAction = null;
	let originalStreamAssistantReplyFromBackend = null;
	let originalStreamChatActionFromBackend = null;
	let originalRunChatMessageActionForStatus = null;
	let visibleToRealIndexMap = [];
	let missingStatusCount = 0;
	let skipStatusPollUntilMs = 0;
	let lastStatusContextKey = '';
	let statusWatchDepth = 0;

	function safeText(value) {
		return `${value || ''}`;
	}

	function hasMarker(text, marker) {
		return safeText(text).includes(marker);
	}

	function stripMarkersForDisplay(text) {
		return safeText(text)
			.replaceAll(CORE_MARKER, '')
			.replaceAll(HIDDEN_MARKER, '')
			.replaceAll('[[AUTO_SUMMARY_PHASE1]]', '')
			.replaceAll('[[AUTO_SUMMARY_PHASE2]]', '')
			.replaceAll('[[AUTO_SUMMARY_PHASE3]]', '')
			.replace(/[ \t]{2,}/g, ' ');
	}

	function withCoreMarker(text) {
		const stripped = safeText(text).replaceAll(CORE_MARKER, '');
		return stripped ? `${CORE_MARKER} ${stripped}` : CORE_MARKER;
	}

	function withoutCoreMarker(text) {
		return safeText(text).replaceAll(CORE_MARKER, '').replace(/[ \t]{2,}/g, ' ');
	}

	function isHiddenMessage(message) {
		if (!message || typeof message !== 'object') {
			return false;
		}
		return hasMarker(message.content, HIDDEN_MARKER);
	}

	function mapVisibleIndexToReal(visibleIndex) {
		if (!Number.isInteger(visibleIndex)) {
			return visibleIndex;
		}
		if (!Array.isArray(visibleToRealIndexMap) || visibleToRealIndexMap.length === 0) {
			return visibleIndex;
		}
		if (visibleIndex < 0 || visibleIndex >= visibleToRealIndexMap.length) {
			return visibleIndex;
		}
		const mapped = visibleToRealIndexMap[visibleIndex];
		return Number.isInteger(mapped) ? mapped : visibleIndex;
	}

	function scheduleInjectCoreButtons() {
		if (injectScheduled) {
			return;
		}
		injectScheduled = true;
		requestAnimationFrame(() => {
			injectScheduled = false;
			injectCoreButtons();
		});
	}

	function patchRendering() {
		if (typeof window.renderCurrentChat === 'function' && !originalRenderCurrentChat) {
			originalRenderCurrentChat = window.renderCurrentChat;
			window.renderCurrentChat = function () {
				const source = Array.isArray(window.currentChatMessages) ? window.currentChatMessages : [];
				const visible = [];
				const map = [];
				source.forEach((msg, index) => {
					if (isHiddenMessage(msg)) {
						return;
					}
					visible.push(msg);
					map.push(index);
				});
				visibleToRealIndexMap = map;

				const backup = window.currentChatMessages;
				window.currentChatMessages = visible;
				try {
					return originalRenderCurrentChat.apply(this, arguments);
				} finally {
					window.currentChatMessages = backup;
					scheduleInjectCoreButtons();
				}
			};
		}

		if (typeof window.addMessage === 'function' && !originalAddMessage) {
			originalAddMessage = window.addMessage;
			window.addMessage = function (text) {
				const nextArgs = Array.from(arguments);
				nextArgs[0] = stripMarkersForDisplay(text);
				return originalAddMessage.apply(this, nextArgs);
			};
		}

		if (typeof window.persistEditedMessage === 'function' && !originalPersistEditedMessage) {
			originalPersistEditedMessage = window.persistEditedMessage;
			window.persistEditedMessage = function (messageIndex, content) {
				const realIndex = mapVisibleIndexToReal(messageIndex);
				return originalPersistEditedMessage.call(this, realIndex, content);
			};
		}

		if (typeof window.runChatMessageAction === 'function' && !originalRunChatMessageAction) {
			originalRunChatMessageAction = window.runChatMessageAction;
			window.runChatMessageAction = function (action, messageIndex, clientMessageCountOverride) {
				const realIndex = mapVisibleIndexToReal(messageIndex);
				return originalRunChatMessageAction.call(this, action, realIndex, clientMessageCountOverride);
			};
		}
	}

	function getVisibleMessageElements() {
		const container = document.getElementById('messages');
		if (!container) {
			return [];
		}
		return Array.from(container.querySelectorAll('.message'));
	}

	function updateCoreButtonState(button, isProtected) {
		button.textContent = isProtected ? '🔒' : '🔓';
		button.setAttribute('title', isProtected ? 'Unmark Core Memory' : 'Mark as Core Memory');
		button.setAttribute('aria-label', button.getAttribute('title') || 'Toggle Core Memory');
		button.dataset.protected = isProtected ? '1' : '0';
	}

	function injectCoreButtons() {
		if (!Array.isArray(window.currentChatMessages)) {
			return;
		}

		const visibleMessages = getVisibleMessageElements();
		visibleMessages.forEach((messageEl, visibleIndex) => {
			const actionsWrap = messageEl.querySelector('.message-actions');
			if (!actionsWrap) {
				return;
			}

			let button = actionsWrap.querySelector('.message-action-core-memory');
			if (!button) {
				button = document.createElement('button');
				button.type = 'button';
				button.className = 'message-action-btn message-action-core-memory';
				actionsWrap.appendChild(button);
			}

			const realIndex = mapVisibleIndexToReal(visibleIndex);
			const message = window.currentChatMessages[realIndex];
			if (!message || typeof message !== 'object') {
				button.style.display = 'none';
				return;
			}
			button.style.display = 'inline-flex';
			button.dataset.realIndex = String(realIndex);

			const currentlyProtected = hasMarker(message.content, CORE_MARKER);
			updateCoreButtonState(button, currentlyProtected);

			if (button.dataset.bound !== '1') {
				button.dataset.bound = '1';
				button.addEventListener('click', () => {
					const rawIndex = Number.parseInt(button.dataset.realIndex || '-1', 10);
					if (!Number.isInteger(rawIndex) || rawIndex < 0) {
						return;
					}
					if (!Array.isArray(window.currentChatMessages) || !window.currentChatMessages[rawIndex]) {
						return;
					}

					const current = window.currentChatMessages[rawIndex];
					const nextProtected = !hasMarker(current.content, CORE_MARKER);
					const nextContent = nextProtected
						? withCoreMarker(current.content)
						: withoutCoreMarker(current.content);

					button.disabled = true;
					updateCoreButtonState(button, nextProtected);

					if (typeof window.persistEditedMessage !== 'function') {
						button.disabled = false;
						return;
					}

					window.persistEditedMessage(rawIndex, nextContent)
						.then((result) => {
							if (!result || !result.success) {
								updateCoreButtonState(button, hasMarker(current.content, CORE_MARKER));
								button.disabled = false;
								return;
							}
							if (Array.isArray(result.messages)) {
								window.currentChatMessages = result.messages;
							} else {
								window.currentChatMessages[rawIndex].content = nextContent;
							}
							if (typeof window.renderCurrentChat === 'function') {
								window.renderCurrentChat();
							}
						})
						.catch(() => {
							updateCoreButtonState(button, hasMarker(current.content, CORE_MARKER));
						})
						.finally(() => {
							button.disabled = false;
						});
				});
			}
		});
	}

	function ensureStatusBanner() {
		let banner = document.getElementById('auto-summary-phase3-banner');
		if (banner) {
			return banner;
		}
		const inputArea = document.getElementById('inputArea');
		if (!inputArea) {
			return null;
		}
		banner = document.createElement('div');
		banner.id = 'auto-summary-phase3-banner';
		banner.className = 'auto-summary-phase3-banner';
		banner.textContent = 'Summarizing chat history. This might take a while...';
		banner.style.display = 'none';
		inputArea.prepend(banner);
		return banner;
	}

	function setPhase3Lock(locked, messageText = '') {
		const sendBtn = document.getElementById('sendBtn');
		const input = document.getElementById('messageInput');
		const banner = ensureStatusBanner();
		if (sendBtn) {
			sendBtn.disabled = !!locked;
		}
		if (input) {
			input.disabled = !!locked;
		}
		if (banner) {
			banner.textContent = messageText || 'Summarizing chat history. This might take a while...';
			banner.style.display = locked ? 'block' : 'none';
		}
	}

	function statusUrl() {
		const bot = window.currentBotName;
		const chat = window.currentChatId;
		if (!bot || !chat) {
			return '';
		}
		const safeBot = encodeURIComponent(String(bot));
		const safeChat = encodeURIComponent(String(chat));
		return `/Modules/Auto%20Summary/runtime/auto_summary_status_${safeBot}_${safeChat}.json?ts=${Date.now()}`;
	}

	function getActivePromptOrderState() {
		const info = window.currentBotInfo;
		if (!info || typeof info !== 'object') {
			return { order: [], enabled: {} };
		}
		const order = Array.isArray(info.prompt_order) ? info.prompt_order : [];
		const enabled = (info.prompt_order_enabled && typeof info.prompt_order_enabled === 'object')
			? info.prompt_order_enabled
			: {};
		return { order, enabled };
	}

	function normalizeModuleName(value) {
		return `${value || ''}`.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
	}

	function resolveAutoSummaryPromptKey(state) {
		const order = Array.isArray(state && state.order) ? state.order : [];
		const target = normalizeModuleName('Auto Summary');
		for (const rawKey of order) {
			const key = `${rawKey || ''}`.trim();
			if (!key.startsWith('module::')) {
				continue;
			}
			const moduleName = key.slice('module::'.length);
			if (normalizeModuleName(moduleName) === target) {
				return key;
			}
		}
		return null;
	}

	function isAutoSummaryEnabledForCurrentBot() {
		const state = getActivePromptOrderState();
		const moduleKey = resolveAutoSummaryPromptKey(state);
		if (!moduleKey) {
			return false;
		}
		if (Object.prototype.hasOwnProperty.call(state.enabled, moduleKey)) {
			return !!state.enabled[moduleKey];
		}
		return true;
	}

	function pollPhase3Status() {
		if (!isAutoSummaryEnabledForCurrentBot()) {
			setPhase3Lock(false);
			return;
		}

		const contextKey = `${window.currentBotName || ''}::${window.currentChatId || ''}`;
		if (contextKey !== lastStatusContextKey) {
			lastStatusContextKey = contextKey;
			missingStatusCount = 0;
			skipStatusPollUntilMs = 0;
		}

		if (skipStatusPollUntilMs && Date.now() < skipStatusPollUntilMs) {
			return;
		}

		const url = statusUrl();
		if (!url) {
			setPhase3Lock(false);
			return;
		}
		fetch(url)
			.then((r) => {
				if (!r.ok) {
					if (r.status === 404) {
						missingStatusCount += 1;
						if (missingStatusCount >= STATUS_POLL_MISSING_THRESHOLD) {
							skipStatusPollUntilMs = Date.now() + STATUS_POLL_BACKOFF_MS;
						}
					}
					return null;
				}
				missingStatusCount = 0;
				skipStatusPollUntilMs = 0;
				return r.json();
			})
			.then((data) => {
				const active = !!(data && data.phase3_active);
				const pass = Number.isInteger(data && data.pass) ? data.pass : null;
				const baseMsg = (data && data.message) ? `${data.message}` : 'Summarizing chat history. This might take a while...';
				const finalMsg = pass !== null ? `${baseMsg} (Pass ${pass})` : baseMsg;
				setPhase3Lock(active, finalMsg);
			})
			.catch(() => {
				setPhase3Lock(false, '');
			});
	}

	function startScopedStatusPolling() {
		statusWatchDepth += 1;
		if (statusWatchDepth > 1) {
			return;
		}
		missingStatusCount = 0;
		skipStatusPollUntilMs = 0;
		if (!statusInterval) {
			statusInterval = window.setInterval(pollPhase3Status, STATUS_POLL_MS);
		}
		pollPhase3Status();
	}

	function stopScopedStatusPolling() {
		statusWatchDepth = Math.max(0, statusWatchDepth - 1);
		if (statusWatchDepth !== 0) {
			return;
		}
		if (statusInterval) {
			window.clearInterval(statusInterval);
			statusInterval = null;
		}
		setPhase3Lock(false, '');
	}

	function trackStatusForPromise(promise) {
		if (!promise || typeof promise.finally !== 'function') {
			stopScopedStatusPolling();
			return promise;
		}
		return promise.finally(() => {
			stopScopedStatusPolling();
		});
	}

	function patchTurnLifecycleStatusTracking() {
		if (typeof window.streamAssistantReplyFromBackend === 'function' && !originalStreamAssistantReplyFromBackend) {
			originalStreamAssistantReplyFromBackend = window.streamAssistantReplyFromBackend;
			window.streamAssistantReplyFromBackend = function () {
				startScopedStatusPolling();
				const result = originalStreamAssistantReplyFromBackend.apply(this, arguments);
				return trackStatusForPromise(result);
			};
		}

		if (typeof window.streamChatActionFromBackend === 'function' && !originalStreamChatActionFromBackend) {
			originalStreamChatActionFromBackend = window.streamChatActionFromBackend;
			window.streamChatActionFromBackend = function () {
				startScopedStatusPolling();
				const result = originalStreamChatActionFromBackend.apply(this, arguments);
				return trackStatusForPromise(result);
			};
		}

		if (typeof window.runChatMessageAction === 'function' && !originalRunChatMessageActionForStatus) {
			originalRunChatMessageActionForStatus = window.runChatMessageAction;
			window.runChatMessageAction = function (action) {
				const actionKey = `${action || ''}`.trim().toLowerCase();
				const shouldTrack = actionKey === 'regenerate_message' || actionKey === 'continue_message';
				if (shouldTrack) {
					startScopedStatusPolling();
				}
				const result = originalRunChatMessageActionForStatus.apply(this, arguments);
				if (!shouldTrack) {
					return result;
				}
				return trackStatusForPromise(result);
			};
		}
	}

	function init() {
		if (window.__autoSummarySingleton && window.__autoSummarySingleton.initialized) {
			return;
		}
		if (window.__autoSummarySingleton) {
			window.__autoSummarySingleton.initialized = true;
		}
		patchRendering();
		patchTurnLifecycleStatusTracking();
		scheduleInjectCoreButtons();
		setPhase3Lock(false, '');
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
