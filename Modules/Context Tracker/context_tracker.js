(function () {
	'use strict';

	let tokensPerCharacter = 0.25;
	let trackerElement = null;
	let lastRenderSignature = '';
	let currentRenderToken = 0;
	let updateTimer = null;
	let lastRenderedKey = '';
	let datasetCache = {
		items: [],
		loadedAt: 0,
		pending: null
	};
	const DATASET_CACHE_TTL_MS = 8000;

	function estimateTokens(text) {
		const raw = `${text || ''}`;
		if (!raw.trim()) {
			return 0;
		}
		return Math.ceil(raw.length * tokensPerCharacter);
	}

	function getMaxTokens() {
		if (window.settingsDraft && Number.isFinite(window.settingsDraft.max_tokens)) {
			return window.settingsDraft.max_tokens;
		}
		if (window.lastSavedSettings && Number.isFinite(window.lastSavedSettings.max_tokens)) {
			return window.lastSavedSettings.max_tokens;
		}
		return 10000;
	}

	function safeText(value) {
		return `${value == null ? '' : value}`.trim();
	}

	function escapeRegExp(value) {
		return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function keywordMatches(keyword, contextText) {
		const safeKeyword = safeText(keyword).toLowerCase();
		if (!safeKeyword) {
			return false;
		}
		if (safeKeyword.length >= 3) {
			const pattern = new RegExp(`\\b${escapeRegExp(safeKeyword)}\\b`, 'i');
			if (pattern.test(contextText)) {
				return true;
			}
		}
		return contextText.includes(safeKeyword);
	}

	function normalizeInjectionPersistence(value) {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed)) {
			return 6;
		}
		return Math.max(0, parsed);
	}

	function buildUserTurnTexts(messages) {
		if (!Array.isArray(messages)) {
			return [];
		}
		const turns = [];
		for (const row of messages) {
			if (!row || typeof row !== 'object') {
				continue;
			}
			if (`${row.role || ''}`.toLowerCase() !== 'user') {
				continue;
			}
			const content = safeText(row.content);
			if (!content) {
				continue;
			}
			turns.push(content.toLowerCase());
		}
		return turns;
	}

	function resolveDynamicEntryState(keywords, latestUserText, userTurnTexts, persistenceTurns) {
		const keywordList = Array.isArray(keywords)
			? keywords.map((item) => safeText(item)).filter(Boolean)
			: safeText(keywords)
				? safeText(keywords).split(',').map((item) => safeText(item)).filter(Boolean)
				: [];

		if (!keywordList.length) {
			return false;
		}

		const directMatch = keywordList.some((keyword) => keywordMatches(keyword, latestUserText));
		if (directMatch) {
			return true;
		}

		if (persistenceTurns <= 0 || userTurnTexts.length <= 1) {
			return false;
		}

		const priorTurns = userTurnTexts.slice(0, -1);
		for (let reverseIndex = 1; reverseIndex <= priorTurns.length; reverseIndex += 1) {
			const turnText = priorTurns[priorTurns.length - reverseIndex];
			const matched = keywordList.some((keyword) => keywordMatches(keyword, turnText));
			if (!matched) {
				continue;
			}
			return reverseIndex <= persistenceTurns;
		}

		return false;
	}

	async function loadDatasetsForTracker(forceRefresh = false) {
		const now = Date.now();
		if (!forceRefresh && (now - datasetCache.loadedAt) < DATASET_CACHE_TTL_MS) {
			return datasetCache.items;
		}

		if (datasetCache.pending) {
			return datasetCache.pending;
		}

		datasetCache.pending = fetch('/api/datasets')
			.then((response) => {
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				return response.json();
			})
			.then((result) => {
				const rows = Array.isArray(result && result.datasets) ? result.datasets : [];
				datasetCache.items = rows;
				datasetCache.loadedAt = Date.now();
				return rows;
			})
			.catch(() => datasetCache.items)
			.finally(() => {
				datasetCache.pending = null;
			});

		return datasetCache.pending;
	}

	function getTrackerContext() {
		if (window.currentBotName && window.currentChatId) {
			return {
				botName: window.currentBotName,
				chatId: window.currentChatId,
				messages: Array.isArray(window.currentChatMessages) ? window.currentChatMessages : []
			};
		}
		return null;
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

	function resolveContextTrackerPromptKey(state) {
		const order = Array.isArray(state && state.order) ? state.order : [];
		const target = normalizeModuleName('Context Tracker');
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

	function isTrackerEnabledForCurrentBot() {
		const state = getActivePromptOrderState();
		const trackerKey = resolveContextTrackerPromptKey(state);
		if (!trackerKey) {
			return false;
		}
		if (Object.prototype.hasOwnProperty.call(state.enabled, trackerKey)) {
			return !!state.enabled[trackerKey];
		}
		return true;
	}

	function isChatTabActive() {
		const appRoot = document.querySelector('.app');
		if (appRoot && appRoot.classList.contains('chat-layout')) {
			return true;
		}
		if (window.currentView === 'last-chat') {
			return true;
		}
		const activeNav = document.querySelector('.nav-item.active[data-view="last-chat"]');
		if (activeNav) {
			return true;
		}
		const inputArea = document.getElementById('inputArea');
		if (window.currentChatId && inputArea && inputArea.classList.contains('visible')) {
			return true;
		}
		return false;
	}

	function countUserMessages(messages) {
		if (!Array.isArray(messages)) {
			return 0;
		}
		return messages.reduce((count, message) => {
			const role = `${(message && message.role) || ''}`.toLowerCase();
			const content = `${(message && message.content) || ''}`.trim();
			if (role !== 'user' || !content) {
				return count;
			}
			return count + 1;
		}, 0);
	}

	function resolveEffectiveMessageContent(message) {
		if (!message || typeof message !== 'object') {
			return '';
		}
		const role = `${message.role || ''}`.toLowerCase();
		if (role !== 'assistant') {
			return `${message.content || ''}`;
		}
		const variants = Array.isArray(message.variants) ? message.variants : [];
		if (!variants.length) {
			return `${message.content || ''}`;
		}
		let selectedIndex = Number.parseInt(message.selected_variant_index, 10);
		if (!Number.isFinite(selectedIndex)) {
			selectedIndex = variants.length - 1;
		}
		selectedIndex = Math.max(0, Math.min(selectedIndex, variants.length - 1));
		const selectedVariant = variants[selectedIndex];
		if (selectedVariant && typeof selectedVariant === 'object' && typeof selectedVariant.content === 'string') {
			return selectedVariant.content;
		}
		return `${message.content || ''}`;
	}

	function calculateIamsTokensFromMessages(messages) {
		if (!Array.isArray(messages)) {
			return 0;
		}
		return messages.reduce((total, message) => {
			const role = `${(message && message.role) || ''}`.toLowerCase();
			if (role !== 'user' && role !== 'assistant') {
				return total;
			}
			const content = resolveEffectiveMessageContent(message);
			if (!`${content}`.trim()) {
				return total;
			}
			return total + estimateTokens(content);
		}, 0);
	}

	function buildMessagesSignature(messages) {
		if (!Array.isArray(messages) || !messages.length) {
			return 'empty';
		}
		return messages.map((message, index) => {
			const role = `${(message && message.role) || ''}`.toLowerCase();
			const selected = Number.parseInt((message && message.selected_variant_index), 10);
			const selectedIndex = Number.isFinite(selected) ? selected : -1;
			const effectiveContent = resolveEffectiveMessageContent(message);
			const normalized = `${effectiveContent || ''}`.replace(/\s+/g, ' ').trim();
			return `${index}:${role}:${selectedIndex}:${normalized.length}:${normalized}`;
		}).join('|');
	}

	function resolveExampleTokens(botInfo, trackerContext) {
		if (!botInfo || typeof botInfo !== 'object') {
			return 0;
		}
		const exampleText = `${botInfo.example_messages || ''}`;
		if (!exampleText.trim()) {
			return 0;
		}

		const thresholdRaw = Number.parseInt(botInfo.example_injection_threshold, 10);
		const threshold = Number.isFinite(thresholdRaw) ? Math.max(0, thresholdRaw) : 0;
		if (threshold === 0) {
			return estimateTokens(exampleText);
		}

		const messages = (trackerContext && Array.isArray(trackerContext.messages))
			? trackerContext.messages
			: (Array.isArray(window.currentChatMessages) ? window.currentChatMessages : []);
		const userCount = countUserMessages(messages);
		return userCount <= threshold ? estimateTokens(exampleText) : 0;
	}

	async function calculateDatasetTokens(botInfo, trackerContext, messages) {
		const totals = {
			dataset_static: 0,
			dataset_dynamic: 0
		};
		if (!botInfo || typeof botInfo !== 'object') {
			return totals;
		}

		const activeDatasetId = safeText(botInfo.active_dataset_id);
		if (!activeDatasetId) {
			return totals;
		}

		const datasets = await loadDatasetsForTracker();
		const activeDataset = (datasets || []).find((row) => safeText(row && row.id) === activeDatasetId);
		if (!activeDataset || !Array.isArray(activeDataset.entries)) {
			return totals;
		}

		const sortedEntries = activeDataset.entries.slice().sort((a, b) => {
			const left = Number.parseInt((a && a.order), 10);
			const right = Number.parseInt((b && b.order), 10);
			const safeLeft = Number.isFinite(left) ? left : 0;
			const safeRight = Number.isFinite(right) ? right : 0;
			return safeLeft - safeRight;
		});

		const userTurnTexts = buildUserTurnTexts(messages);
		const latestUserText = userTurnTexts.length ? userTurnTexts[userTurnTexts.length - 1] : '';
		const persistenceTurns = normalizeInjectionPersistence(botInfo.dataset_injection_persistence);

		for (const entry of sortedEntries) {
			if (!entry || typeof entry !== 'object') {
				continue;
			}
			const mode = safeText(entry.mode || 'static').toLowerCase();
			if (mode === 'inactive') {
				continue;
			}
			if (Object.prototype.hasOwnProperty.call(entry, 'prompt_enabled') && !entry.prompt_enabled) {
				continue;
			}
			const contextValue = safeText(entry.context);
			if (!contextValue) {
				continue;
			}
			const contextTokens = estimateTokens(contextValue);

			if (mode === 'dynamic') {
				const shouldInclude = resolveDynamicEntryState(
					entry.keywords,
					latestUserText,
					userTurnTexts,
					persistenceTurns
				);
				if (shouldInclude) {
					totals.dataset_dynamic += contextTokens;
				}
				continue;
			}

			totals.dataset_static += contextTokens;
		}

		return totals;
	}

	async function calculateTokenUsage(trackerContext) {
		const breakdown = {
			definition: 0,
			rules: 0,
			persona: 0,
			example_messages: 0,
			iams: 0,
			dataset_static: 0,
			dataset_dynamic: 0,
			total: 0
		};

		const botInfo = window.currentBotInfo;
		if (botInfo && typeof botInfo === 'object') {
			if (botInfo.core_data) {
				breakdown.definition = estimateTokens(botInfo.core_data);
			}
			if (botInfo.scenario_data) {
				breakdown.rules = estimateTokens(botInfo.scenario_data);
			}
			breakdown.example_messages = resolveExampleTokens(botInfo, trackerContext);
		}

		if (window.currentPersonaInfo && window.currentPersonaInfo.description) {
			breakdown.persona = estimateTokens(window.currentPersonaInfo.description);
		}

		const messages = trackerContext && Array.isArray(trackerContext.messages)
			? trackerContext.messages
			: (Array.isArray(window.currentChatMessages) ? window.currentChatMessages : []);

		breakdown.iams = calculateIamsTokensFromMessages(messages);
		const datasetTotals = await calculateDatasetTokens(botInfo, trackerContext, messages);
		breakdown.dataset_static = datasetTotals.dataset_static;
		breakdown.dataset_dynamic = datasetTotals.dataset_dynamic;

		breakdown.total =
			breakdown.definition +
			breakdown.rules +
			breakdown.persona +
			breakdown.example_messages +
			breakdown.iams +
			breakdown.dataset_static +
			breakdown.dataset_dynamic;

		return breakdown;
	}

	function formatNumber(value) {
		return String(value || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	}

	function clearTracker() {
		if (trackerElement && trackerElement.parentNode) {
			trackerElement.parentNode.removeChild(trackerElement);
		}
		trackerElement = null;
		lastRenderSignature = '';
	}

	function scheduleTrackerUpdate(delayMs = 50) {
		if (updateTimer) {
			return;
		}
		updateTimer = setTimeout(() => {
			updateTimer = null;
			updateContextTracker();
		}, Math.max(0, Number.parseInt(delayMs, 10) || 0));
	}

	function handleChatRendered() {
		const chatHeader = document.getElementById('chatHeader');
		if (!chatHeader || !isChatTabActive() || !isTrackerEnabledForCurrentBot()) {
			clearTracker();
			return;
		}
		findOrCreateTrackerHost(chatHeader);
		scheduleTrackerUpdate(0);
	}

	function findOrCreateTrackerHost(chatHeader) {
		if (!chatHeader) {
			return null;
		}
		if (trackerElement && document.contains(trackerElement)) {
			return trackerElement;
		}
		trackerElement = document.createElement('div');
		trackerElement.className = 'context-tracker';
		chatHeader.appendChild(trackerElement);
		return trackerElement;
	}

	function ensureTrackerStructure(host) {
		if (!host) {
			return;
		}
		if (host.dataset.initialized === '1') {
			return;
		}
		host.innerHTML = `
			<div class="context-tracker-main">
				<div class="context-tracker-label">Context:</div>
				<div class="context-tracker-numbers" data-field="numbers">0 / 0</div>
				<div class="context-tracker-progress">
					<div class="context-progress-bg">
						<div class="context-progress-fill" data-field="progress-fill" style="width: 0%; background: #00ff88;"></div>
					</div>
					<div class="context-progress-text" data-field="progress-text">0.0%</div>
				</div>
			</div>
			<div class="context-tracker-tooltip">
				<div class="context-tooltip-title">Context Token Breakdown</div>
				<div class="context-tooltip-item" data-row="definition"><span class="context-tooltip-label">Definition:</span><span class="context-tooltip-value"><span data-value="definition">0</span> <span class="context-tooltip-percent" data-percent="definition">(0.0%)</span></span></div>
				<div class="context-tooltip-item" data-row="rules"><span class="context-tooltip-label">Rules:</span><span class="context-tooltip-value"><span data-value="rules">0</span> <span class="context-tooltip-percent" data-percent="rules">(0.0%)</span></span></div>
				<div class="context-tooltip-item" data-row="persona"><span class="context-tooltip-label">Persona:</span><span class="context-tooltip-value"><span data-value="persona">0</span> <span class="context-tooltip-percent" data-percent="persona">(0.0%)</span></span></div>
				<div class="context-tooltip-item" data-row="example_messages"><span class="context-tooltip-label">Example Messages:</span><span class="context-tooltip-value"><span data-value="example_messages">0</span> <span class="context-tooltip-percent" data-percent="example_messages">(0.0%)</span></span></div>
				<div class="context-tooltip-item" data-row="iams"><span class="context-tooltip-label">IAMs:</span><span class="context-tooltip-value"><span data-value="iams">0</span> <span class="context-tooltip-percent" data-percent="iams">(0.0%)</span></span></div>
				<div class="context-tooltip-item" data-row="dataset_static"><span class="context-tooltip-label">Static Entries:</span><span class="context-tooltip-value"><span data-value="dataset_static">0</span> <span class="context-tooltip-percent" data-percent="dataset_static">(0.0%)</span></span></div>
				<div class="context-tooltip-item" data-row="dataset_dynamic"><span class="context-tooltip-label">Dynamic Entries:</span><span class="context-tooltip-value"><span data-value="dataset_dynamic">0</span> <span class="context-tooltip-percent" data-percent="dataset_dynamic">(0.0%)</span></span></div>
				<div class="context-tooltip-divider"></div>
				<div class="context-tooltip-total">
					<span class="context-tooltip-label">Total Used:</span>
					<span class="context-tooltip-value" data-field="total-used">0</span>
				</div>
			</div>
		`;
		host.dataset.initialized = '1';
	}

	function updateTrackerStructure(host, breakdown, maxTokens, usagePercent, barColor) {
		if (!host) {
			return;
		}
		const numbersEl = host.querySelector('[data-field="numbers"]');
		const progressFillEl = host.querySelector('[data-field="progress-fill"]');
		const progressTextEl = host.querySelector('[data-field="progress-text"]');
		const totalUsedEl = host.querySelector('[data-field="total-used"]');

		if (numbersEl) {
			numbersEl.textContent = `${formatNumber(breakdown.total)} / ${formatNumber(maxTokens)}`;
		}
		if (progressFillEl) {
			progressFillEl.style.width = `${usagePercent}%`;
			progressFillEl.style.background = barColor;
		}
		if (progressTextEl) {
			progressTextEl.textContent = `${usagePercent.toFixed(1)}%`;
		}
		if (totalUsedEl) {
			totalUsedEl.textContent = formatNumber(breakdown.total);
		}

		const fields = ['definition', 'rules', 'persona', 'example_messages', 'iams', 'dataset_static', 'dataset_dynamic'];
		for (const field of fields) {
			const row = host.querySelector(`[data-row="${field}"]`);
			const valueEl = host.querySelector(`[data-value="${field}"]`);
			const percentEl = host.querySelector(`[data-percent="${field}"]`);
			const value = Number.parseInt(breakdown[field], 10) || 0;
			const percent = maxTokens > 0 ? ((value / maxTokens) * 100).toFixed(1) : '0.0';

			if (row) {
				row.style.display = value > 0 ? 'flex' : 'none';
			}
			if (valueEl) {
				valueEl.textContent = formatNumber(value);
			}
			if (percentEl) {
				percentEl.textContent = `(${percent}%)`;
			}
		}
	}

	async function updateContextTracker() {
		const chatHeader = document.getElementById('chatHeader');
		if (!chatHeader) {
			clearTracker();
			return;
		}

		if (!isChatTabActive()) {
			clearTracker();
			return;
		}

		if (!isTrackerEnabledForCurrentBot()) {
			clearTracker();
			return;
		}

		const trackerContext = getTrackerContext();
		if (!trackerContext || !trackerContext.chatId || !trackerContext.botName) {
			clearTracker();
			return;
		}

		const currentMessagesSignature = buildMessagesSignature(trackerContext.messages);
		const currentSignature = `${trackerContext.botName || ''}::${trackerContext.chatId || ''}::${currentMessagesSignature}`;
		const currentToken = ++currentRenderToken;
		lastRenderSignature = currentSignature;

		const host = findOrCreateTrackerHost(chatHeader);
		if (!host) {
			return;
		}

		if (window.__novaSuspendContextTrackerUpdates) {
			ensureTrackerStructure(host);
			return;
		}

		const breakdown = await calculateTokenUsage(trackerContext);
		if (currentToken !== currentRenderToken) {
			return;
		}
		const maxTokens = getMaxTokens();
		const usagePercent = maxTokens > 0 ? Math.min((breakdown.total / maxTokens) * 100, 100) : 0;

		let barColor;
		if (usagePercent < 50) {
			barColor = '#00ff88';
		} else if (usagePercent < 75) {
			barColor = '#ffd700';
		} else if (usagePercent < 90) {
			barColor = '#ff8c00';
		} else {
			barColor = '#ff4444';
		}

		const nextRenderKey = `${trackerContext.botName || ''}::${trackerContext.chatId || ''}::${formatNumber(breakdown.total)}::${formatNumber(maxTokens)}::${usagePercent.toFixed(1)}::${formatNumber(breakdown.iams)}::${formatNumber(breakdown.dataset_static)}::${formatNumber(breakdown.dataset_dynamic)}::${formatNumber(breakdown.example_messages)}`;
		if (nextRenderKey === lastRenderedKey && host.dataset.initialized === '1') {
			return;
		}

		ensureTrackerStructure(host);
		updateTrackerStructure(host, breakdown, maxTokens, usagePercent, barColor);
		lastRenderedKey = nextRenderKey;
	}

	function hookChatEvents() {
		if (typeof window === 'undefined') {
			return;
		}

		const originalOpenChat = window.openChat;
		if (typeof originalOpenChat === 'function' && !originalOpenChat.__contextTrackerWrapped) {
			const wrappedOpenChat = function (...args) {
				const result = originalOpenChat.apply(this, args);
				handleChatRendered();
				return result;
			};
			wrappedOpenChat.__contextTrackerWrapped = true;
			window.openChat = wrappedOpenChat;
		}

		const originalRenderCurrentChat = window.renderCurrentChat;
		if (typeof originalRenderCurrentChat === 'function' && !originalRenderCurrentChat.__contextTrackerWrapped) {
			const wrappedRenderCurrentChat = function (...args) {
				const result = originalRenderCurrentChat.apply(this, args);
				handleChatRendered();
				return result;
			};
			wrappedRenderCurrentChat.__contextTrackerWrapped = true;
			window.renderCurrentChat = wrappedRenderCurrentChat;
		}
	}

	function initContextTracker() {
		hookChatEvents();
		handleChatRendered();
		scheduleTrackerUpdate(0);
		scheduleTrackerUpdate(400);
		scheduleTrackerUpdate(1000);
		setInterval(() => scheduleTrackerUpdate(0), 3000);
		window.NovaContextTracker = {
			update: () => scheduleTrackerUpdate(0),
			onChatRendered: handleChatRendered,
			isEnabledForCurrentBot: isTrackerEnabledForCurrentBot
		};
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initContextTracker);
	} else {
		initContextTracker();
	}
})();
