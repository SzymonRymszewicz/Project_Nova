(function () {
	'use strict';

	if (window.__recursiveValidatorModule && window.__recursiveValidatorModule.initialized) {
		return;
	}
	window.__recursiveValidatorModule = window.__recursiveValidatorModule || { initialized: false };
	window.__recursiveValidatorModule.initialized = true;

	const MODULE_NAME = 'Recursive Validator';
	const STATUS_TEXT = 'Validating';
	const POLL_MS = 700;
	const CRITERIA_KEY = 'criteria_json';
	const DEFAULT_CRITERIA = [
		{ text: "Addresses the user's latest request directly.", enabled: true, hard_fail: true },
		{ text: 'Stays consistent with bot core definition and scenario rules.', enabled: true, hard_fail: true },
		{ text: 'Is clear, coherent, and useful for the current turn.', enabled: true, hard_fail: false }
	];

	let pollTimer = null;
	let lastStatusSignature = '';

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
		return { botName, chatId };
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

	function setProcessingBanner(visible, text = STATUS_TEXT, thinkingOutput = '') {
		if (typeof window.novaSetModuleProcessingPlaceholder === 'function') {
			window.novaSetModuleProcessingPlaceholder(MODULE_NAME, !!visible, text || STATUS_TEXT, {
				thinkingOutput: `${thinkingOutput || ''}`
			});
		}
	}

	function pollStatus() {
		const ctx = getContext();
		if (!ctx || !isModuleEnabled()) {
			setProcessingBanner(false);
			lastStatusSignature = '';
			return;
		}

		callModuleAction('status')
			.then((result) => {
				if (!result || !result.success) {
					setProcessingBanner(false);
					lastStatusSignature = '';
					return;
				}
				const processing = !!result.processing;
				const message = `${result.message || STATUS_TEXT}`;
				const thinkingOutput = `${result.thinking_output || ''}`;
				const statusSignature = JSON.stringify({ processing, message, thinkingOutput });
				if (statusSignature === lastStatusSignature) {
					return;
				}
				lastStatusSignature = statusSignature;
				setProcessingBanner(processing, message, thinkingOutput);
			})
			.catch(() => {
				setProcessingBanner(false);
				lastStatusSignature = '';
			});
	}

	function parseCriteria(raw) {
		const text = `${raw || ''}`.trim();
		if (!text) {
			return [];
		}
		try {
			const parsed = JSON.parse(text);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed
				.map((item) => {
					if (!item || typeof item !== 'object') {
						return null;
					}
					const row = {
						text: `${item.text || item.criterion || ''}`.trim(),
						enabled: item.enabled !== false,
						hard_fail: !!item.hard_fail
					};
					return row.text ? row : null;
				})
				.filter(Boolean)
				.slice(0, 12);
		} catch (_error) {
			return text
				.split(/\r?\n/)
				.map(line => line.trim())
				.filter(Boolean)
				.map(line => ({ text: line.replace(/^[-*]\s*/, '').trim(), enabled: true, hard_fail: false }))
				.filter(item => item.text)
				.slice(0, 12);
		}
	}

	function serializeCriteria(criteria) {
		const rows = Array.isArray(criteria)
			? criteria
				.map((item) => ({
					text: `${item && item.text ? item.text : ''}`.trim(),
					enabled: item ? item.enabled !== false : true,
					hard_fail: !!(item && item.hard_fail)
				}))
				.filter(item => item.text)
				.slice(0, 12)
			: [];
		return JSON.stringify(rows);
	}

	function escapeHtml(value) {
		return `${value || ''}`
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	function renderCriteriaEditor(hiddenInput, mountEl) {
		const readCriteria = () => parseCriteria(hiddenInput.value);
		const writeCriteria = (criteria) => {
			hiddenInput.value = serializeCriteria(criteria);
			hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
		};

		const repaint = () => {
			let criteria = readCriteria();
			if (!criteria.length) {
				criteria = DEFAULT_CRITERIA.map(item => ({ ...item }));
				writeCriteria(criteria);
			}

			mountEl.innerHTML = '' +
				'<div class="recursive-validator-criteria-list">' +
				criteria.map((criterion, index) => {
					return '' +
						'<div class="recursive-validator-criterion-row">' +
							`<div class="recursive-validator-criterion-text">${escapeHtml(criterion.text)}</div>` +
							'<div class="recursive-validator-criterion-flags">' +
								`<label><input type="checkbox" class="recursive-validator-flag" data-flag="enabled" data-index="${index}" ${criterion.enabled ? 'checked' : ''}> enabled</label>` +
								`<label><input type="checkbox" class="recursive-validator-flag" data-flag="hard_fail" data-index="${index}" ${criterion.hard_fail ? 'checked' : ''}> hard fail</label>` +
							'</div>' +
							'<div class="recursive-validator-criterion-actions">' +
								`<button type="button" class="action-btn cancel-btn recursive-validator-btn" data-action="up" data-index="${index}">↑</button>` +
								`<button type="button" class="action-btn cancel-btn recursive-validator-btn" data-action="down" data-index="${index}">↓</button>` +
								`<button type="button" class="action-btn recursive-validator-btn" data-action="edit" data-index="${index}">Edit</button>` +
								`<button type="button" class="action-btn delete-btn recursive-validator-btn" data-action="delete" data-index="${index}">Delete</button>` +
							'</div>' +
						'</div>';
				}).join('') +
				'</div>' +
				'<button type="button" class="action-btn recursive-validator-add">Add Criterion</button>';
		};

		mountEl.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}

			if (target.classList.contains('recursive-validator-add')) {
				const value = window.prompt('New validator criterion:');
				if (value === null) {
					return;
				}
				const text = `${value || ''}`.trim();
				if (!text) {
					return;
				}
				const criteria = readCriteria();
				criteria.push({ text, enabled: true, hard_fail: false });
				writeCriteria(criteria);
				repaint();
				return;
			}

			if (!target.classList.contains('recursive-validator-btn')) {
				return;
			}

			const action = `${target.dataset.action || ''}`;
			const index = Number.parseInt(`${target.dataset.index || ''}`, 10);
			if (!Number.isInteger(index)) {
				return;
			}

			const criteria = readCriteria();
			if (index < 0 || index >= criteria.length) {
				return;
			}

			if (action === 'up' && index > 0) {
				[criteria[index - 1], criteria[index]] = [criteria[index], criteria[index - 1]];
				writeCriteria(criteria);
				repaint();
				return;
			}
			if (action === 'down' && index < criteria.length - 1) {
				[criteria[index + 1], criteria[index]] = [criteria[index], criteria[index + 1]];
				writeCriteria(criteria);
				repaint();
				return;
			}
			if (action === 'edit') {
				const value = window.prompt('Edit criterion:', criteria[index].text);
				if (value === null) {
					return;
				}
				const text = `${value || ''}`.trim();
				if (!text) {
					return;
				}
				criteria[index].text = text;
				writeCriteria(criteria);
				repaint();
				return;
			}
			if (action === 'delete') {
				criteria.splice(index, 1);
				writeCriteria(criteria);
				repaint();
			}
		});

		mountEl.addEventListener('change', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement)) {
				return;
			}
			if (!target.classList.contains('recursive-validator-flag')) {
				return;
			}
			const index = Number.parseInt(`${target.dataset.index || ''}`, 10);
			const flag = `${target.dataset.flag || ''}`;
			if (!Number.isInteger(index) || (flag !== 'enabled' && flag !== 'hard_fail')) {
				return;
			}
			const criteria = readCriteria();
			if (index < 0 || index >= criteria.length) {
				return;
			}
			criteria[index][flag] = !!target.checked;
			writeCriteria(criteria);
		});

		repaint();
	}

	function enhanceCriteriaSettingsEditor() {
		document.querySelectorAll(`.module-setting-input[data-setting-key="${CRITERIA_KEY}"]`).forEach((input) => {
			if (!(input instanceof HTMLInputElement)) {
				return;
			}
			if (input.dataset.recursiveValidatorEnhanced === '1') {
				return;
			}

			const moduleName = `${input.getAttribute('data-module-name') || ''}`.trim();
			if (normalizeName(moduleName) !== normalizeName(MODULE_NAME)) {
				return;
			}

			input.dataset.recursiveValidatorEnhanced = '1';
			const formGroup = input.closest('.form-group');
			if (!formGroup) {
				return;
			}
			const label = formGroup.querySelector('label');
			if (label) {
				label.textContent = 'Validation Criteria';
			}

			input.style.display = 'none';
			const mount = document.createElement('div');
			mount.className = 'recursive-validator-criteria-editor';
			formGroup.appendChild(mount);
			renderCriteriaEditor(input, mount);
		});
	}

	function startPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
		}
		pollTimer = window.setInterval(() => {
			pollStatus();
			enhanceCriteriaSettingsEditor();
		}, POLL_MS);
		pollStatus();
		enhanceCriteriaSettingsEditor();
	}

	function installHooks() {
		const originalRenderCurrentChat = window.renderCurrentChat;
		if (typeof originalRenderCurrentChat === 'function' && !window.__recursiveValidatorRenderPatched) {
			window.__recursiveValidatorRenderPatched = true;
			window.renderCurrentChat = function () {
				const result = originalRenderCurrentChat.apply(this, arguments);
				enhanceCriteriaSettingsEditor();
				return result;
			};
		}

		const originalSendMessage = window.sendMessage;
		if (typeof originalSendMessage === 'function' && !window.__recursiveValidatorSendPatched) {
			window.__recursiveValidatorSendPatched = true;
			window.sendMessage = function () {
				if (isModuleEnabled() && getContext()) {
					window.setTimeout(() => pollStatus(), 30);
					window.setTimeout(() => pollStatus(), 110);
					window.setTimeout(() => pollStatus(), 240);
					window.setTimeout(() => pollStatus(), 500);
				}
				return originalSendMessage.apply(this, arguments);
			};
		}

		const originalRunChatMessageAction = window.runChatMessageAction;
		if (typeof originalRunChatMessageAction === 'function' && !window.__recursiveValidatorActionPatched) {
			window.__recursiveValidatorActionPatched = true;
			window.runChatMessageAction = function (action) {
				const actionName = `${action || ''}`.trim().toLowerCase();
				const shouldTrack = actionName === 'regenerate_message' || actionName === 'continue_message';
				if (shouldTrack && isModuleEnabled() && getContext()) {
					window.setTimeout(() => pollStatus(), 30);
					window.setTimeout(() => pollStatus(), 120);
					window.setTimeout(() => pollStatus(), 260);
					window.setTimeout(() => pollStatus(), 500);
				}
				const result = originalRunChatMessageAction.apply(this, arguments);
				if (shouldTrack && result && typeof result.finally === 'function') {
					result.finally(() => window.setTimeout(() => pollStatus(), 120));
				}
				return result;
			};
		}

		window.addEventListener('nova:settings-updated', () => {
			enhanceCriteriaSettingsEditor();
			pollStatus();
		});

		document.addEventListener('click', () => {
			window.setTimeout(() => enhanceCriteriaSettingsEditor(), 0);
		}, true);
	}

	function init() {
		installHooks();
		startPolling();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
