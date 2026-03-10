function showLastChat() {
	renderCurrentChat();
}

let isGeneratingReply = false;
let activeGenerationController = null;
let activeGenerationToken = 0;
let isChatActionGenerating = false;
let actionStreamingToken = 0;
let activeChatActionController = null;
let lastContextIndicatorSignature = '';
let lastUiGenerationLocked = false;
const STREAMING_API_FALLBACK_MESSAGE = 'Somehing went wrong with the API client. Please check the settings or try to regenerate the message.';
const DEFAULT_THINKING_PLACEHOLDER_TEXT = 'Thinking';
const MODULE_PLACEHOLDER_CHANGE_LATENCY_MS = 400;
const CHAT_ACTION_HARD_TIMEOUT_MS = 70000;
const CHAT_ACTION_MAX_PROGRESSIVE_CHARS = 4500;
const moduleProcessingPlaceholders = new Map();
const moduleProgressStartAtByKey = new Map();
const moduleProgressEndTokenByKey = new Map();
let modulePlaceholderTransitionChain = Promise.resolve();
let thinkingOutputStreamToken = 0;

window.__novaSuspendContextTrackerUpdates = false;

function getCurrentPersonaPayload() {
	return {
		persona_id: (currentPersonaInfo && currentPersonaInfo.id) ? currentPersonaInfo.id : null,
		persona_name: (currentPersonaInfo && currentPersonaInfo.name) ? currentPersonaInfo.name : null
	};
}

function postJson(url, payload, options = null) {
	const fetchOptions = {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	};
	if (options && options.signal) {
		fetchOptions.signal = options.signal;
	}
	return fetch(url, fetchOptions);
}

function normalizeModuleProcessingName(value) {
	return `${value || ''}`.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function getActiveModulePlaceholderText() {
	const state = getActiveModulePlaceholderState();
	return state.text || DEFAULT_THINKING_PLACEHOLDER_TEXT;
}

function getActiveModulePlaceholderState() {
	let latestEntry = null;
	for (const entry of moduleProcessingPlaceholders.values()) {
		if (!entry || !entry.visible) {
			continue;
		}
		if (!latestEntry || (entry.updatedAt || 0) > (latestEntry.updatedAt || 0)) {
			latestEntry = entry;
		}
	}
	return {
		key: latestEntry && latestEntry.key ? latestEntry.key : '',
		moduleName: latestEntry && latestEntry.moduleName ? latestEntry.moduleName : '',
		text: (latestEntry && typeof latestEntry.text === 'string' ? latestEntry.text.trim() : '') || DEFAULT_THINKING_PLACEHOLDER_TEXT,
		thinkingOutput: latestEntry && typeof latestEntry.thinkingOutput === 'string' ? latestEntry.thinkingOutput : ''
	};
}

function getThinkingPlaceholderText() {
	return getActiveModulePlaceholderText();
}

function shouldShowThinking() {
	if (settingsDraft && typeof settingsDraft.show_thinking === 'boolean') {
		return settingsDraft.show_thinking;
	}
	if (lastSavedSettings && typeof lastSavedSettings.show_thinking === 'boolean') {
		return lastSavedSettings.show_thinking;
	}
	return false;
}

function stopThinkingOutputStream() {
	thinkingOutputStreamToken += 1;
}

function findLastThinkingMessage() {
	if (!Array.isArray(currentChatMessages) || !currentChatMessages.length) {
		return null;
	}
	for (let index = currentChatMessages.length - 1; index >= 0; index -= 1) {
		const row = currentChatMessages[index];
		if (row && row.thinking) {
			return row;
		}
	}
	return null;
}

function clearThinkingOutputFromThinkingMessages() {
	if (!Array.isArray(currentChatMessages) || !currentChatMessages.length) {
		return false;
	}
	let changed = false;
	for (const row of currentChatMessages) {
		if (!row || !row.thinking) {
			continue;
		}
		if (row.thinking_output || row.thinking_module_name || row.thinking_module_key) {
			delete row.thinking_output;
			delete row.thinking_module_name;
			delete row.thinking_module_key;
			changed = true;
		}
	}
	return changed;
}

function updateThinkingOutputForCurrentThinkingMessage(moduleKey, moduleName, targetOutput) {
	const activeThinkingMessage = findLastThinkingMessage();
	if (!activeThinkingMessage) {
		stopThinkingOutputStream();
		return false;
	}

	const cleanModuleKey = `${moduleKey || ''}`.trim();
	const cleanModuleName = `${moduleName || ''}`.trim();
	const cleanTarget = `${targetOutput || ''}`;
	const showThinking = shouldShowThinking();
	const previousModuleKey = `${activeThinkingMessage.thinking_module_key || ''}`;

	activeThinkingMessage.thinking_module_key = cleanModuleKey;
	activeThinkingMessage.thinking_module_name = cleanModuleName;

	if (!showThinking || !cleanTarget) {
		stopThinkingOutputStream();
		const hadOutput = !!activeThinkingMessage.thinking_output;
		delete activeThinkingMessage.thinking_output;
		return hadOutput;
	}

	if (!shouldEnableTextStreaming()) {
		stopThinkingOutputStream();
		if (`${activeThinkingMessage.thinking_output || ''}` === cleanTarget) {
			return false;
		}
		activeThinkingMessage.thinking_output = cleanTarget;
		return true;
	}

	let startText = `${activeThinkingMessage.thinking_output || ''}`;
	if (previousModuleKey !== cleanModuleKey || !cleanTarget.startsWith(startText)) {
		startText = '';
	}
	if (startText === cleanTarget) {
		return false;
	}

	activeThinkingMessage.thinking_output = startText;
	const localToken = thinkingOutputStreamToken + 1;
	thinkingOutputStreamToken = localToken;

	const fallbackStep = cleanTarget.length > 1200 ? 18 : cleanTarget.length > 600 ? 10 : 6;
	const renderConfig = getStreamingRenderConfig(fallbackStep, 18);
	const step = Math.max(1, renderConfig.step);

	const tick = () => {
		if (localToken !== thinkingOutputStreamToken) {
			return;
		}
		const liveMessage = findLastThinkingMessage();
		if (!liveMessage || `${liveMessage.thinking_module_key || ''}` !== cleanModuleKey) {
			return;
		}
		const current = `${liveMessage.thinking_output || ''}`;
		if (current === cleanTarget) {
			return;
		}
		const nextLength = Math.min(cleanTarget.length, current.length + step);
		liveMessage.thinking_output = cleanTarget.slice(0, nextLength);
		renderCurrentChat();
		if (nextLength < cleanTarget.length) {
			setTimeout(tick, Math.max(1, renderConfig.intervalMs));
		}
	};

	setTimeout(tick, 0);
	return true;
}

function applyProcessingLabelToThinkingMessages() {
	if (!Array.isArray(currentChatMessages) || !currentChatMessages.length) {
		stopThinkingOutputStream();
		return;
	}
	const state = getActiveModulePlaceholderState();
	const label = state.text || DEFAULT_THINKING_PLACEHOLDER_TEXT;
	const targetThinkingOutput = shouldShowThinking() ? `${state.thinkingOutput || ''}` : '';
	let changed = false;
	let hasThinkingMessage = false;
	for (const message of currentChatMessages) {
		if (!message || !message.thinking) {
			continue;
		}
		hasThinkingMessage = true;
		if (`${message.content || ''}` !== label) {
			message.content = label;
			changed = true;
		}
		if (`${message.thinking_module_name || ''}` !== `${state.moduleName || ''}`) {
			message.thinking_module_name = `${state.moduleName || ''}`;
			changed = true;
		}
	}
	if (!hasThinkingMessage) {
		stopThinkingOutputStream();
		return;
	}
	const outputChanged = updateThinkingOutputForCurrentThinkingMessage(state.key, state.moduleName, targetThinkingOutput);
	changed = changed || outputChanged;
	if (changed) {
		renderCurrentChat();
	}
}

function setModuleProcessingPlaceholder(moduleName, visible, text, details = null) {
	const key = normalizeModuleProcessingName(moduleName);
	if (!key) {
		return;
	}
	const detailsObject = (details && typeof details === 'object') ? details : null;
	const thinkingOutput = detailsObject && typeof detailsObject.thinkingOutput === 'string'
		? detailsObject.thinkingOutput
		: '';

	if (visible) {
		for (const [otherKey, entry] of moduleProcessingPlaceholders.entries()) {
			if (otherKey === key || !entry || !entry.visible) {
				continue;
			}
			moduleProcessingPlaceholders.set(otherKey, {
				...entry,
				visible: false,
				updatedAt: Date.now()
			});
		}
	}

	const existing = moduleProcessingPlaceholders.get(key) || {};
	moduleProcessingPlaceholders.set(key, {
		key,
		moduleName: `${moduleName || ''}`.trim(),
		visible: !!visible,
		text: `${text || ''}`.trim() || existing.text || DEFAULT_THINKING_PLACEHOLDER_TEXT,
		thinkingOutput: `${thinkingOutput || ''}`,
		updatedAt: Date.now()
	});
	if (isUiGenerationLocked()) {
		applyProcessingLabelToThinkingMessages();
	}
}

function queueModulePlaceholderChange(changeFn, delayMs = MODULE_PLACEHOLDER_CHANGE_LATENCY_MS) {
	if (typeof changeFn !== 'function') {
		return;
	}
	modulePlaceholderTransitionChain = modulePlaceholderTransitionChain
		.catch(() => {})
		.then(() => new Promise(resolve => {
			setTimeout(resolve, Math.max(0, Number.parseInt(delayMs, 10) || 0));
		}))
		.then(() => {
			if (!isUiGenerationLocked()) {
				return;
			}
			changeFn();
		});
}

function applyModuleProgressEvent(event) {
	const payload = (event && typeof event === 'object') ? event : {};
	const moduleName = `${payload.module_name || payload.moduleName || ''}`.trim();
	if (!moduleName) {
		return;
	}
	const moduleKey = normalizeModuleProcessingName(moduleName);
	if (!moduleKey) {
		return;
	}
	const phase = `${payload.phase || 'update'}`.trim().toLowerCase();
	const text = `${payload.text || moduleName}`.trim() || moduleName;
	const thinkingOutput = `${payload.thinking_output || payload.thinkingOutput || ''}`;
	const eventTimestampMs = Date.parse(`${payload.timestamp || ''}`);
	const nowMs = Date.now();
	const safeEventMs = Number.isFinite(eventTimestampMs) ? eventTimestampMs : nowMs;

	if (phase === 'start' || phase === 'update') {
		moduleProgressStartAtByKey.set(moduleKey, safeEventMs);
		const nextToken = (moduleProgressEndTokenByKey.get(moduleKey) || 0) + 1;
		moduleProgressEndTokenByKey.set(moduleKey, nextToken);
		queueModulePlaceholderChange(() => {
			setModuleProcessingPlaceholder(moduleName, true, text, { thinkingOutput });
		});
		return;
	}

	if (phase === 'end') {
		const startMs = moduleProgressStartAtByKey.get(moduleKey) || safeEventMs;
		const elapsedMs = Math.max(0, safeEventMs - startMs);
		const holdMs = Math.max(120, Math.min(1200, Math.round(elapsedMs * 0.12)));
		const token = (moduleProgressEndTokenByKey.get(moduleKey) || 0) + 1;
		moduleProgressEndTokenByKey.set(moduleKey, token);
		setTimeout(() => {
			if ((moduleProgressEndTokenByKey.get(moduleKey) || 0) !== token) {
				return;
			}
			queueModulePlaceholderChange(() => {
				if ((moduleProgressEndTokenByKey.get(moduleKey) || 0) !== token) {
					return;
				}
				setModuleProcessingPlaceholder(moduleName, false, text, { thinkingOutput: '' });
			});
		}, holdMs);
		return;
	}

	queueModulePlaceholderChange(() => {
		setModuleProcessingPlaceholder(moduleName, true, text, { thinkingOutput });
	});
}

async function replayModuleProgressEvents(events) {
	if (!Array.isArray(events) || !events.length) {
		return;
	}
	for (const event of events) {
		if (!isUiGenerationLocked()) {
			break;
		}
		applyModuleProgressEvent(event);
		const phase = `${(event && event.phase) || 'update'}`.trim().toLowerCase();
		const delayMs = phase === 'end' ? 40 : 95;
		await new Promise(resolve => setTimeout(resolve, delayMs));
	}
}

window.novaSetModuleProcessingPlaceholder = setModuleProcessingPlaceholder;

function isUiGenerationLocked() {
	return !!(isGeneratingReply || isChatActionGenerating);
}

window.novaIsUiGenerationLocked = isUiGenerationLocked;

function setChatGenerationRenderingState(locked) {
	const appRoot = document.querySelector('.app');
	if (!appRoot) {
		return;
	}
	appRoot.classList.toggle('chat-generating', !!locked);
}

function syncGenerationUiLockState() {
	const locked = isUiGenerationLocked();
	const lockChanged = locked !== lastUiGenerationLocked;
	lastUiGenerationLocked = locked;
	window.__novaSuspendContextTrackerUpdates = locked;
	setChatGenerationRenderingState(locked);
	if (!locked && moduleProcessingPlaceholders.size) {
		moduleProcessingPlaceholders.clear();
	}
	if (!locked) {
		stopThinkingOutputStream();
	}
	setSendButtonState(locked);
	if (messageInput) {
		messageInput.disabled = locked;
		messageInput.setAttribute('aria-disabled', locked ? 'true' : 'false');
	}
	if (locked) {
		applyProcessingLabelToThinkingMessages();
	}
	if (lockChanged && !locked && currentChatId) {
		if (window.NovaContextTracker && typeof window.NovaContextTracker.update === 'function') {
			window.NovaContextTracker.update();
		}
		renderCurrentChat();
	}
}

function setSendButtonState(isGenerating) {
	if (!sendBtn) {
		return;
	}
	if (isGenerating) {
		sendBtn.classList.add('stop-mode');
		sendBtn.textContent = 'Stop';
	} else {
		sendBtn.classList.remove('stop-mode');
		sendBtn.textContent = 'Send';
	}
}

function clearThinkingPlaceholder() {
	if (!Array.isArray(currentChatMessages) || !currentChatMessages.length) {
		return;
	}
	const lastIndex = currentChatMessages.length - 1;
	if (currentChatMessages[lastIndex] && currentChatMessages[lastIndex].thinking) {
		currentChatMessages.splice(lastIndex, 1);
	}
	stopThinkingOutputStream();
}

function showStreamingApiClientFallbackMessage() {
	clearThinkingPlaceholder();
	const fallbackTimestamp = new Date().toISOString();
	currentChatMessages.push({
		role: 'assistant',
		content: STREAMING_API_FALLBACK_MESSAGE,
		timestamp: fallbackTimestamp
	});
	renderCurrentChat();
}

function resolveAssistantMessageIndexForChatAction(action, messageIndex) {
	if (!Array.isArray(currentChatMessages) || !Number.isInteger(messageIndex)) {
		return null;
	}
	const source = currentChatMessages[messageIndex] || null;
	if (!source) {
		return null;
	}
	if (action === 'continue_message') {
		return source.role === 'assistant' ? messageIndex : null;
	}
	if (action === 'regenerate_message') {
		if (source.role === 'assistant') {
			return messageIndex;
		}
		if (source.role === 'user') {
			const candidate = currentChatMessages[messageIndex + 1] || null;
			return candidate && candidate.role === 'assistant' ? messageIndex + 1 : null;
		}
	}
	return null;
}

function applyChatActionStreamingFallback(action, messageIndex) {
	const targetIndex = resolveAssistantMessageIndexForChatAction(action, messageIndex);
	if (!Number.isInteger(targetIndex)) {
		renderCurrentChat();
		return;
	}
	const targetMessage = currentChatMessages[targetIndex];
	if (!targetMessage || targetMessage.role !== 'assistant') {
		renderCurrentChat();
		return;
	}
	targetMessage.content = STREAMING_API_FALLBACK_MESSAGE;
	delete targetMessage.thinking;
	delete targetMessage.thinking_append;
	delete targetMessage.temp_regen;
	renderCurrentChat();
}

function stopMessageGeneration(force = false) {
	if (!force && !isUiGenerationLocked()) {
		return;
	}
	isGeneratingReply = false;
	isChatActionGenerating = false;
	actionStreamingToken += 1;
	if (activeGenerationController) {
		activeGenerationController.abort();
		activeGenerationController = null;
	}
	if (activeChatActionController) {
		activeChatActionController.abort();
		activeChatActionController = null;
	}
	syncGenerationUiLockState();
	clearThinkingPlaceholder();
	renderCurrentChat();
	fetch('/api/stop-generation', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ chat_id: currentChatId, bot_name: currentBotName })
	}).catch(() => {});
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

