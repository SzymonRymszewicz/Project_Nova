(function () {
	'use strict';

	if (window.__variableTrackingModule && window.__variableTrackingModule.initialized) {
		return;
	}
	window.__variableTrackingModule = window.__variableTrackingModule || { initialized: false };
	window.__variableTrackingModule.initialized = true;

	const MODULE_NAME = 'Variable Tracking';
	let lastChangeByChat = new Map();
	let editingName = '';
	let refreshTimer = null;
	let refreshInFlight = false;
	let hooksInstalled = false;
	let lastFetchedChatKey = '';
	let lastFetchedSignature = '';

	function normalizeName(value) {
		return `${value || ''}`.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
	}

	function isModuleEnabled() {
		const botInfo = window.currentBotInfo;
		if (!botInfo || typeof botInfo !== 'object') {
			return false;
		}
		const order = Array.isArray(botInfo.prompt_order) ? botInfo.prompt_order : [];
		const enabled = (botInfo.prompt_order_enabled && typeof botInfo.prompt_order_enabled === 'object') ? botInfo.prompt_order_enabled : {};
		let matchedKey = null;
		for (const item of order) {
			const key = `${item || ''}`.trim();
			if (!key.startsWith('module::')) {
				continue;
			}
			const moduleName = key.slice('module::'.length).trim();
			if (normalizeName(moduleName) === normalizeName(MODULE_NAME)) {
				matchedKey = key;
				break;
			}
		}
		if (!matchedKey) {
			return false;
		}
		if (Object.prototype.hasOwnProperty.call(enabled, matchedKey)) {
			return !!enabled[matchedKey];
		}
		return true;
	}

	function getContext() {
		const botName = `${window.currentBotName || ''}`.trim();
		const chatId = `${window.currentChatId || ''}`.trim();
		if (!botName || !chatId) {
			return null;
		}
		return { botName, chatId, key: `${botName}::${chatId}` };
	}

	function isChatViewActive() {
		if (`${window.currentView || ''}` !== 'last-chat') {
			return false;
		}
		const appRoot = document.querySelector('.app');
		if (appRoot && !appRoot.classList.contains('chat-layout')) {
			return false;
		}
		return true;
	}

	function buildMessageSignature() {
		const messages = Array.isArray(window.currentChatMessages) ? window.currentChatMessages : [];
		if (!messages.length) {
			return 'empty';
		}
		return messages.map((message, index) => {
			const role = `${(message && message.role) || ''}`.toLowerCase();
			const content = `${(message && message.content) || ''}`;
			const selectedVariant = Number.parseInt((message && message.selected_variant_index), 10);
			const variantMark = Number.isFinite(selectedVariant) ? selectedVariant : -1;
			return `${index}:${role}:${variantMark}:${content.length}`;
		}).join('|');
	}

	function scheduleRefresh(force = false, delay = 120) {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
		}
		refreshTimer = window.setTimeout(() => {
			refreshTimer = null;
			refreshState(force);
		}, Math.max(0, Number.parseInt(delay, 10) || 0));
	}

	function callModuleAction(action, payload = {}) {
		const ctx = getContext();
		if (!ctx) {
			return Promise.resolve({ success: false, message: 'No active chat context' });
		}
		return fetch('/api/module-action', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				module_name: MODULE_NAME,
				action,
				bot_name: ctx.botName,
				chat_id: ctx.chatId,
				payload: { ...payload, bot_name: ctx.botName, chat_id: ctx.chatId }
			})
		}).then(r => r.json());
	}

	function getPanelHost() {
		const inner = document.getElementById('botPanelInner');
		if (!inner || !inner.querySelector('.bot-panel-group')) {
			return null;
		}
		return inner;
	}

	function ensureSection() {
		const host = getPanelHost();
		if (!host) {
			return null;
		}
		let section = host.querySelector('.bot-panel-group.bot-panel-variables-group');
		if (section) {
			return section;
		}

		section = document.createElement('div');
		section.className = 'bot-panel-group bot-panel-variables-group';
		section.innerHTML = '' +
			'<div class="section-collapsible-header">' +
				'<span class="section-collapsible-title">Variables</span>' +
				'<button class="section-collapsible-toggle" type="button" aria-label="Collapse Variables" title="Collapse Variables">v</button>' +
			'</div>' +
			'<div class="section-collapsible-body">' +
				'<div class="variable-tracker-toolbar">' +
					'<label class="variable-tracker-toggle"><input type="checkbox" class="variable-tracker-auto-input"><span>Enable auto variable tracking?</span></label>' +
					'<button type="button" class="btn btn-secondary variable-tracker-refresh-btn">Refresh</button>' +
				'</div>' +
				'<div class="variable-tracker-status"></div>' +
				'<div class="variable-tracker-editor">' +
					'<input type="text" class="setting-input variable-input-name" placeholder="name (e.g. user_hp)">' +
					'<input type="text" class="setting-input variable-input-value" placeholder="value (e.g. 10, 42%, 09:30)">' +
					'<select class="setting-input variable-input-type"><option value="">auto</option><option value="number">number</option><option value="percent">percent</option><option value="time">time</option><option value="string">string</option></select>' +
					'<select class="setting-input variable-input-scope"><option value="global">global</option><option value="user">user</option><option value="assistant">assistant</option></select>' +
					'<button type="button" class="btn btn-primary variable-save-btn">Save Variable</button>' +
					'<button type="button" class="btn btn-secondary variable-cancel-edit-btn" style="display:none;">Cancel Edit</button>' +
				'</div>' +
				'<div class="variable-tracker-list"></div>' +
			'</div>';

		const generation = host.querySelector('.bot-panel-group:not(.bot-panel-images-group)');
		if (generation) {
			host.insertBefore(section, generation);
		} else {
			host.appendChild(section);
		}

		const toggle = section.querySelector('.section-collapsible-toggle');
		if (toggle) {
			toggle.addEventListener('click', () => {
				const collapsed = section.classList.toggle('section-collapsed');
				toggle.textContent = collapsed ? '<' : 'v';
				toggle.setAttribute('aria-label', collapsed ? 'Expand Variables' : 'Collapse Variables');
				toggle.title = collapsed ? 'Expand Variables' : 'Collapse Variables';
			});
		}

		const refreshBtn = section.querySelector('.variable-tracker-refresh-btn');
		if (refreshBtn) {
			refreshBtn.addEventListener('click', () => scheduleRefresh(true, 0));
		}

		const autoInput = section.querySelector('.variable-tracker-auto-input');
		if (autoInput) {
			autoInput.addEventListener('change', () => {
				callModuleAction('set_auto_tracking', { enabled: !!autoInput.checked }).then((result) => {
					if (!result || !result.success) {
						if (typeof window.showToast === 'function') {
							window.showToast((result && result.message) || 'Failed to update auto tracking.', 'error', 1800);
						}
						scheduleRefresh(true, 0);
						return;
					}
					if (typeof window.showToast === 'function') {
						window.showToast(`Auto variable tracking ${autoInput.checked ? 'enabled' : 'disabled'}.`, 'success', 1400);
					}
					renderVariables(result);
				});
			});
		}

		const saveBtn = section.querySelector('.variable-save-btn');
		if (saveBtn) {
			saveBtn.addEventListener('click', () => saveVariable(section));
		}

		const cancelBtn = section.querySelector('.variable-cancel-edit-btn');
		if (cancelBtn) {
			cancelBtn.addEventListener('click', () => clearEditor(section));
		}

		return section;
	}

	function setStatus(text) {
		const section = ensureSection();
		if (!section) {
			return;
		}
		const el = section.querySelector('.variable-tracker-status');
		if (el) {
			el.textContent = `${text || ''}`;
		}
	}

	function typeLabel(value) {
		const t = `${value || ''}`.trim();
		return t || 'string';
	}

	function formatValue(item) {
		const type = `${item.type || ''}`.trim();
		let text = `${item.value ?? ''}`;
		if (type === 'percent' && !text.endsWith('%')) {
			text += '%';
		}
		return text;
	}

	function renderVariables(payload) {
		const section = ensureSection();
		if (!section) {
			return;
		}
		const data = payload && typeof payload === 'object' ? payload : {};
		const list = section.querySelector('.variable-tracker-list');
		const autoInput = section.querySelector('.variable-tracker-auto-input');
		if (!list || !autoInput) {
			return;
		}

		const vars = Array.isArray(data.variables) ? data.variables : [];
		autoInput.checked = !!data.auto_tracking_enabled;

		if (!vars.length) {
			list.innerHTML = '<div class="variable-tracker-empty">No tracked variables yet.</div>';
			setStatus('No variables yet. Add one manually or send a trackable message.');
			bindRowActions(section, []);
			return;
		}

		const rows = vars
			.filter(item => item && typeof item === 'object' && `${item.name || ''}`.trim())
			.sort((a, b) => `${a.name || ''}`.localeCompare(`${b.name || ''}`));

		list.innerHTML = rows.map((item) => {
			const name = `${item.name || ''}`.trim();
			const locked = !!item.locked;
			return '' +
				`<div class="variable-row" data-name="${escapeHtml(name)}">` +
					`<div class="variable-name">${escapeHtml(name)}</div>` +
					`<div class="variable-value">${escapeHtml(formatValue(item))}</div>` +
					`<div class="variable-meta">${escapeHtml(typeLabel(item.type))} · ${escapeHtml(item.scope || 'global')}${item.last_updater ? ` · ${escapeHtml(item.last_updater)}` : ''}${locked ? ' · locked' : ''}</div>` +
					'<div class="variable-row-actions">' +
						'<button type="button" class="btn btn-secondary variable-edit-btn">Edit</button>' +
						`<button type="button" class="btn btn-secondary variable-lock-btn">${locked ? 'Unlock' : 'Lock'}</button>` +
						'<button type="button" class="btn btn-secondary variable-delete-btn">Delete</button>' +
					'</div>' +
				'</div>';
		}).join('');

		setStatus(`Tracked variables: ${rows.length}`);
		bindRowActions(section, rows);
	}

	function bindRowActions(section, rows) {
		const map = new Map();
		(rows || []).forEach((item) => map.set(`${item.name || ''}`, item));

		section.querySelectorAll('.variable-row').forEach((rowEl) => {
			const name = `${rowEl.getAttribute('data-name') || ''}`.trim();
			if (!name) {
				return;
			}
			const current = map.get(name) || null;

			const editBtn = rowEl.querySelector('.variable-edit-btn');
			if (editBtn) {
				editBtn.addEventListener('click', () => fillEditor(section, current));
			}

			const lockBtn = rowEl.querySelector('.variable-lock-btn');
			if (lockBtn) {
				lockBtn.addEventListener('click', () => {
					callModuleAction('set_lock', { name, locked: !(current && current.locked) }).then(handleMutationResult);
				});
			}

			const deleteBtn = rowEl.querySelector('.variable-delete-btn');
			if (deleteBtn) {
				deleteBtn.addEventListener('click', () => {
					if (!confirm(`Delete variable '${name}'?`)) {
						return;
					}
					callModuleAction('delete_variable', { name }).then(handleMutationResult);
				});
			}
		});
	}

	function fillEditor(section, item) {
		if (!section || !item) {
			return;
		}
		editingName = `${item.name || ''}`.trim();
		const nameInput = section.querySelector('.variable-input-name');
		const valueInput = section.querySelector('.variable-input-value');
		const typeInput = section.querySelector('.variable-input-type');
		const scopeInput = section.querySelector('.variable-input-scope');
		const cancelBtn = section.querySelector('.variable-cancel-edit-btn');
		if (nameInput) {
			nameInput.value = editingName;
		}
		if (valueInput) {
			valueInput.value = `${item.value ?? ''}`;
		}
		if (typeInput) {
			typeInput.value = `${item.type || ''}`;
		}
		if (scopeInput) {
			scopeInput.value = `${item.scope || 'global'}`;
		}
		if (cancelBtn) {
			cancelBtn.style.display = '';
		}
	}

	function clearEditor(section) {
		editingName = '';
		const nameInput = section.querySelector('.variable-input-name');
		const valueInput = section.querySelector('.variable-input-value');
		const typeInput = section.querySelector('.variable-input-type');
		const scopeInput = section.querySelector('.variable-input-scope');
		const cancelBtn = section.querySelector('.variable-cancel-edit-btn');
		if (nameInput) {
			nameInput.value = '';
		}
		if (valueInput) {
			valueInput.value = '';
		}
		if (typeInput) {
			typeInput.value = '';
		}
		if (scopeInput) {
			scopeInput.value = 'global';
		}
		if (cancelBtn) {
			cancelBtn.style.display = 'none';
		}
	}

	function saveVariable(section) {
		const nameInput = section.querySelector('.variable-input-name');
		const valueInput = section.querySelector('.variable-input-value');
		const typeInput = section.querySelector('.variable-input-type');
		const scopeInput = section.querySelector('.variable-input-scope');
		const name = `${nameInput ? nameInput.value : ''}`.trim();
		const value = `${valueInput ? valueInput.value : ''}`.trim();
		const type = `${typeInput ? typeInput.value : ''}`.trim();
		const scope = `${scopeInput ? scopeInput.value : 'global'}`.trim();

		if (!name || !value) {
			if (typeof window.showToast === 'function') {
				window.showToast('Variable name and value are required.', 'error', 1600);
			}
			return;
		}

		callModuleAction('upsert', {
			name,
			value,
			type,
			scope,
			source: 'manual',
			force: editingName && editingName === name
		}).then((result) => {
			handleMutationResult(result);
			if (result && result.success) {
				clearEditor(section);
			}
		});
	}

	function maybeToastChanges(context, payload) {
		if (!context || !payload || typeof payload !== 'object') {
			return;
		}
		const meta = (payload._meta && typeof payload._meta === 'object') ? payload._meta : {};
		const changeId = Number.parseInt(meta.last_change_id, 10);
		if (!Number.isFinite(changeId)) {
			return;
		}
		const lastSeen = Number.parseInt(lastChangeByChat.get(context.key), 10);
		if (Number.isFinite(lastSeen) && changeId <= lastSeen) {
			return;
		}
		lastChangeByChat.set(context.key, changeId);

		const changes = Array.isArray(meta.last_changes) ? meta.last_changes : [];
		if (!changes.length || typeof window.showToast !== 'function') {
			return;
		}
		changes.slice(0, 2).forEach((row) => {
			if (!row || typeof row !== 'object') {
				return;
			}
			const action = `${row.action || ''}`.toLowerCase();
			const name = `${row.name || ''}`.trim();
			if (!name || name === 'auto_tracking_enabled') {
				return;
			}
			if (action === 'created') {
				window.showToast(`Variable tracker created variable: ${name}`, 'info', 1600);
			} else if (action === 'deleted') {
				window.showToast(`Variable tracker deleted variable: ${name}`, 'info', 1600);
			} else {
				window.showToast(`Variable tracker updated variable: ${name}`, 'info', 1600);
			}
		});
	}

	function handleMutationResult(result) {
		if (!result || !result.success) {
			if (typeof window.showToast === 'function') {
				window.showToast((result && result.message) || 'Variable action failed.', 'error', 1800);
			}
			scheduleRefresh(true, 0);
			return;
		}
		renderVariables(result);
		const ctx = getContext();
		if (ctx) {
			maybeToastChanges(ctx, result);
		}
	}

	function refreshState(force = false) {
		const section = ensureSection();
		if (!section) {
			return;
		}

		if (refreshInFlight) {
			if (force) {
				scheduleRefresh(true, 150);
			}
			return;
		}

		if (!isModuleEnabled() || !isChatViewActive()) {
			section.style.display = 'none';
			return;
		}
		section.style.display = '';

		const context = getContext();
		if (!context) {
			setStatus('Open a chat to view tracked variables.');
			return;
		}

		const signature = buildMessageSignature();
		const listHost = section.querySelector('.variable-tracker-list');
		const hasRenderedState = !!(listHost && listHost.childElementCount > 0);
		if (!force && hasRenderedState && context.key === lastFetchedChatKey && signature === lastFetchedSignature) {
			return;
		}

		refreshInFlight = true;

		callModuleAction('list')
			.then((payload) => {
				if (!payload || !payload.success) {
					throw new Error((payload && payload.message) || 'list failed');
				}
				lastFetchedChatKey = context.key;
				lastFetchedSignature = signature;
				renderVariables(payload);
				maybeToastChanges(context, payload);
			})
			.catch(() => {
				renderVariables({ success: true, variables: [], auto_tracking_enabled: true, _meta: {} });
				setStatus('Variable tracker API unavailable for this chat.');
			})
			.finally(() => {
				refreshInFlight = false;
			});
	}

	function installHooks() {
		if (hooksInstalled) {
			return;
		}
		hooksInstalled = true;

		if (typeof window.updateBotPanel === 'function') {
			const originalUpdateBotPanel = window.updateBotPanel;
			window.updateBotPanel = function () {
				const result = originalUpdateBotPanel.apply(this, arguments);
				scheduleRefresh(false, 250);
				return result;
			};
		}

		if (typeof window.renderCurrentChat === 'function') {
			const originalRenderCurrentChat = window.renderCurrentChat;
			window.renderCurrentChat = function () {
				const result = originalRenderCurrentChat.apply(this, arguments);
				scheduleRefresh(false, 260);
				return result;
			};
		}

		if (typeof window.showView === 'function') {
			const originalShowView = window.showView;
			window.showView = function () {
				const result = originalShowView.apply(this, arguments);
				scheduleRefresh(false, 280);
				return result;
			};
		}
	}

	function init() {
		installHooks();
		scheduleRefresh(false, 180);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
