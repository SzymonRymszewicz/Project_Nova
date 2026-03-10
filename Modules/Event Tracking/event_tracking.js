(function () {
	'use strict';

	if (window.__eventTrackingModule && window.__eventTrackingModule.initialized) {
		return;
	}
	window.__eventTrackingModule = window.__eventTrackingModule || { initialized: false };
	window.__eventTrackingModule.initialized = true;

	const MODULE_NAME = 'Event Tracking';
	const STATUS_TEXT = 'Keeping a track on things';
	const POLL_MS = 1200;

	let pollTimer = null;
	let lastChatEventByKey = new Map();
	let lastEventsById = new Map();
	let applyingAutoToggleState = false;
	let forceThinkingId = '';
	let forceRunInFlight = false;

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
		let banner = document.getElementById('event-tracking-status-banner');
		if (banner) {
			return banner;
		}
		const inputArea = document.getElementById('inputArea');
		if (!inputArea) {
			return null;
		}
		banner = document.createElement('div');
		banner.id = 'event-tracking-status-banner';
		banner.className = 'event-tracking-status-banner';
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
		const banner = document.getElementById('event-tracking-status-banner');
		if (!banner) {
			return;
		}
		banner.style.display = 'none';
		banner.textContent = text || STATUS_TEXT;
	}

	function removeForceThinkingBubble(render = true) {
		const rows = Array.isArray(window.currentChatMessages) ? window.currentChatMessages : null;
		if (!rows || !rows.length) {
			forceThinkingId = '';
			return;
		}
		let removed = false;
		for (let index = rows.length - 1; index >= 0; index -= 1) {
			const item = rows[index];
			if (!item || typeof item !== 'object') {
				continue;
			}

			const idMatches = forceThinkingId && `${item.id || ''}` === `${forceThinkingId}`;
			const explicitMarker = item.event_tracking_force_thinking === true;
			const moduleMarker = item.thinking === true
				&& normalizeName(item.thinking_module_name || item.thinking_module_key) === normalizeName(MODULE_NAME)
				&& normalizeName(item.content || '').startsWith(normalizeName(STATUS_TEXT));

			if (!idMatches && !explicitMarker && !moduleMarker) {
				continue;
			}

			rows.splice(index, 1);
			removed = true;
		}

		if (!removed) {
			forceThinkingId = '';
			return;
		}
		forceThinkingId = '';
		if (render && typeof window.renderCurrentChat === 'function') {
			window.renderCurrentChat();
		}
	}

	function showForceThinkingBubble(text = STATUS_TEXT, thinkingOutput = 'Tracking recent messages for timeline continuity...') {
		const chatId = `${window.currentChatId || ''}`.trim();
		if (!chatId) {
			return;
		}
		const rows = Array.isArray(window.currentChatMessages) ? window.currentChatMessages : null;
		if (!rows) {
			return;
		}

		const existing = rows.find(item => item && item.event_tracking_force_thinking === true);
		if (existing) {
			existing.content = `${text || STATUS_TEXT}`;
			existing.thinking = true;
			existing.thinking_module_name = MODULE_NAME;
			existing.thinking_module_key = normalizeName(MODULE_NAME);
			existing.thinking_output = `${thinkingOutput || ''}`;
			if (typeof window.renderCurrentChat === 'function') {
				window.renderCurrentChat();
			}
			return;
		}

		forceThinkingId = `event_tracking_force_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
		rows.push({
			id: forceThinkingId,
			role: 'assistant',
			content: `${text || STATUS_TEXT}`,
			timestamp: new Date().toISOString(),
			thinking: true,
			thinking_module_name: MODULE_NAME,
			thinking_module_key: normalizeName(MODULE_NAME),
			thinking_output: `${thinkingOutput || ''}`,
			event_tracking_force_thinking: true,
		});
		if (typeof window.renderCurrentChat === 'function') {
			window.renderCurrentChat();
		}
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
		let section = host.querySelector('.bot-panel-group.bot-panel-event-tracking-group');
		if (section) {
			return section;
		}

		section = document.createElement('div');
		section.className = 'bot-panel-group bot-panel-event-tracking-group';
		section.innerHTML = '' +
			'<h3>Event Timeline</h3>' +
			'<div class="event-tracking-auto-row">' +
				'<label class="setting-label setting-label-row event-tracking-auto-label" title="When disabled, events are created only manually.">' +
					'<span>Enable auto event creation?</span>' +
					'<input type="checkbox" class="event-tracking-auto-checkbox" checked>' +
				'</label>' +
			'</div>' +
				'<div class="event-tracking-toolbar">' +
					'<button type="button" class="btn btn-secondary event-tracking-btn event-tracking-refresh-btn">Refresh</button>' +
					'<button type="button" class="btn btn-secondary event-tracking-btn event-tracking-force-btn">Force Event Pass</button>' +
					'<button type="button" class="btn btn-secondary event-tracking-btn event-tracking-create-btn">New Event</button>' +
				'</div>' +
				'<div class="event-tracking-status"></div>' +
				'<div class="event-tracking-list"></div>';

		host.appendChild(section);

		if (typeof window.makeSectionsCollapsible === 'function') {
			window.makeSectionsCollapsible(host, '.bot-panel-event-tracking-group', 'chat-generation-panel');
		}

		const refreshBtn = section.querySelector('.event-tracking-refresh-btn');
		if (refreshBtn) {
			refreshBtn.addEventListener('click', () => pollStatus(true));
		}

		const forceBtn = section.querySelector('.event-tracking-force-btn');
		if (forceBtn) {
			forceBtn.addEventListener('click', () => {
				forceBtn.disabled = true;
				forceRunInFlight = true;
				showForceThinkingBubble(STATUS_TEXT, 'Keeping track on things...');
				callModuleAction('force_run')
					.then((result) => {
						renderStatus(result, true);
						removeForceThinkingBubble(true);
					})
					.catch(() => {
						setProcessingBanner(false);
						removeForceThinkingBubble(true);
					})
					.finally(() => {
						forceRunInFlight = false;
						setProcessingBanner(false);
						removeForceThinkingBubble(true);
						forceBtn.disabled = false;
					});
			});
		}

		const autoCheckbox = section.querySelector('.event-tracking-auto-checkbox');
		if (autoCheckbox) {
			autoCheckbox.addEventListener('change', () => {
				if (applyingAutoToggleState) {
					return;
				}
				autoCheckbox.disabled = true;
				callModuleAction('set_auto_creation', { enabled: !!autoCheckbox.checked })
					.then((result) => {
						if (result && result.success) {
							renderStatus(result, true);
							if (typeof window.showToast === 'function') {
								window.showToast(autoCheckbox.checked ? 'Auto event creation enabled.' : 'Auto event creation disabled.', 'success', 1200);
							}
						} else {
							autoCheckbox.checked = !autoCheckbox.checked;
						}
					})
					.catch(() => {
						autoCheckbox.checked = !autoCheckbox.checked;
					})
					.finally(() => {
						autoCheckbox.disabled = false;
					});
			});
		}

		const createBtn = section.querySelector('.event-tracking-create-btn');
		if (createBtn) {
			createBtn.addEventListener('click', () => {
				const payload = openEventEditor(null);
				if (!payload) {
					return;
				}
				createBtn.disabled = true;
				callModuleAction('create_event', payload)
					.then((result) => renderStatus(result, true))
					.catch(() => {})
					.finally(() => {
						createBtn.disabled = false;
					});
			});
		}

		const list = section.querySelector('.event-tracking-list');
		if (list) {
			list.addEventListener('click', (event) => {
				const target = event.target;
				if (!(target instanceof HTMLElement)) {
					return;
				}
				const action = `${target.dataset.action || ''}`.trim();
				const eventId = `${target.dataset.eventId || ''}`.trim();
				if (!action || !eventId) {
					return;
				}
				if (action === 'edit') {
					const existing = lastEventsById.get(eventId) || null;
					const payload = openEventEditor(existing);
					if (!payload) {
						return;
					}
					target.disabled = true;
					callModuleAction('update_event', { ...payload, event_id: eventId })
						.then((result) => renderStatus(result, true))
						.catch(() => {})
						.finally(() => {
							target.disabled = false;
						});
					return;
				}

				if (action === 'delete') {
					const ok = window.confirm(`Delete ${eventId}?`);
					if (!ok) {
						return;
					}
					target.disabled = true;
					callModuleAction('delete_event', { event_id: eventId })
						.then((result) => renderStatus(result, true))
						.catch(() => {})
						.finally(() => {
							target.disabled = false;
						});
				}
			});
		}

		return section;
	}

	function openEventEditor(existing) {
		const eventData = (existing && typeof existing === 'object') ? existing : {};
		const range = (eventData.range && typeof eventData.range === 'object') ? eventData.range : {};
		const timelineSummarySeed = `${eventData.timeline_summary || eventData.summary || eventData.what_was_going_on || eventData.key_outcome || ''}`.trim();
		const timelineSummary = window.prompt('Detailed timeline summary:', timelineSummarySeed);
		if (timelineSummary === null) {
			return null;
		}

		const fromInput = window.prompt('Range from index:', `${Number.isInteger(range.from_index) ? range.from_index : 0}`);
		if (fromInput === null) {
			return null;
		}
		const toInput = window.prompt('Range to index:', `${Number.isInteger(range.to_index) ? range.to_index : 0}`);
		if (toInput === null) {
			return null;
		}
		const tagsInput = window.prompt('Priority tags (comma-separated: critical, relationship, location, objective):', `${Array.isArray(eventData.priority_tags) ? eventData.priority_tags.join(', ') : ''}`);
		if (tagsInput === null) {
			return null;
		}
		const relevanceInput = window.prompt('Relevance score (0..1):', `${typeof eventData.relevance_score === 'number' ? eventData.relevance_score : 0.6}`);
		if (relevanceInput === null) {
			return null;
		}

		const fromIndex = Number.parseInt(`${fromInput}`.trim(), 10);
		const toIndex = Number.parseInt(`${toInput}`.trim(), 10);
		const relevanceScore = Number.parseFloat(`${relevanceInput}`.trim());
		const tags = `${tagsInput || ''}`
			.split(',')
			.map(item => `${item || ''}`.trim().toLowerCase())
			.filter(Boolean);

		return {
			timeline_summary: `${timelineSummary || ''}`.trim(),
			from_index: Number.isFinite(fromIndex) ? fromIndex : 0,
			to_index: Number.isFinite(toIndex) ? toIndex : 0,
			priority_tags: tags,
			relevance_score: Number.isFinite(relevanceScore) ? relevanceScore : 0.6,
		};
	}

	function renderEventRows(events) {
		const section = ensureSection();
		if (!section) {
			return;
		}
		const list = section.querySelector('.event-tracking-list');
		if (!list) {
			return;
		}

		const rows = Array.isArray(events) ? events : [];
		lastEventsById = new Map();
		if (!rows.length) {
			list.innerHTML = '<div class="event-tracking-empty">No timeline events yet.</div>';
			return;
		}

		const html = rows
			.slice()
			.reverse()
			.map((item) => {
				const id = escapeHtml(`${(item && item.id) || ''}`);
				const idRaw = `${(item && item.id) || ''}`.trim();
				if (idRaw) {
					lastEventsById.set(idRaw, item);
				}
				const range = (item && item.range && typeof item.range === 'object') ? item.range : {};
				const from = Number.isInteger(range.from_index) ? range.from_index : '-';
				const to = Number.isInteger(range.to_index) ? range.to_index : '-';
				const tags = Array.isArray(item && item.priority_tags) ? item.priority_tags : [];
				const tagText = tags.length ? escapeHtml(tags.join(' · ')) : '';
				const relevanceScore = Number.parseFloat(item && item.relevance_score);
				const relevance = Number.isFinite(relevanceScore) ? `${Math.round(Math.max(0, Math.min(1, relevanceScore)) * 100)}%` : '';
				const outcome = escapeHtml(`${(item && item.timeline_summary) || (item && item.key_outcome) || (item && item.summary) || ''}`);
				const createdAt = escapeHtml(`${(item && item.created_at) || ''}`);
				return '' +
					'<div class="event-row">' +
						`<div class="event-row-head"><span class="event-row-id">${id}</span><span class="event-row-range">${from}..${to}</span></div>` +
						(tagText || relevance ? `<div class="event-row-meta">${tagText}${tagText && relevance ? ' · ' : ''}${relevance ? `relevance ${relevance}` : ''}</div>` : '') +
						`<div class="event-row-outcome">${outcome}</div>` +
						`<div class="event-row-time">${createdAt}</div>` +
						`<div class="event-row-actions"><button type="button" class="btn btn-secondary event-row-btn" data-action="edit" data-event-id="${id}">Edit</button><button type="button" class="btn btn-secondary event-row-btn" data-action="delete" data-event-id="${id}">Delete</button></div>` +
					'</div>';
			})
			.join('');
		list.innerHTML = html;
	}

	function renderStatus(payload, allowToast = false) {
		const section = ensureSection();
		if (!section) {
			return;
		}
		const statusEl = section.querySelector('.event-tracking-status');
		const data = (payload && typeof payload === 'object') ? payload : {};
		const processing = !!data.processing;
		const statusText = `${data.message || STATUS_TEXT}`;
		const thinkingOutput = `${data.thinking_output || ''}`;
		// Turn-aware behavior: module placeholder is visible only while module work is active.
		// After processing ends, chat placeholder naturally falls back to "Thinking".
		const keepVisible = processing;
		setProcessingBanner(keepVisible, statusText, thinkingOutput);
		if (forceRunInFlight && processing) {
			showForceThinkingBubble(statusText, thinkingOutput || 'Keeping track on things...');
		} else {
			removeForceThinkingBubble(false);
		}
		const autoEnabled = !!data.auto_event_creation_enabled;
		const autoCheckbox = section.querySelector('.event-tracking-auto-checkbox');
		if (autoCheckbox) {
			applyingAutoToggleState = true;
			autoCheckbox.checked = autoEnabled;
			applyingAutoToggleState = false;
		}

		const total = Number.parseInt(data.total_events, 10);
		const createdCount = Number.parseInt(data.created_count, 10) || 0;
		const llmCalls = Number.parseInt(data.llm_calls, 10) || 0;
		const fallbackCalls = Number.parseInt(data.fallback_calls, 10) || 0;
		if (statusEl) {
			statusEl.textContent = Number.isFinite(total)
				? `Events: ${total}${processing ? ' · processing...' : ''}${llmCalls || fallbackCalls ? ` · llm:${llmCalls} fallback:${fallbackCalls}` : ''}${!autoEnabled ? ' · auto off' : ''}`
				: (processing ? 'Processing events...' : 'Event timeline ready.');
		}

		renderEventRows(Array.isArray(data.all_events) ? data.all_events : data.events);

		if (allowToast) {
			const ctx = getContext();
			const lastEventId = `${data.last_created_event_id || ''}`.trim();
			if (ctx && lastEventId) {
				const prev = `${lastChatEventByKey.get(ctx.key) || ''}`;
				if (prev !== lastEventId) {
					lastChatEventByKey.set(ctx.key, lastEventId);
					if (typeof window.showToast === 'function') {
						const message = createdCount > 0
							? `Event Tracking created ${createdCount} timeline event${createdCount === 1 ? '' : 's'}.`
							: 'Event Tracking updated timeline context.';
						window.showToast(message, 'success', 1400);
					}
				}
			}
		}
	}

	function escapeHtml(value) {
		return `${value || ''}`
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	function pollStatus(allowToast = false) {
		const ctx = getContext();
		if (!ctx || !isModuleEnabled()) {
			setProcessingBanner(false);
			removeForceThinkingBubble(true);
			return;
		}
		callModuleAction('status')
			.then((result) => {
				if (!result || !result.success) {
					setProcessingBanner(false);
					removeForceThinkingBubble(true);
					return;
				}
				renderStatus(result, allowToast);
			})
			.catch(() => {
				setProcessingBanner(false);
				removeForceThinkingBubble(true);
			});
	}

	function startPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
		}
		pollTimer = window.setInterval(() => pollStatus(false), POLL_MS);
		pollStatus(false);
	}

	function installHooks() {
		const originalRenderCurrentChat = window.renderCurrentChat;
		if (typeof originalRenderCurrentChat === 'function' && !window.__eventTrackingRenderPatched) {
			window.__eventTrackingRenderPatched = true;
			window.renderCurrentChat = function () {
				const output = originalRenderCurrentChat.apply(this, arguments);
				pollStatus(true);
				return output;
			};
		}

		window.addEventListener('nova:settings-updated', () => {
			pollStatus(false);
		});
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
