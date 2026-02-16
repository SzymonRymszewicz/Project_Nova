function updateBotPanel() {
	const panel = document.getElementById('botPanel');
	const inner = document.getElementById('botPanelInner');
	if (!panel || !inner) {
		return;
	}

	const botName = (currentBotInfo && currentBotInfo.name) ? currentBotInfo.name : (currentBotName || 'No bot selected');
	const coverArt = currentBotInfo && currentBotInfo.cover_art ? currentBotInfo.cover_art : '';
	const coverFit = currentBotInfo && currentBotInfo.cover_art_fit ? currentBotInfo.cover_art_fit : null;
	const initial = botName ? botName[0].toUpperCase() : 'B';
	const coverStyle = coverArt
		? buildImageStyle(coverArt, coverFit)
		: 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);';
	const coverContent = coverArt ? '' : `<div>${initial}</div>`;

	const tempValue = Number.isFinite(settingsDraft.temperature) ? settingsDraft.temperature : (lastSavedSettings.temperature ?? 0.7);
	const tokensValue = Number.isFinite(settingsDraft.max_tokens) ? settingsDraft.max_tokens : (lastSavedSettings.max_tokens ?? 2048);

	inner.innerHTML = `<div class="bot-panel-cover" style="${coverStyle}">${coverContent}</div><div class="bot-panel-name-row"><div class="bot-panel-name">${botName}</div><button class="icon-btn bot-panel-edit-btn" type="button" title="Edit bot" aria-label="Edit bot"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-1 1-3.828-3.828 1-1a2 2 0 012.828 0zM2 13.586l9.586-9.586 3.828 3.828L5.828 17.414H2v-3.828z"/></svg></button></div><div class="bot-panel-group"><h3>Generation</h3><div class="setting-item"><label class="setting-label">Temperature</label><input type="range" class="setting-input" min="0" max="2" step="0.1" value="${tempValue}" id="bot-temp"></div><div class="setting-item"><label class="setting-label">Max Tokens</label><input type="number" class="setting-input" value="${tokensValue}" id="bot-tokens"></div><div class="bot-panel-actions"><button class="btn btn-primary" id="bot-settings-save">Save Generation</button><button class="btn btn-secondary" id="bot-settings-reset">Restore Generation</button></div></div>`;
	makeSectionsCollapsible(inner, '.bot-panel-group', 'chat-generation-panel');

	const tempInput = document.getElementById('bot-temp');
	const tokensInput = document.getElementById('bot-tokens');
	const saveBtn = document.getElementById('bot-settings-save');
	const resetBtn = document.getElementById('bot-settings-reset');
	const editBtn = document.querySelector('.bot-panel-edit-btn');
	if (tempInput) {
		tempInput.addEventListener('input', () => {
			settingsDraft.temperature = parseFloat(tempInput.value);
		});
	}
	if (tokensInput) {
		tokensInput.addEventListener('input', () => {
			settingsDraft.max_tokens = parseInt(tokensInput.value, 10);
		});
	}
	if (saveBtn) {
		saveBtn.addEventListener('click', () => {
			saveGenerationSettings();
		});
	}
	if (resetBtn) {
		resetBtn.addEventListener('click', () => {
			resetGenerationSettingsFromPanel();
		});
	}
	if (editBtn) {
		editBtn.addEventListener('click', () => {
			const targetBotName = (currentBotInfo && currentBotInfo.name) ? currentBotInfo.name : currentBotName;
			if (!targetBotName) {
				return;
			}

			fetch('/api/bot/select', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bot_name: targetBotName })
			})
				.then(r => r.json())
				.then(data => {
					if (!data || !data.success || !data.bot) {
						return;
					}
					currentBotInfo = data.bot;
					currentBotName = data.bot.name;

					const navArray = Array.from(navItems || []);
					navArray.forEach(item => item.classList.remove('active'));
					const botsNavItem = navArray.find(item => item.dataset && item.dataset.view === 'bots');
					if (botsNavItem) {
						botsNavItem.classList.add('active');
					}

					const appRoot = document.querySelector('.app');
					if (appRoot) {
						appRoot.classList.remove('chat-layout');
					}
					const panel = document.getElementById('botPanel');
					if (panel) {
						panel.classList.remove('visible');
					}
					if (inputArea) {
						inputArea.classList.remove('visible');
					}
					currentView = 'bots';
					renderBotDetailView(data.bot);
					showBotEditor(data.bot);
				});
		});
	}
}

function saveGenerationSettings() {
	const tempInput = document.getElementById('bot-temp');
	const tokensInput = document.getElementById('bot-tokens');
	if (!tempInput || !tokensInput) {
		return;
	}
	const payload = {
		temperature: parseFloat(tempInput.value),
		max_tokens: parseInt(tokensInput.value, 10)
	};
	saveSettingsPatch(payload, true);
}

function resetGenerationSettingsFromPanel() {
	if (typeof restoreGenerationSettings === 'function') {
		restoreGenerationSettings({ showAlert: true, askConfirmation: true });
		return;
	}
	if (!confirm('Restore Generation settings to defaults?')) {
		return;
	}
	const payload = {
		temperature: 0.7,
		max_tokens: 2048
	};
	saveSettingsPatch(payload, false)
		.then(() => {
			alert('Generation settings restored to defaults!');
			updateBotPanel();
		});
}