function shouldEnableTextStreaming() {
	if (settingsDraft && typeof settingsDraft.enable_text_streaming === 'boolean') {
		return settingsDraft.enable_text_streaming;
	}
	if (lastSavedSettings && typeof lastSavedSettings.enable_text_streaming === 'boolean') {
		return lastSavedSettings.enable_text_streaming;
	}
	return false;
}

function shouldEnableControlledStreaming() {
	if (settingsDraft && typeof settingsDraft.enable_controlled_streaming === 'boolean') {
		return settingsDraft.enable_controlled_streaming;
	}
	if (lastSavedSettings && typeof lastSavedSettings.enable_controlled_streaming === 'boolean') {
		return lastSavedSettings.enable_controlled_streaming;
	}
	return false;
}

function getControlledStreamingTps() {
	const fromDraft = settingsDraft ? parseInt(settingsDraft.controlled_streaming_tps, 10) : NaN;
	if (Number.isFinite(fromDraft)) {
		return Math.max(1, Math.min(100, fromDraft));
	}
	const fromSaved = lastSavedSettings ? parseInt(lastSavedSettings.controlled_streaming_tps, 10) : NaN;
	if (Number.isFinite(fromSaved)) {
		return Math.max(1, Math.min(100, fromSaved));
	}
	return 15;
}

function getStreamingRenderConfig(fallbackStep, fallbackIntervalMs) {
	if (!shouldEnableControlledStreaming()) {
		return {
			step: Math.max(1, fallbackStep),
			intervalMs: Math.max(1, fallbackIntervalMs)
		};
	}
	const tokensPerSecond = getControlledStreamingTps();
	const approxCharsPerToken = 4;
	const intervalMs = 33;
	const charsPerSecond = tokensPerSecond * approxCharsPerToken;
	const step = Math.max(1, Math.round((charsPerSecond * intervalMs) / 1000));
	return { step, intervalMs };
}

function saveAssistantResponse(responseText, generationToken) {
	if (!responseText || generationToken !== activeGenerationToken) {
		return Promise.resolve();
	}
	return postJson('/api/message', { message: responseText, save_response: true, chat_id: currentChatId, bot_name: currentBotName })
		.then(r => r.json())
		.then(saveData => {
			if (generationToken !== activeGenerationToken) {
				return;
			}
			if (saveData && saveData.context) {
				setCurrentChatContextStats(saveData.context);
				renderCurrentChat();
			}
		});
}

