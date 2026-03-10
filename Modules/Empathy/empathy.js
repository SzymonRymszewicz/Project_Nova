(function () {
    'use strict';

    if (window.__empathyModule && window.__empathyModule.initialized) {
        return;
    }
    window.__empathyModule = window.__empathyModule || { initialized: false };
    window.__empathyModule.initialized = true;

    const MODULE_NAME = 'Empathy';
    const STATUS_TEXT = 'Trying to understand stuff';
    const POLL_MS = 900;

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
                const signature = JSON.stringify({ processing, message, thinkingOutput });
                if (signature === lastStatusSignature) {
                    return;
                }
                lastStatusSignature = signature;
                setProcessingBanner(processing, message, thinkingOutput);
            })
            .catch(() => {
                setProcessingBanner(false);
                lastStatusSignature = '';
            });
    }

    function startPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
        }
        pollTimer = window.setInterval(() => {
            pollStatus();
        }, POLL_MS);
        pollStatus();
    }

    function installHooks() {
        const originalSendMessage = window.sendMessage;
        if (typeof originalSendMessage === 'function' && !window.__empathySendPatched) {
            window.__empathySendPatched = true;
            window.sendMessage = function () {
                if (isModuleEnabled() && getContext()) {
                    window.setTimeout(() => pollStatus(), 30);
                    window.setTimeout(() => pollStatus(), 120);
                    window.setTimeout(() => pollStatus(), 240);
                    window.setTimeout(() => pollStatus(), 520);
                }
                return originalSendMessage.apply(this, arguments);
            };
        }

        const originalRunChatMessageAction = window.runChatMessageAction;
        if (typeof originalRunChatMessageAction === 'function' && !window.__empathyChatActionPatched) {
            window.__empathyChatActionPatched = true;
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
                    result.finally(() => window.setTimeout(() => pollStatus(), 120));
                }
                return result;
            };
        }

        window.addEventListener('nova:settings-updated', () => {
            pollStatus();
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
