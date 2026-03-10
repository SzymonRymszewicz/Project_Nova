(function () {
	'use strict';

	if (window.__reasoningModule && window.__reasoningModule.initialized) {
		return;
	}
	window.__reasoningModule = window.__reasoningModule || { initialized: false };
	window.__reasoningModule.initialized = true;

	const MODULE_NAME = 'Reasoning';
	const STATUS_TEXT = 'Reasoning';
	const POLL_MS = 700;
	const QUESTIONS_KEY = 'reasoning_questions_json';
	const DEFAULT_QUESTIONS = [
		'What does the user want right now?',
		'What does the user likely expect from me next?',
		'What response strategy best satisfies that while respecting core/scenario?'
	];

	let pollTimer = null;
	let bannerHoldUntilMs = 0;
	let lastStatusSignature = '';
	let lastProcessing = false;
	let outputHoldUntilMs = 0;

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

	function ensureStatusBanner() {
		let banner = document.getElementById('reasoning-status-banner');
		if (banner) {
			return banner;
		}
		const inputArea = document.getElementById('inputArea');
		if (!inputArea) {
			return null;
		}
		banner = document.createElement('div');
		banner.id = 'reasoning-status-banner';
		banner.className = 'reasoning-status-banner';
		banner.textContent = STATUS_TEXT;
		banner.style.display = 'none';
		inputArea.prepend(banner);
		return banner;
	}

	function setProcessingBanner(visible, text = STATUS_TEXT, thinkingOutput = '') {
		if (typeof window.novaSetModuleProcessingPlaceholder === 'function') {
			window.novaSetModuleProcessingPlaceholder(MODULE_NAME, !!visible, text || STATUS_TEXT, {
				thinkingOutput: `${thinkingOutput || ''}`
			});
		}
		const banner = document.getElementById('reasoning-status-banner');
		if (!banner) {
			return;
		}
		banner.style.display = 'none';
		const now = Date.now();
		if (visible) {
			bannerHoldUntilMs = now + 550;
		} else if (now < bannerHoldUntilMs) {
			window.setTimeout(() => setProcessingBanner(false, text), Math.max(0, bannerHoldUntilMs - now));
			return;
		}
		banner.textContent = text || STATUS_TEXT;
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
					lastProcessing = false;
					outputHoldUntilMs = 0;
					return;
				}
				const now = Date.now();
				const isProcessing = !!result.processing;
				const thinkingOutput = `${result.thinking_output || ''}`;
				const hasThinkingOutput = !!thinkingOutput.trim();

				if (isProcessing) {
					outputHoldUntilMs = 0;
				} else if (hasThinkingOutput && (!outputHoldUntilMs || lastProcessing)) {
					outputHoldUntilMs = now + 1800;
				}

				// Turn-aware behavior: show "Reasoning" only while module work is in progress.
				// Once reasoning finishes, hide module placeholder so chat falls back to "Thinking"
				// for the assistant response generation phase.
				const keepVisible = isProcessing;
				const statusSignature = JSON.stringify({
					processing: isProcessing,
					message: `${result.message || STATUS_TEXT}`,
					thinkingOutput,
					keepVisible,
				});
				lastProcessing = isProcessing;
				if (statusSignature === lastStatusSignature) {
					return;
				}
				lastStatusSignature = statusSignature;
				setProcessingBanner(keepVisible, `${result.message || STATUS_TEXT}`, thinkingOutput);
			})
			.catch(() => {
				setProcessingBanner(false);
				lastStatusSignature = '';
				lastProcessing = false;
				outputHoldUntilMs = 0;
			});
	}

	function parseQuestions(raw) {
		const text = `${raw || ''}`.trim();
		if (!text) {
			return [];
		}
		if (text === '[' || text === ']') {
			return [];
		}
		if (text.startsWith('[') && !text.includes(']')) {
			return [];
		}
		try {
			const parsed = JSON.parse(text);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed
				.map(item => `${item || ''}`.trim())
				.filter(Boolean)
				.slice(0, 10);
		} catch (_error) {
			const lines = text
				.split(/\r?\n/)
				.map(item => item.trim())
				.filter(item => item && item !== '[' && item !== ']')
				.map(item => item.replace(/^['"]+|['"],?$/g, '').trim())
				.filter(Boolean)
				.slice(0, 10);
			return lines;
		}
	}

	function serializeQuestions(questions) {
		const normalized = Array.isArray(questions)
			? questions.map(item => `${item || ''}`.trim()).filter(Boolean).slice(0, 10)
			: [];
		return JSON.stringify(normalized);
	}

	function renderQuestionsEditor(hiddenInput, mountEl) {
		const readQuestions = () => parseQuestions(hiddenInput.value);
		const writeQuestions = (questions) => {
			hiddenInput.value = serializeQuestions(questions);
			hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
		};

		const repaint = () => {
			let questions = readQuestions();
			if (!questions.length) {
				questions = [...DEFAULT_QUESTIONS];
				writeQuestions(questions);
			}
			if (!questions.length) {
				mountEl.innerHTML = '<div class="reasoning-questions-empty">No questions configured.</div><button type="button" class="action-btn reasoning-q-add">Add Question</button>';
			} else {
				mountEl.innerHTML = '' +
					'<div class="reasoning-questions-list">' +
					questions.map((question, index) => {
						return '' +
							'<div class="reasoning-question-row">' +
								`<div class="reasoning-question-text">${escapeHtml(question)}</div>` +
								'<div class="reasoning-question-actions">' +
									`<button type="button" class="action-btn cancel-btn reasoning-q-btn" data-action="up" data-index="${index}">↑</button>` +
									`<button type="button" class="action-btn cancel-btn reasoning-q-btn" data-action="down" data-index="${index}">↓</button>` +
									`<button type="button" class="action-btn reasoning-q-btn" data-action="edit" data-index="${index}">Edit</button>` +
									`<button type="button" class="action-btn delete-btn reasoning-q-btn" data-action="delete" data-index="${index}">Delete</button>` +
								'</div>' +
							'</div>';
					}).join('') +
					'</div>' +
					'<button type="button" class="action-btn reasoning-q-add">Add Question</button>';
			}
		};

		mountEl.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}

			if (target.classList.contains('reasoning-q-add')) {
				const next = window.prompt('New reasoning question:');
				if (next === null) {
					return;
				}
				const value = `${next || ''}`.trim();
				if (!value) {
					return;
				}
				const questions = readQuestions();
				questions.push(value);
				writeQuestions(questions);
				repaint();
				return;
			}

			if (!target.classList.contains('reasoning-q-btn')) {
				return;
			}

			const action = `${target.dataset.action || ''}`.trim();
			const index = Number.parseInt(`${target.dataset.index || ''}`, 10);
			if (!Number.isInteger(index)) {
				return;
			}

			const questions = readQuestions();
			if (index < 0 || index >= questions.length) {
				return;
			}

			if (action === 'up' && index > 0) {
				[questions[index - 1], questions[index]] = [questions[index], questions[index - 1]];
				writeQuestions(questions);
				repaint();
				return;
			}
			if (action === 'down' && index < questions.length - 1) {
				[questions[index + 1], questions[index]] = [questions[index], questions[index + 1]];
				writeQuestions(questions);
				repaint();
				return;
			}
			if (action === 'edit') {
				const next = window.prompt('Edit reasoning question:', questions[index]);
				if (next === null) {
					return;
				}
				const value = `${next || ''}`.trim();
				if (!value) {
					return;
				}
				questions[index] = value;
				writeQuestions(questions);
				repaint();
				return;
			}
			if (action === 'delete') {
				questions.splice(index, 1);
				writeQuestions(questions);
				repaint();
			}
		});

		repaint();
	}

	function enhanceReasoningSettingsEditors() {
		document.querySelectorAll('.module-setting-input[data-setting-key="reasoning_questions_json"]').forEach((input) => {
			if (!(input instanceof HTMLInputElement)) {
				return;
			}
			if (input.dataset.reasoningEnhanced === '1') {
				return;
			}
			const moduleName = `${input.getAttribute('data-module-name') || ''}`.trim();
			if (normalizeName(moduleName) !== normalizeName(MODULE_NAME)) {
				return;
			}

			input.dataset.reasoningEnhanced = '1';
			const formGroup = input.closest('.form-group');
			if (!formGroup) {
				return;
			}
			const label = formGroup.querySelector('label');
			if (label) {
				label.textContent = 'Reasoning Questions';
			}

			input.style.display = 'none';
			const mount = document.createElement('div');
			mount.className = 'reasoning-questions-editor';
			formGroup.appendChild(mount);
			renderQuestionsEditor(input, mount);
		});
	}

	function escapeHtml(value) {
		return `${value || ''}`
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	function startPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
		}
		pollTimer = window.setInterval(() => {
			pollStatus();
			enhanceReasoningSettingsEditors();
		}, POLL_MS);
		pollStatus();
		enhanceReasoningSettingsEditors();
	}

	function installHooks() {
		const originalRenderCurrentChat = window.renderCurrentChat;
		if (typeof originalRenderCurrentChat === 'function' && !window.__reasoningRenderPatched) {
			window.__reasoningRenderPatched = true;
			window.renderCurrentChat = function () {
				const output = originalRenderCurrentChat.apply(this, arguments);
				enhanceReasoningSettingsEditors();
				return output;
			};
		}

		const originalSendMessage = window.sendMessage;
		if (typeof originalSendMessage === 'function' && !window.__reasoningSendPatched) {
			window.__reasoningSendPatched = true;
			window.sendMessage = function () {
				if (isModuleEnabled() && getContext()) {
					window.setTimeout(() => pollStatus(), 40);
					window.setTimeout(() => pollStatus(), 120);
					window.setTimeout(() => pollStatus(), 260);
					window.setTimeout(() => pollStatus(), 520);
				}
				return originalSendMessage.apply(this, arguments);
			};
		}

		const originalRunChatMessageAction = window.runChatMessageAction;
		if (typeof originalRunChatMessageAction === 'function' && !window.__reasoningChatActionPatched) {
			window.__reasoningChatActionPatched = true;
			window.runChatMessageAction = function (action) {
				const actionName = `${action || ''}`.trim().toLowerCase();
				const shouldTrack = actionName === 'regenerate_message' || actionName === 'continue_message';
				if (shouldTrack && isModuleEnabled() && getContext()) {
					window.setTimeout(() => pollStatus(), 30);
					window.setTimeout(() => pollStatus(), 120);
					window.setTimeout(() => pollStatus(), 260);
					window.setTimeout(() => pollStatus(), 520);
				}
				const result = originalRunChatMessageAction.apply(this, arguments);
				if (shouldTrack && result && typeof result.finally === 'function') {
					result.finally(() => {
						window.setTimeout(() => pollStatus(), 120);
					});
				}
				return result;
			};
		}

		window.addEventListener('nova:settings-updated', () => {
			pollStatus();
			enhanceReasoningSettingsEditors();
		});

		document.addEventListener('click', () => {
			window.setTimeout(() => enhanceReasoningSettingsEditors(), 0);
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