function streamAssistantReplyFromBackend(text, generationToken) {
	const payload = {
		message: text,
		chat_id: currentChatId,
		bot_name: currentBotName,
		...getCurrentPersonaPayload()
	};

	const removeThinkingPlaceholder = () => {
		if (!Array.isArray(currentChatMessages) || !currentChatMessages.length) {
			return;
		}
		const lastIndex = currentChatMessages.length - 1;
		if (currentChatMessages[lastIndex] && currentChatMessages[lastIndex].thinking) {
			currentChatMessages.splice(lastIndex, 1);
		}
	};

	const responseTimestamp = new Date().toISOString();
	let assistantMessage = null;
	let fullResponse = '';
	let hasReceivedAnyChunk = false;
	let chunkRenderChain = Promise.resolve();

	const ensureAssistantMessage = () => {
		if (assistantMessage) {
			return;
		}
		removeThinkingPlaceholder();
		assistantMessage = { role: 'assistant', content: '', timestamp: responseTimestamp };
		currentChatMessages.push(assistantMessage);
		renderCurrentChat();
	};

	const appendChunkProgressively = (part) => {
		const chunkText = typeof part === 'string' ? part : String(part || '');
		if (!chunkText) {
			return Promise.resolve();
		}
		const total = chunkText.length;
		const fallbackStep = total > 120 ? 10 : total > 60 ? 6 : total;
		const renderConfig = getStreamingRenderConfig(fallbackStep, 14);
		const step = renderConfig.step;
		let cursor = 0;
		let previousCursor = 0;
		const assistantIndex = Math.max(0, currentChatMessages.length - 1);
		return new Promise(resolve => {
			const tick = () => {
				if (generationToken !== activeGenerationToken) {
					resolve();
					return;
				}
				previousCursor = cursor;
				cursor = Math.min(total, cursor + step);
				fullResponse += chunkText.slice(previousCursor, cursor);
				assistantMessage.content = fullResponse;
				if (!updateMessageBubbleInDom(assistantIndex, fullResponse, { clearThinking: true, keepAtBottom: true })) {
					renderCurrentChat();
				}
				if (cursor >= total) {
					resolve();
					return;
				}
				setTimeout(tick, renderConfig.intervalMs);
			};
			tick();
		});
	};

	const processEvent = async (event) => {
		const type = (event && event.type) ? String(event.type).toLowerCase() : 'chunk';
		if (type === 'module_progress') {
			applyModuleProgressEvent(event);
			return null;
		}
		if (type === 'chunk') {
			const part = typeof event.text === 'string' ? event.text : String(event.text || '');
			if (!part) {
				return null;
			}
			hasReceivedAnyChunk = true;
			ensureAssistantMessage();
			chunkRenderChain = chunkRenderChain.then(() => appendChunkProgressively(part));
			return null;
		}
		if (type === 'done') {
			ensureAssistantMessage();
			await chunkRenderChain;
			if (typeof event.response === 'string') {
				if (!hasReceivedAnyChunk) {
					await appendChunkProgressively(event.response);
				} else {
					fullResponse = event.response;
					assistantMessage.content = fullResponse;
					renderCurrentChat();
				}
			}
			return { done: true, cancelled: false };
		}
		if (type === 'cancelled') {
			removeThinkingPlaceholder();
			renderCurrentChat();
			return { done: true, cancelled: true };
		}
		if (type === 'error') {
			const message = typeof event.error === 'string' ? event.error : 'Streaming error.';
			throw new Error(message);
		}
		return null;
	};

	return postJson('/api/message-stream', payload, { signal: activeGenerationController.signal })
		.then(async response => {
			if (!response.ok) {
				throw new Error(`Streaming request failed (${response.status})`);
			}

			const reader = response.body && response.body.getReader ? response.body.getReader() : null;
			if (!reader) {
				throw new Error('Streaming is not supported by this browser response.');
			}

			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				if (generationToken !== activeGenerationToken) {
					return { response: fullResponse, cancelled: true };
				}
				const { value, done } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				let newlineIndex = buffer.indexOf('\n');
				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex).trim();
					buffer = buffer.slice(newlineIndex + 1);
					if (line) {
						let event;
						try {
							event = JSON.parse(line);
						} catch (_) {
							event = null;
						}
						if (event) {
							const result = await processEvent(event);
							if (result && result.done) {
								return { response: fullResponse, cancelled: !!result.cancelled };
							}
						}
					}
					newlineIndex = buffer.indexOf('\n');
				}
			}

			const remaining = buffer.trim();
			if (remaining) {
				try {
					const event = JSON.parse(remaining);
					const result = await processEvent(event);
					if (result && result.done) {
						return { response: fullResponse, cancelled: !!result.cancelled };
					}
				} catch (_) {}
			}

			if (!assistantMessage) {
				removeThinkingPlaceholder();
				renderCurrentChat();
			}
			return { response: fullResponse, cancelled: false };
		});
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

function appendInlineMarkdownText(target, sourceText) {
	const text = typeof sourceText === 'string' ? sourceText : String(sourceText || '');
	const tokenPattern = /\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|"([^"\n]+)"/g;
	let lastIndex = 0;
	let match;
	while ((match = tokenPattern.exec(text)) !== null) {
		if (match.index > lastIndex) {
			target.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
		}
		if (match[1] !== undefined) {
			const strong = document.createElement('strong');
			const em = document.createElement('em');
			em.textContent = match[1];
			strong.appendChild(em);
			target.appendChild(strong);
		} else if (match[2] !== undefined) {
			const strong = document.createElement('strong');
			strong.textContent = match[2];
			target.appendChild(strong);
		} else if (match[3] !== undefined) {
			const underline = document.createElement('u');
			underline.textContent = match[3];
			target.appendChild(underline);
		} else if (match[4] !== undefined) {
			const em = document.createElement('em');
			em.textContent = match[4];
			target.appendChild(em);
		} else if (match[5] !== undefined) {
			const quote = document.createElement('span');
			quote.className = 'message-inline-quote';
			quote.appendChild(document.createTextNode('"'));
			appendInlineMarkdownText(quote, match[5]);
			quote.appendChild(document.createTextNode('"'));
			target.appendChild(quote);
		}
		lastIndex = tokenPattern.lastIndex;
	}
	if (lastIndex < text.length) {
		target.appendChild(document.createTextNode(text.slice(lastIndex)));
	}
}

function resolveChatPlaceholders(sourceText) {
	const text = typeof sourceText === 'string' ? sourceText : String(sourceText || '');
	const botName = (typeof currentBotName === 'string' && currentBotName.trim()) ? currentBotName.trim() : '';
	const userName = (currentPersonaInfo && typeof currentPersonaInfo.name === 'string' && currentPersonaInfo.name.trim())
		? currentPersonaInfo.name.trim()
		: 'User';

	let resolved = text;
	if (botName) {
		resolved = resolved.replace(/\{\{char\}\}/gi, botName);
	}
	resolved = resolved.replace(/\{\{user\}\}/gi, userName);
	return resolved;
}

function setBubbleTextContent(bubble, rawText, plain = false) {
	if (!bubble) {
		return;
	}
	const text = typeof rawText === 'string' ? rawText : String(rawText || '');
	const displayText = resolveChatPlaceholders(text).replace(/\r\n?|\u2028|\u2029/g, '\n');
	bubble.dataset.rawText = text;
	bubble.innerHTML = '';
	if (plain) {
		bubble.textContent = displayText;
		return;
	}
	const lines = displayText.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const quoteMatch = /^\s*>\s?(.*)$/.exec(line);
		if (quoteMatch) {
			const quoteSpan = document.createElement('span');
			quoteSpan.className = 'message-inline-quote';
			quoteSpan.appendChild(document.createTextNode('"'));
			appendInlineMarkdownText(quoteSpan, quoteMatch[1]);
			quoteSpan.appendChild(document.createTextNode('"'));
			bubble.appendChild(quoteSpan);
		} else {
			appendInlineMarkdownText(bubble, line);
		}
		if (index < lines.length - 1) {
			bubble.appendChild(document.createElement('br'));
		}
	}
}

function updateMessageBubbleInDom(messageIndex, rawText, options = null) {
	if (!messagesContainer || !Number.isInteger(messageIndex)) {
		return false;
	}
	const row = messagesContainer.querySelector(`.message[data-message-index="${messageIndex}"]`);
	if (!row) {
		return false;
	}
	const bubble = row.querySelector('.message-bubble');
	if (!bubble) {
		return false;
	}
	setBubbleTextContent(bubble, rawText);
	const cfg = (options && typeof options === 'object') ? options : {};
	if (cfg.clearThinking) {
		bubble.classList.remove('message-thinking');
		bubble.classList.remove('message-thinking-append');
	}
	if (cfg.keepAtBottom) {
		const distanceFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
		if (distanceFromBottom <= 80) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	}
	return true;
}

function notifyContextTrackerChatRendered() {
	if (!window.NovaContextTracker) {
		return;
	}
	if (typeof window.NovaContextTracker.onChatRendered === 'function') {
		window.NovaContextTracker.onChatRendered();
		return;
	}
	if (typeof window.NovaContextTracker.update === 'function') {
		window.NovaContextTracker.update();
	}
}

function clearChatHeaderDynamicElements() {
	if (!chatHeader) {
		return;
	}
	const selectors = [
		'#chat-header-iam-picker',
		'#chat-context-indicator-wrap',
		'.context-tracker'
	];
	selectors.forEach(selector => {
		chatHeader.querySelectorAll(selector).forEach(node => node.remove());
	});
}

function ensureChatHeaderTitle(titleText, subtitleText) {
	if (!chatHeader) {
		return;
	}
	let base = chatHeader.querySelector('.chat-header-main');
	if (!base) {
		chatHeader.innerHTML = '';
		base = document.createElement('div');
		base.className = 'chat-header-main';
		const titleEl = document.createElement('div');
		titleEl.className = 'chat-title';
		const subtitleEl = document.createElement('div');
		subtitleEl.className = 'chat-subtitle';
		base.appendChild(titleEl);
		base.appendChild(subtitleEl);
		chatHeader.appendChild(base);
	}
	const titleEl = base.querySelector('.chat-title');
	const subtitleEl = base.querySelector('.chat-subtitle');
	const nextTitle = `${titleText || ''}`;
	const nextSubtitle = `${subtitleText || ''}`;
	if (titleEl && titleEl.textContent !== nextTitle) {
		titleEl.textContent = nextTitle;
	}
	if (subtitleEl && subtitleEl.textContent !== nextSubtitle) {
		subtitleEl.textContent = nextSubtitle;
	}
}

function renderCurrentChat() {
	if (typeof currentView !== 'undefined' && currentView !== 'last-chat') {
		return;
	}
	if (!currentChatId) {
		inputArea.classList.remove('visible');
		ensureChatHeaderTitle('Chat', 'Continue your conversation');
		clearChatHeaderDynamicElements();
		messagesContainer.innerHTML = '<div style="padding:40px;color:#91a1b7;text-align:center;"><div style="font-size:18px;margin-bottom:12px;">No recent chats</div><p>Select a bot from the left to start chatting</p></div>';
		notifyContextTrackerChatRendered();
		return;
	}

	inputArea.classList.add('visible');
	const title = currentBotName ? currentBotName : 'Chat';
	ensureChatHeaderTitle(title, 'Conversation');
	renderChatIamHeaderPicker();
	renderChatContextIndicator();
	const distanceFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
	const shouldStickToBottom = distanceFromBottom <= 80;
	messagesContainer.innerHTML = '';
	if (!currentChatMessages || currentChatMessages.length === 0) {
		messagesContainer.innerHTML = '<div class="chat-empty">No messages in this chat yet.</div>';
		notifyContextTrackerChatRendered();
		return;
	}

	let newestAssistantIndex = -1;
	for (let idx = currentChatMessages.length - 1; idx >= 0; idx -= 1) {
		const candidate = currentChatMessages[idx];
		if (!candidate || candidate.thinking) {
			continue;
		}
		if (`${candidate.role || ''}`.toLowerCase() === 'assistant') {
			newestAssistantIndex = idx;
			break;
		}
	}

	currentChatMessages.forEach((msg, index) => {
		const nextMessage = currentChatMessages[index + 1] || null;
		const hasAssistantReplyAfter = !!(nextMessage && nextMessage.role === 'assistant');
		const isNewestAssistantMessage = index === newestAssistantIndex;
		addMessage(msg.content, msg.role === 'user', msg.timestamp, index, msg.role, !!msg.thinking, hasAssistantReplyAfter, msg, isNewestAssistantMessage);
	});
	if (shouldStickToBottom) {
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}
	notifyContextTrackerChatRendered();
}

function persistEditedMessage(messageIndex, content) {
	if (!currentChatId || !currentBotName) {
		return Promise.resolve({ success: false });
	}
	const clientMessageCount = Array.isArray(currentChatMessages) ? currentChatMessages.length : null;
	return postJson('/api/chats', {
		action: 'edit_message',
		chat_id: currentChatId,
		bot_name: currentBotName,
		message_index: messageIndex,
		content,
		client_message_count: clientMessageCount
	}).then(r => r.json());
}

function runChatMessageAction(action, messageIndex, clientMessageCountOverride = null, extraPayload = null, requestOptions = null) {
	if (!currentChatId || !currentBotName || !Number.isInteger(messageIndex)) {
		return Promise.resolve({ success: false, message: 'Invalid chat state.' });
	}
	const clientMessageCount = Number.isInteger(clientMessageCountOverride)
		? clientMessageCountOverride
		: (Array.isArray(currentChatMessages) ? currentChatMessages.length : null);
	const payload = {
		action,
		chat_id: currentChatId,
		bot_name: currentBotName,
		message_index: messageIndex,
		client_message_count: clientMessageCount,
		...getCurrentPersonaPayload()
	};
	if (extraPayload && typeof extraPayload === 'object') {
		Object.assign(payload, extraPayload);
	}
	return postJson('/api/chats', payload, requestOptions).then(r => r.json());
}

function getChatActionTargetIndex(action, messageIndex) {
	if (!Number.isInteger(messageIndex) || !Array.isArray(currentChatMessages)) {
		return null;
	}
	if (action === 'continue_message') {
		return messageIndex;
	}
	if (action === 'regenerate_message') {
		const source = currentChatMessages[messageIndex] || null;
		if (!source) {
			return null;
		}
		if (source.role === 'assistant') {
			return messageIndex;
		}
		if (source.role === 'user') {
			return messageIndex + 1;
		}
	}
	return null;
}

function streamChatActionFromBackend(action, messageIndex, requestOptions = null, actionOptions = null) {
	if (!currentChatId || !currentBotName || !Number.isInteger(messageIndex)) {
		return Promise.resolve({ success: false, message: 'Invalid chat state.' });
	}

	const options = (actionOptions && typeof actionOptions === 'object') ? actionOptions : {};
	const clientMessageCount = Number.isInteger(options.clientMessageCount)
		? options.clientMessageCount
		: (Array.isArray(currentChatMessages) ? currentChatMessages.length : null);
	const payload = {
		action,
		chat_id: currentChatId,
		bot_name: currentBotName,
		message_index: messageIndex,
		client_message_count: clientMessageCount,
		...getCurrentPersonaPayload()
	};

	const thinkingMode = options.thinkingMode === 'append' ? 'append' : 'replace';
	const baseText = thinkingMode === 'append' ? String(options.previousAssistantText || '') : '';
	const targetIndex = getChatActionTargetIndex(action, messageIndex);
	const localStreamingToken = actionStreamingToken;
	let fullResponse = '';
	let hasReceivedAnyChunk = false;
	let chunkRenderChain = Promise.resolve();
	let progressiveQueueChars = 0;
	let forceImmediateRender = false;

	const getTargetMessage = () => {
		if (!Array.isArray(currentChatMessages) || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= currentChatMessages.length) {
			return null;
		}
		return currentChatMessages[targetIndex] || null;
	};

	const applyStreamTextToTarget = () => {
		const target = getTargetMessage();
		if (!target || target.role !== 'assistant') {
			return false;
		}
		target.content = thinkingMode === 'append' ? `${baseText}${fullResponse}` : fullResponse;
		delete target.thinking;
		delete target.thinking_append;
		return true;
	};

	const appendChunkProgressively = (part) => {
		const chunkText = typeof part === 'string' ? part : String(part || '');
		if (!chunkText) {
			return Promise.resolve();
		}
		if (forceImmediateRender || progressiveQueueChars > CHAT_ACTION_MAX_PROGRESSIVE_CHARS) {
			forceImmediateRender = true;
			fullResponse += chunkText;
			if (applyStreamTextToTarget()) {
				if (!updateMessageBubbleInDom(targetIndex, thinkingMode === 'append' ? `${baseText}${fullResponse}` : fullResponse, { clearThinking: true, keepAtBottom: true })) {
					renderCurrentChat();
				}
			}
			return Promise.resolve();
		}

		const total = chunkText.length;
		progressiveQueueChars += total;
		const fallbackStep = total > 120 ? 10 : total > 60 ? 6 : total;
		const renderConfig = getStreamingRenderConfig(fallbackStep, 14);
		const step = renderConfig.step;
		let cursor = 0;
		let previousCursor = 0;
		return new Promise(resolve => {
			const tick = () => {
				if (localStreamingToken !== actionStreamingToken) {
					progressiveQueueChars = Math.max(0, progressiveQueueChars - total);
					resolve();
					return;
				}
				previousCursor = cursor;
				cursor = Math.min(total, cursor + step);
				fullResponse += chunkText.slice(previousCursor, cursor);
				if (!applyStreamTextToTarget()) {
					progressiveQueueChars = Math.max(0, progressiveQueueChars - total);
					resolve();
					return;
				}
				if (!updateMessageBubbleInDom(targetIndex, thinkingMode === 'append' ? `${baseText}${fullResponse}` : fullResponse, { clearThinking: true, keepAtBottom: true })) {
					renderCurrentChat();
				}
				if (cursor >= total) {
					progressiveQueueChars = Math.max(0, progressiveQueueChars - total);
					resolve();
					return;
				}
				setTimeout(tick, renderConfig.intervalMs);
			};
			tick();
		});
	};

	const processEvent = async (event) => {
		const type = (event && event.type) ? String(event.type).toLowerCase() : 'chunk';
		if (type === 'module_progress') {
			applyModuleProgressEvent(event);
			return null;
		}
		if (type === 'chunk') {
			const part = typeof event.text === 'string' ? event.text : String(event.text || '');
			if (!part) {
				return null;
			}
			hasReceivedAnyChunk = true;
			chunkRenderChain = chunkRenderChain.then(() => appendChunkProgressively(part));
			return null;
		}
		if (type === 'done') {
			await chunkRenderChain;
			if (typeof event.response === 'string') {
				if (!hasReceivedAnyChunk) {
					await appendChunkProgressively(event.response);
				} else {
					fullResponse = event.response;
					applyStreamTextToTarget();
					renderCurrentChat();
				}
			}
			if (Array.isArray(event.messages)) {
				currentChatMessages = event.messages;
			}
			if (event && event.context) {
				setCurrentChatContextStats(event.context);
			}
			renderCurrentChat();
			return {
				done: true,
				cancelled: false,
				success: event.success !== false,
				messages: event.messages,
				response: typeof event.response === 'string' ? event.response : fullResponse
			};
		}
		if (type === 'cancelled') {
			if (Array.isArray(event.messages)) {
				currentChatMessages = event.messages;
			}
			renderCurrentChat();
			return { done: true, cancelled: true, success: true, messages: event.messages || null, response: fullResponse };
		}
		if (type === 'error') {
			const message = typeof event.error === 'string' ? event.error : 'Streaming error.';
			throw new Error(message);
		}
		return null;
	};

	return postJson('/api/chat-action-stream', payload, requestOptions)
		.then(async response => {
			if (!response.ok) {
				throw new Error(`Streaming request failed (${response.status})`);
			}

			const reader = response.body && response.body.getReader ? response.body.getReader() : null;
			if (!reader) {
				throw new Error('Streaming is not supported by this browser response.');
			}

			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				if (localStreamingToken !== actionStreamingToken) {
					try {
						if (reader && typeof reader.cancel === 'function') {
							await reader.cancel();
						}
					} catch (_) {}
					return { success: false, cancelled: true, response: fullResponse };
				}
				const { value, done } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				let newlineIndex = buffer.indexOf('\n');
				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex).trim();
					buffer = buffer.slice(newlineIndex + 1);
					if (line) {
						let event;
						try {
							event = JSON.parse(line);
						} catch (_) {
							event = null;
						}
						if (event) {
							const result = await processEvent(event);
							if (result && result.done) {
								return result;
							}
						}
					}
					newlineIndex = buffer.indexOf('\n');
				}
			}

			const remaining = buffer.trim();
			if (remaining) {
				try {
					const event = JSON.parse(remaining);
					const result = await processEvent(event);
					if (result && result.done) {
						return result;
					}
				} catch (_) {}
			}

			await chunkRenderChain;
			renderCurrentChat();
			return { success: true, cancelled: false, response: fullResponse };
		});
}

function applyChatActionResult(result) {
	if (result && result.cancelled) {
		if (Array.isArray(result.messages)) {
			currentChatMessages = result.messages;
		}
		if (result.context) {
			setCurrentChatContextStats(result.context);
		}
		renderCurrentChat();
		return true;
	}
	if (!result || !result.success) {
		return false;
	}
	if (Array.isArray(result.messages)) {
		currentChatMessages = result.messages;
	}
	if (result.context) {
		setCurrentChatContextStats(result.context);
	}
	renderCurrentChat();
	return true;
}

async function applyChatActionResultWithStreaming(result, action, messageIndex, previousAssistantText = '', thinkingMode = null) {
	if (result && result.cancelled) {
		if (Array.isArray(result.messages)) {
			currentChatMessages = result.messages;
		}
		if (result.context) {
			setCurrentChatContextStats(result.context);
		}
		await replayModuleProgressEvents(result.module_progress_events);
		renderCurrentChat();
		return true;
	}
	if (!result || !result.success) {
		return false;
	}
	if (Array.isArray(result.messages)) {
		currentChatMessages = result.messages;
	}
	if (result.context) {
		setCurrentChatContextStats(result.context);
	}

	await replayModuleProgressEvents(result.module_progress_events);

	if (!shouldEnableTextStreaming() || !Array.isArray(currentChatMessages)) {
		renderCurrentChat();
		return true;
	}

	let targetIndex = null;
	let startText = '';

	if (action === 'continue_message') {
		targetIndex = Number.isInteger(messageIndex) ? messageIndex : null;
		startText = typeof previousAssistantText === 'string' ? previousAssistantText : '';
	} else if (action === 'regenerate_message') {
		const source = currentChatMessages[messageIndex] || null;
		if (source && source.role === 'assistant') {
			targetIndex = messageIndex;
		} else if (source && source.role === 'user') {
			targetIndex = messageIndex + 1;
		}
		startText = '';
	}

	if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= currentChatMessages.length) {
		renderCurrentChat();
		return true;
	}

	const targetMessage = currentChatMessages[targetIndex];
	if (!targetMessage || targetMessage.role !== 'assistant') {
		renderCurrentChat();
		return true;
	}

	const finalText = typeof targetMessage.content === 'string' ? targetMessage.content : String(targetMessage.content || '');
	if (!finalText) {
		renderCurrentChat();
		return true;
	}

	actionStreamingToken += 1;
	const localToken = actionStreamingToken;
	if (thinkingMode === 'replace') {
		targetMessage.content = getThinkingPlaceholderText();
		targetMessage.thinking = true;
		delete targetMessage.thinking_append;
	} else if (thinkingMode === 'append') {
		targetMessage.content = startText;
		targetMessage.thinking_append = true;
		delete targetMessage.thinking;
	} else {
		targetMessage.content = startText;
		delete targetMessage.thinking;
		delete targetMessage.thinking_append;
	}
	renderCurrentChat();

	let cursor = startText.length;
	const fallbackStep = finalText.length > 1800 ? 22 : finalText.length > 900 ? 14 : 8;
	const renderConfig = getStreamingRenderConfig(fallbackStep, 14);
	const step = renderConfig.step;
	await new Promise(resolve => {
		const tick = () => {
			if (localToken !== actionStreamingToken) {
				resolve();
				return;
			}
			delete targetMessage.thinking;
			delete targetMessage.thinking_append;
			cursor = Math.min(finalText.length, cursor + step);
			targetMessage.content = finalText.slice(0, cursor);
			if (!updateMessageBubbleInDom(targetIndex, targetMessage.content, { clearThinking: true, keepAtBottom: true })) {
				renderCurrentChat();
			}
			if (cursor >= finalText.length) {
				resolve();
				return;
			}
			setTimeout(tick, renderConfig.intervalMs);
		};
		setTimeout(tick, 0);
	});
	return true;
}

function renderChatContextIndicator() {
	if (!chatHeader || !currentChatId) {
		return;
	}
	chatHeader.style.position = 'relative';
	const existing = document.getElementById('chat-context-indicator-wrap');

	const stats = currentChatContextStats;
	if (!stats || typeof stats !== 'object') {
		if (existing) {
			existing.remove();
		}
		lastContextIndicatorSignature = '';
		return;
	}

	const totalTokens = Number.parseInt(stats.total_tokens, 10) || 0;
	const maxTokens = Number.parseInt(stats.max_tokens, 10) || 1;
	const ratio = Math.max(0, Math.min(1, Number(stats.usage_ratio || (totalTokens / Math.max(1, maxTokens)))));
	const percent = Math.round(ratio * 100);
	const breakdown = stats.breakdown || {};
	const signature = JSON.stringify({
		chat_id: currentChatId,
		total_tokens: totalTokens,
		max_tokens: maxTokens,
		ratio,
		breakdown
	});
	if (existing && signature === lastContextIndicatorSignature) {
		return;
	}
	if (existing) {
		existing.remove();
	}
	lastContextIndicatorSignature = signature;

	const wrap = document.createElement('div');
	wrap.id = 'chat-context-indicator-wrap';
	wrap.className = 'chat-context-indicator-wrap';

	const indicator = document.createElement('button');
	indicator.type = 'button';
	indicator.className = 'chat-context-indicator';
	indicator.style.setProperty('--context-fill', `${percent}%`);
	indicator.setAttribute('aria-label', `Context ${totalTokens} / ${maxTokens} tokens`);

	const label = document.createElement('span');
	label.className = 'chat-context-indicator-label';
	label.textContent = `${totalTokens}/${maxTokens}`;
	indicator.appendChild(label);

	   const tooltip = document.createElement('div');
	   tooltip.className = 'chat-context-tooltip';
	const percentUsed = (maxTokens > 0) ? ((totalTokens / maxTokens) * 100).toFixed(1) : '0';
	const percentRow = `<div><strong>Context</strong>: ${totalTokens} / ${maxTokens}</div>`;
	   function percentPart(val) {
		   return (maxTokens > 0) ? ` <span style='color:#888;'>(${((val / maxTokens) * 100).toFixed(1)}%)</span>` : '';
	   }
	   tooltip.innerHTML = [
		   percentRow,
		   `<div>IAM: ${Number.parseInt(breakdown.iam, 10) || 0}${percentPart(Number.parseInt(breakdown.iam, 10) || 0)}</div>`,
		   `<div>Core: ${Number.parseInt(breakdown.core, 10) || 0}${percentPart(Number.parseInt(breakdown.core, 10) || 0)}</div>`,
		   `<div>Persona: ${Number.parseInt(breakdown.persona, 10) || 0}${percentPart(Number.parseInt(breakdown.persona, 10) || 0)}</div>`,
		   `<div style='margin-top:0.5em;'><strong>Total used:</strong> ${percentUsed}%</div>`
	   ].join('');

	wrap.appendChild(indicator);
	wrap.appendChild(tooltip);
	chatHeader.appendChild(wrap);
}

function startInlineMessageEdit(options) {
	const { bubble, bubbleWrap, messageIndex, originalText } = options || {};
	if (!bubble || !bubbleWrap || !Number.isInteger(messageIndex) || bubbleWrap.dataset.editing === '1') {
		return;
	}
	bubbleWrap.dataset.editing = '1';

	const editInput = document.createElement('textarea');
	editInput.className = 'message-edit-input';
	editInput.value = originalText || '';
	editInput.rows = 3;
	const bubbleRect = bubble.getBoundingClientRect();
	const messageRow = bubbleWrap.closest('.message');
	const contentColumn = bubbleWrap.closest('.message-content');
	let maxBubbleWidth = 0;
	if (contentColumn && messageRow) {
		const maxWidthStyle = window.getComputedStyle(contentColumn).maxWidth || '';
		if (maxWidthStyle.endsWith('%')) {
			const ratio = Number.parseFloat(maxWidthStyle) / 100;
			if (Number.isFinite(ratio) && ratio > 0) {
				maxBubbleWidth = Math.floor(messageRow.clientWidth * ratio);
			}
		} else {
			const parsedPx = Number.parseFloat(maxWidthStyle);
			if (Number.isFinite(parsedPx) && parsedPx > 0) {
				maxBubbleWidth = Math.floor(parsedPx);
			}
		}
	}
	if (maxBubbleWidth <= 0 && messageRow) {
		maxBubbleWidth = Math.floor(messageRow.clientWidth * 0.75);
	}
	if (maxBubbleWidth <= 0 && bubbleRect && Number.isFinite(bubbleRect.width) && bubbleRect.width > 0) {
		maxBubbleWidth = Math.ceil(bubbleRect.width);
	}
	if (maxBubbleWidth > 0) {
		editInput.style.width = `${maxBubbleWidth}px`;
		editInput.style.maxWidth = '100%';
		editInput.style.boxSizing = 'border-box';
	}
	if (bubbleRect && Number.isFinite(bubbleRect.height) && bubbleRect.height > 0) {
		const startHeight = Math.ceil(bubbleRect.height);
		editInput.style.height = `${startHeight}px`;
		editInput.style.minHeight = `${startHeight}px`;
	}

	const actions = document.createElement('div');
	actions.className = 'message-edit-actions';
	const confirmBtn = document.createElement('button');
	confirmBtn.type = 'button';
	confirmBtn.className = 'message-edit-confirm';
	confirmBtn.textContent = '✔';
	const cancelBtn = document.createElement('button');
	cancelBtn.type = 'button';
	cancelBtn.className = 'message-edit-cancel';
	cancelBtn.textContent = '✘';
	actions.appendChild(confirmBtn);
	actions.appendChild(cancelBtn);

	bubble.replaceWith(editInput);
	bubbleWrap.appendChild(actions);
	const computedEditStyle = window.getComputedStyle(editInput);
	const minHeightPx = Number.parseFloat(computedEditStyle.minHeight) || Number.parseFloat(editInput.style.minHeight) || 0;
	const syncEditInputHeight = () => {
		editInput.style.height = 'auto';
		const nextHeight = Math.max(minHeightPx, editInput.scrollHeight);
		editInput.style.height = `${Math.ceil(nextHeight)}px`;
	};
	syncEditInputHeight();
	editInput.focus();
	editInput.setSelectionRange(editInput.value.length, editInput.value.length);

	const handleOutsidePointerDown = event => {
		if (!bubbleWrap.contains(event.target)) {
			restore();
		}
	};
	document.addEventListener('pointerdown', handleOutsidePointerDown, true);

	const restore = () => {
		document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
		if (actions.parentNode === bubbleWrap) {
			bubbleWrap.removeChild(actions);
		}
		if (editInput.parentNode === bubbleWrap) {
			editInput.replaceWith(bubble);
		}
		delete bubbleWrap.dataset.editing;
	};

	confirmBtn.addEventListener('click', () => {
		const nextText = String(editInput.value || '');
		const originalValue = String(originalText || '');
		if (!nextText.trim() || nextText === originalValue) {
			restore();
			return;
		}
		confirmBtn.disabled = true;
		cancelBtn.disabled = true;
		persistEditedMessage(messageIndex, nextText)
			.then(result => {
				if (!result || !result.success) {
					confirmBtn.disabled = false;
					cancelBtn.disabled = false;
					return;
				}
				if (Array.isArray(result.messages)) {
					currentChatMessages = result.messages;
				} else if (Array.isArray(currentChatMessages) && currentChatMessages[messageIndex]) {
					currentChatMessages[messageIndex].content = nextText;
				}
				renderCurrentChat();
			})
			.catch(() => {
				confirmBtn.disabled = false;
				cancelBtn.disabled = false;
			});
	});

	cancelBtn.addEventListener('click', restore);

	editInput.addEventListener('keydown', event => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			confirmBtn.click();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelBtn.click();
		}
	});

	editInput.addEventListener('input', syncEditInputHeight);
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

	postJson('/api/bot/iam', { action: 'list_sets', bot_name: currentBotName })
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
				chatBotIamSelections[currentBotName] = setNames[0];
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
				postJson('/api/chats', {
					action: 'switch_iam',
					chat_id: currentChatId,
					bot_name: currentBotName,
					iam_set: nextSet,
					persona_name: (currentPersonaInfo && currentPersonaInfo.name) ? currentPersonaInfo.name : 'User'
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							return;
						}
						chatBotIamSelections[currentBotName] = nextSet;
						if (Array.isArray(result.messages)) {
							currentChatMessages = result.messages;
						}
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

function addMessage(text, isUser, timestamp, messageIndex = null, role = null, isThinking = false, hasAssistantReplyAfter = false, messageData = null, isNewestAssistantMessage = false) {
	const msg = document.createElement('div');
	msg.className = 'message' + (isUser ? ' user' : '');
	const avatar = document.createElement('div');
	avatar.className = 'message-avatar';

	const applyAvatarArt = (target, iconArt, iconFit) => {
		if (!target || !iconArt) {
			return false;
		}
		target.classList.add('message-avatar-has-image');
		target.style.backgroundImage = 'none';
		target.textContent = '';
		target.innerHTML = '';

		const fit = (iconFit && typeof iconFit === 'object') ? iconFit : {};
		const size = Number.isFinite(fit.size) ? fit.size : 100;
		const x = Number.isFinite(fit.x) ? fit.x : 50;
		const y = Number.isFinite(fit.y) ? fit.y : 50;

		const avatarImg = document.createElement('img');
		avatarImg.className = 'message-avatar-img';
		avatarImg.src = iconArt;
		avatarImg.alt = '';
		avatarImg.draggable = false;
		avatarImg.loading = 'eager';
		avatarImg.decoding = 'async';
		avatarImg.style.width = `${size}%`;
		avatarImg.style.height = `${size}%`;
		avatarImg.style.objectPosition = `${x}% ${y}%`;
		target.appendChild(avatarImg);
		return true;
	};

	// Set avatar with coverart/icon or fallback to text initial
	if (isUser) {
		const iconArt = currentPersonaInfo && currentPersonaInfo.icon_art ? currentPersonaInfo.icon_art : (currentPersonaInfo && currentPersonaInfo.cover_art ? currentPersonaInfo.cover_art : '');
		const iconFit = currentPersonaInfo && currentPersonaInfo.icon_fit ? currentPersonaInfo.icon_fit : (currentPersonaInfo && currentPersonaInfo.cover_art_fit ? currentPersonaInfo.cover_art_fit : null);
		if (!applyAvatarArt(avatar, iconArt, iconFit)) {
			avatar.classList.remove('message-avatar-has-image');
			avatar.innerHTML = '';
			avatar.textContent = 'U';
		}
	} else {
		const iconArt = currentBotInfo && currentBotInfo.icon_art ? currentBotInfo.icon_art : (currentBotInfo && currentBotInfo.cover_art ? currentBotInfo.cover_art : '');
		const iconFit = currentBotInfo && currentBotInfo.icon_fit ? currentBotInfo.icon_fit : (currentBotInfo && currentBotInfo.cover_art_fit ? currentBotInfo.cover_art_fit : null);
		if (!applyAvatarArt(avatar, iconArt, iconFit)) {
			avatar.classList.remove('message-avatar-has-image');
			avatar.innerHTML = '';
			avatar.textContent = currentBotName ? currentBotName[0].toUpperCase() : 'AI';
		}
	}

	const content = document.createElement('div');
	content.className = 'message-content';
	const bubbleWrap = document.createElement('div');
	bubbleWrap.className = 'message-bubble-wrap';
	const bubble = document.createElement('div');
	let variantNav = null;
	bubble.className = 'message-bubble';
	setBubbleTextContent(bubble, text);
	if (isThinking) {
		bubble.classList.add('message-thinking');
	}
	if (messageData && messageData.thinking_append) {
		bubble.classList.add('message-thinking-append');
	}
	if (isThinking && shouldShowThinking()) {
		const thinkingOutput = `${(messageData && messageData.thinking_output) || ''}`;
		if (thinkingOutput.trim()) {
			const output = document.createElement('div');
			output.className = 'message-thinking-output';
			setBubbleTextContent(output, thinkingOutput, true);
			bubble.appendChild(output);
		}
	}
	bubbleWrap.appendChild(bubble);

	if (Number.isInteger(messageIndex)) {
		const messageRole = role || (isUser ? 'user' : 'assistant');
		const actionsWrap = document.createElement('div');
		actionsWrap.className = 'message-actions';

		const createActionButton = (className, title, ariaLabel, iconText, onClick) => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = `message-action-btn ${className}`;
			btn.title = title;
			btn.setAttribute('aria-label', ariaLabel);
			btn.textContent = iconText;
			btn.disabled = isUiGenerationLocked();
			btn.addEventListener('click', () => {
				if (isUiGenerationLocked()) {
					return;
				}
				onClick();
			});
			return btn;
		};

		const editBtn = createActionButton('message-action-edit', 'Edit message', 'Edit message', '✎', () => {
			startInlineMessageEdit({
				bubble,
				bubbleWrap,
				messageIndex,
				originalText: text
			});
		});
		actionsWrap.appendChild(editBtn);

		if (messageRole === 'assistant') {
			const setActionButtonsDisabled = (disabled) => {
				Array.from(actionsWrap.querySelectorAll('.message-action-btn')).forEach(btn => {
					btn.disabled = !!disabled;
				});
			};

			const startThinkingReplace = () => {
				if (Array.isArray(currentChatMessages) && currentChatMessages[messageIndex]) {
					currentChatMessages[messageIndex].thinking = true;
					currentChatMessages[messageIndex].content = getThinkingPlaceholderText();
					delete currentChatMessages[messageIndex].thinking_append;
				}
				bubble.dataset.originalText = bubble.dataset.rawText || '';
				setBubbleTextContent(bubble, getThinkingPlaceholderText(), true);
				bubble.classList.add('message-thinking');
				setActionButtonsDisabled(true);
			};

			const stopThinkingReplace = () => {
				if (Array.isArray(currentChatMessages) && currentChatMessages[messageIndex]) {
					delete currentChatMessages[messageIndex].thinking;
					delete currentChatMessages[messageIndex].thinking_append;
				}
				if (Object.prototype.hasOwnProperty.call(bubble.dataset, 'originalText')) {
					setBubbleTextContent(bubble, bubble.dataset.originalText || '');
					delete bubble.dataset.originalText;
				}
				bubble.classList.remove('message-thinking');
				setActionButtonsDisabled(false);
			};

			const startThinking = () => {
				if (Array.isArray(currentChatMessages) && currentChatMessages[messageIndex]) {
					currentChatMessages[messageIndex].thinking_append = true;
					delete currentChatMessages[messageIndex].thinking;
				}
				bubble.classList.add('message-thinking-append');
				setActionButtonsDisabled(true);
			};

			const stopThinking = () => {
				if (Array.isArray(currentChatMessages) && currentChatMessages[messageIndex]) {
					delete currentChatMessages[messageIndex].thinking_append;
					delete currentChatMessages[messageIndex].thinking;
				}
				bubble.classList.remove('message-thinking-append');
				setActionButtonsDisabled(false);
			};

			const regenerateBtn = createActionButton('message-action-regenerate', 'Regenerate message', 'Regenerate message', '↻', () => {
				actionStreamingToken += 1;
				const localActionToken = actionStreamingToken;
				isChatActionGenerating = true;
				activeChatActionController = new AbortController();
				syncGenerationUiLockState();
				startThinkingReplace();
				renderCurrentChat();
				const hardTimeout = setTimeout(() => {
					if (localActionToken !== actionStreamingToken) {
						return;
					}
					actionStreamingToken += 1;
					if (activeChatActionController) {
						activeChatActionController.abort();
					}
					applyChatActionStreamingFallback('regenerate_message', messageIndex);
					isChatActionGenerating = false;
					activeChatActionController = null;
					syncGenerationUiLockState();
				}, CHAT_ACTION_HARD_TIMEOUT_MS);
				const previousAssistantText = String((messageData && messageData.content) || text || '');
				const actionRequest = runChatMessageAction('regenerate_message', messageIndex, null, null, { signal: activeChatActionController.signal })
					.then(result => applyChatActionResultWithStreaming(result, 'regenerate_message', messageIndex, previousAssistantText, 'replace'));
				actionRequest
					.then(result => {
						if (localActionToken !== actionStreamingToken) {
							return;
						}
						if (!result || result.success === false) {
							applyChatActionStreamingFallback('regenerate_message', messageIndex);
						}
					})
					.catch(() => {
						if (localActionToken !== actionStreamingToken) {
							return;
						}
						applyChatActionStreamingFallback('regenerate_message', messageIndex);
					})
					.finally(() => {
						clearTimeout(hardTimeout);
						if (localActionToken !== actionStreamingToken && !isChatActionGenerating) {
							return;
						}
						isChatActionGenerating = false;
						activeChatActionController = null;
						syncGenerationUiLockState();
					});
			});
			actionsWrap.appendChild(regenerateBtn);

			const continueBtn = createActionButton('message-action-continue', 'Continue message', 'Continue message', '→', () => {
				actionStreamingToken += 1;
				const localActionToken = actionStreamingToken;
				isChatActionGenerating = true;
				activeChatActionController = new AbortController();
				syncGenerationUiLockState();
				startThinking();
				renderCurrentChat();
				const hardTimeout = setTimeout(() => {
					if (localActionToken !== actionStreamingToken) {
						return;
					}
					actionStreamingToken += 1;
					if (activeChatActionController) {
						activeChatActionController.abort();
					}
					stopThinking();
					renderCurrentChat();
					isChatActionGenerating = false;
					activeChatActionController = null;
					syncGenerationUiLockState();
				}, CHAT_ACTION_HARD_TIMEOUT_MS);
				const previousAssistantText = String((messageData && messageData.content) || text || '');
				const actionRequest = runChatMessageAction('continue_message', messageIndex, null, null, { signal: activeChatActionController.signal })
					.then(result => applyChatActionResultWithStreaming(result, 'continue_message', messageIndex, previousAssistantText, 'append'));
				actionRequest
					.then(result => {
						if (localActionToken !== actionStreamingToken) {
							return;
						}
						if (!result || result.success === false) {
							stopThinking();
						}
					})
					.catch(() => {
						if (localActionToken !== actionStreamingToken) {
							return;
						}
						stopThinking();
						renderCurrentChat();
					})
					.finally(() => {
						clearTimeout(hardTimeout);
						if (localActionToken !== actionStreamingToken && !isChatActionGenerating) {
							return;
						}
						isChatActionGenerating = false;
						activeChatActionController = null;
						syncGenerationUiLockState();
					});
			});
			actionsWrap.appendChild(continueBtn);
		} else if (messageRole === 'user' && !hasAssistantReplyAfter) {
			const regenerateUserBtn = createActionButton('message-action-regenerate', 'Generate bot reply', 'Generate bot reply', '↻', () => {
				actionStreamingToken += 1;
				const localActionToken = actionStreamingToken;
				isChatActionGenerating = true;
				activeChatActionController = new AbortController();
				syncGenerationUiLockState();
				regenerateUserBtn.disabled = true;
				const hardTimeout = setTimeout(() => {
					if (localActionToken !== actionStreamingToken) {
						return;
					}
					actionStreamingToken += 1;
					if (activeChatActionController) {
						activeChatActionController.abort();
					}
					applyChatActionStreamingFallback('regenerate_message', messageIndex);
					regenerateUserBtn.disabled = false;
					isChatActionGenerating = false;
					activeChatActionController = null;
					syncGenerationUiLockState();
				}, CHAT_ACTION_HARD_TIMEOUT_MS);
				const clientMessageCount = Array.isArray(currentChatMessages) ? currentChatMessages.length : null;
				const placeholderMessage = {
					role: 'assistant',
					content: getThinkingPlaceholderText(),
					timestamp: new Date().toISOString(),
					thinking: true,
					temp_regen: true
				};
				if (Array.isArray(currentChatMessages)) {
					const insertAt = Math.min(currentChatMessages.length, messageIndex + 1);
					currentChatMessages.splice(insertAt, 0, placeholderMessage);
				}
				renderCurrentChat();
				const actionRequest = runChatMessageAction('regenerate_message', messageIndex, clientMessageCount, null, { signal: activeChatActionController.signal })
					.then(result => applyChatActionResultWithStreaming(result, 'regenerate_message', messageIndex, '', 'replace'));
				actionRequest
					.then(result => {
						if (localActionToken !== actionStreamingToken) {
							return;
						}
						if (!result || result.success === false) {
							applyChatActionStreamingFallback('regenerate_message', messageIndex);
							regenerateUserBtn.disabled = false;
						}
					})
					.catch(() => {
						if (localActionToken !== actionStreamingToken) {
							return;
						}
						applyChatActionStreamingFallback('regenerate_message', messageIndex);
						regenerateUserBtn.disabled = false;
					})
					.finally(() => {
						clearTimeout(hardTimeout);
						if (localActionToken !== actionStreamingToken && !isChatActionGenerating) {
							return;
						}
						isChatActionGenerating = false;
						activeChatActionController = null;
						syncGenerationUiLockState();
					});
			});
			actionsWrap.appendChild(regenerateUserBtn);
		}

		const deleteBtn = createActionButton('message-action-delete', 'Delete message', 'Delete message', '🗑', () => {
			deleteBtn.disabled = true;
			runChatMessageAction('delete_message', messageIndex)
				.then(result => {
					if (!applyChatActionResult(result)) {
						deleteBtn.disabled = false;
					}
				})
				.catch(() => {
					deleteBtn.disabled = false;
				});
		});
		actionsWrap.appendChild(deleteBtn);

		bubbleWrap.appendChild(actionsWrap);

		if (messageRole === 'assistant' && isNewestAssistantMessage && !isThinking && !isGeneratingReply && !isChatActionGenerating && messageData && Array.isArray(messageData.variants) && messageData.variants.length > 1) {
			const totalVariants = messageData.variants.length;
			let selectedVariantRaw = Number.parseInt(messageData.selected_variant_index, 10);
			if (!Number.isFinite(selectedVariantRaw)) {
				selectedVariantRaw = totalVariants - 1;
			}
			let selectedVariant = selectedVariantRaw;
			selectedVariant = Math.max(0, Math.min(selectedVariant, totalVariants - 1));

			variantNav = document.createElement('div');
			variantNav.className = 'message-variant-nav';

			const prevBtn = document.createElement('button');
			prevBtn.type = 'button';
			prevBtn.className = 'message-variant-btn';
			prevBtn.textContent = '<';
			prevBtn.title = 'Previous regenerated message';
			prevBtn.setAttribute('aria-label', 'Previous regenerated message');
			prevBtn.disabled = selectedVariant <= 0;

			const status = document.createElement('span');
			status.className = 'message-variant-status';
			status.textContent = `${selectedVariant + 1}/${totalVariants}`;

			const nextBtn = document.createElement('button');
			nextBtn.type = 'button';
			nextBtn.className = 'message-variant-btn';
			nextBtn.textContent = '>';
			nextBtn.title = 'Next regenerated message';
			nextBtn.setAttribute('aria-label', 'Next regenerated message');
			nextBtn.disabled = selectedVariant >= (totalVariants - 1);

			const setVariantDisabled = (disabled) => {
				prevBtn.disabled = disabled || selectedVariant <= 0;
				nextBtn.disabled = disabled || selectedVariant >= (totalVariants - 1);
			};

			const switchVariant = (nextIndex) => {
				if (isUiGenerationLocked()) {
					return;
				}
				const clampedIndex = Math.max(0, Math.min(nextIndex, totalVariants - 1));
				if (clampedIndex === selectedVariant) {
					return;
				}

				const previousIndex = selectedVariant;
				selectedVariant = clampedIndex;
				status.textContent = `${selectedVariant + 1}/${totalVariants}`;
				setVariantDisabled(false);

				if (Array.isArray(currentChatMessages) && currentChatMessages[messageIndex] && Array.isArray(currentChatMessages[messageIndex].variants)) {
					const targetMessage = currentChatMessages[messageIndex];
					const localVariant = targetMessage.variants[clampedIndex];
					targetMessage.selected_variant_index = clampedIndex;
					if (localVariant && typeof localVariant.content === 'string') {
						targetMessage.content = localVariant.content;
					}
					renderCurrentChat();
				}

				setVariantDisabled(true);
				runChatMessageAction('select_variant', messageIndex, null, { variant_index: clampedIndex })
					.then(result => {
						if (!applyChatActionResult(result)) {
							selectedVariant = previousIndex;
							setVariantDisabled(false);
							renderCurrentChat();
						}
					})
					.catch(() => {
						selectedVariant = previousIndex;
						setVariantDisabled(false);
						renderCurrentChat();
					});
			};

			prevBtn.addEventListener('click', () => switchVariant(selectedVariant - 1));
			nextBtn.addEventListener('click', () => switchVariant(selectedVariant + 1));

			variantNav.appendChild(prevBtn);
			variantNav.appendChild(status);
			variantNav.appendChild(nextBtn);
			content.appendChild(variantNav);
		}
	}
	const meta = document.createElement('div');
	meta.className = 'message-time';
	const showTime = shouldShowTimestamps();
	const formatted = formatTimestamp(timestamp);
	const metaLeft = document.createElement('div');
	metaLeft.className = 'message-time-left';
	const name = document.createElement('span');
	name.className = 'message-meta-name';
	name.textContent = isUser ? (currentPersonaInfo && currentPersonaInfo.name ? currentPersonaInfo.name : 'User') : (currentBotName || 'Bot');
	const timeText = document.createElement('span');
	timeText.className = 'message-meta-time';
	timeText.textContent = formatted || '';
	if (!showTime) {
		timeText.classList.add('hidden');
	}
	metaLeft.appendChild(name);
	metaLeft.appendChild(timeText);
	meta.appendChild(metaLeft);
	if (variantNav) {
		variantNav.classList.add('message-variant-nav-inline');
		meta.appendChild(variantNav);
	}
	content.appendChild(bubbleWrap);
	content.appendChild(meta);
	msg.appendChild(avatar);
	msg.appendChild(content);
	messagesContainer.appendChild(msg);
	if (!Number.isInteger(messageIndex)) {
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}
}

function sendMessage() {
	if (isUiGenerationLocked()) {
		stopMessageGeneration();
		return;
	}
	const text = messageInput.value.trim();
	if (!text || !currentChatId) {
		return;
	}
	isGeneratingReply = true;
	syncGenerationUiLockState();
	activeGenerationToken += 1;
	const generationToken = activeGenerationToken;
	activeGenerationController = new AbortController();
	const timestamp = new Date().toISOString();
	addMessage(text, true, timestamp);
	currentChatMessages = currentChatMessages || [];
	currentChatMessages.push({ role: 'user', content: text, timestamp: timestamp });
	renderCurrentChat();
	messageInput.value = '';
	resetMessageInputHeight();
	const thinkingTimestamp = new Date().toISOString();
	currentChatMessages.push({ role: 'assistant', content: getThinkingPlaceholderText(), timestamp: thinkingTimestamp, thinking: true });
	renderCurrentChat();
	const useStreaming = shouldEnableTextStreaming();
	const requestPromise = useStreaming
		? streamAssistantReplyFromBackend(text, generationToken)
		: postJson('/api/message', {
			message: text,
			chat_id: currentChatId,
			bot_name: currentBotName,
			...getCurrentPersonaPayload()
		}, { signal: activeGenerationController.signal }).then(r => r.json());

	requestPromise
		.then(data => {
			if (generationToken !== activeGenerationToken) {
				return;
			}
			isGeneratingReply = false;
			activeGenerationController = null;
			syncGenerationUiLockState();
			if (Array.isArray(currentChatMessages) && currentChatMessages.length) {
				const lastIndex = currentChatMessages.length - 1;
				if (currentChatMessages[lastIndex] && currentChatMessages[lastIndex].thinking) {
					currentChatMessages.splice(lastIndex, 1);
				}
			}
			if (data && data.context) {
				setCurrentChatContextStats(data.context);
			}
			if (data && data.cancelled) {
				renderCurrentChat();
				return;
			}
			if (data.response) {
				if (!useStreaming) {
					const responseTimestamp = new Date().toISOString();
					currentChatMessages.push({ role: 'assistant', content: data.response, timestamp: responseTimestamp });
					renderCurrentChat();
				}
				saveAssistantResponse(data.response, generationToken).catch(() => {});
			} else {
				if (useStreaming) {
					showStreamingApiClientFallbackMessage();
				} else {
					renderCurrentChat();
				}
			}
		})
		.catch(error => {
			if (generationToken !== activeGenerationToken) {
				return;
			}
			isGeneratingReply = false;
			activeGenerationController = null;
			syncGenerationUiLockState();
			if (error && error.name === 'AbortError') {
				clearThinkingPlaceholder();
				renderCurrentChat();
				return;
			}
			if (Array.isArray(currentChatMessages) && currentChatMessages.length) {
				const lastIndex = currentChatMessages.length - 1;
				if (currentChatMessages[lastIndex] && currentChatMessages[lastIndex].thinking) {
					currentChatMessages.splice(lastIndex, 1);
				}
			}
			if (useStreaming) {
				showStreamingApiClientFallbackMessage();
			} else {
				renderCurrentChat();
			}
		});
}

function ensureFirstIamLoadedOnStartup() {
	if (!currentBotName || !currentChatId) {
		return Promise.resolve();
	}
	const hasUserMessage = Array.isArray(currentChatMessages) && currentChatMessages.some(msg => (msg || {}).role === 'user');
	if (hasUserMessage) {
		return Promise.resolve();
	}

	return postJson('/api/bot/iam', { action: 'list_sets', bot_name: currentBotName })
		.then(r => r.json())
		.then(data => {
			const defaultIamSet = (typeof DEFAULT_IAM_SET !== 'undefined' && DEFAULT_IAM_SET) ? DEFAULT_IAM_SET : 'IAM_1';
			const setNames = (typeof getSortedIamSetNames === 'function')
				? getSortedIamSetNames((data && data.sets) ? data.sets : [defaultIamSet])
				: ((data && data.sets) || [defaultIamSet]);
			if (!setNames || !setNames.length) {
				return;
			}

			const firstSet = setNames[0];
			return postJson('/api/chats', {
				action: 'switch_iam',
				chat_id: currentChatId,
				bot_name: currentBotName,
				iam_set: firstSet,
				persona_name: (currentPersonaInfo && currentPersonaInfo.name) ? currentPersonaInfo.name : 'User'
			})
				.then(r => r.json())
				.then(result => {
					if (!result || !result.success) {
						return;
					}
					chatBotIamSelections[currentBotName] = firstSet;
					if (Array.isArray(result.messages)) {
						currentChatMessages = result.messages;
					}
					if (result.context) {
						setCurrentChatContextStats(result.context);
					}
				});
		})
		.catch(() => {
			// Keep existing chat if IAM sync fails.
		});
}

function autoLoadLastChat(settings) {
	if (!settings || !settings.auto_load_last_chat) {
		return;
	}
	// Always load the most recent chat globally on app startup.
	postJson('/api/last-chat', { bot_name: null })
		.then(r => r.json())
		.then(data => {
			if (data && data.chat_info) {
				currentChatId = data.chat_info.id;
				currentBotName = data.chat_info.bot || null;
				currentChatMessages = data.messages || [];
				setCurrentChatContextStats(data.context || null);
				// Fetch bot info for coverart
				postJson('/api/bot/select', { bot_name: currentBotName })
					.then(r => r.json())
					.then(botData => {
						if (botData.success) {
							currentBotInfo = botData.bot;
						}
						ensureFirstIamLoadedOnStartup().finally(() => {
							switchToLastChat();
						});
					});
			}
		});
}

function refreshChatContextFromSettings(event) {
	if (!currentChatContextStats || typeof currentChatContextStats !== 'object') {
		return;
	}
	const nextMaxTokens = Number.parseInt((event && event.detail && event.detail.max_tokens), 10) || getCurrentGenerationMaxTokens();
	if (!Number.isFinite(nextMaxTokens) || nextMaxTokens <= 0) {
		return;
	}
	const totalTokens = Number.parseInt(currentChatContextStats.total_tokens, 10) || 0;
	setCurrentChatContextStats({
		...currentChatContextStats,
		max_tokens: nextMaxTokens,
		usage_ratio: Math.max(0, Math.min(1, totalTokens / Math.max(1, nextMaxTokens)))
	});
	renderChatContextIndicator();
}

if (!window.__novaChatContextSettingsBound) {
	window.__novaChatContextSettingsBound = true;
	window.addEventListener('nova:settings-updated', refreshChatContextFromSettings);
	window.addEventListener('nova:settings-updated', () => {
		if (currentView !== 'last-chat') {
			return;
		}
		if (isUiGenerationLocked()) {
			applyProcessingLabelToThinkingMessages();
		}
		renderCurrentChat();
	});
}
