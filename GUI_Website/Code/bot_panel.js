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

	inner.innerHTML = `<div class="bot-panel-cover" style="${coverStyle}">${coverContent}</div><div class="bot-panel-name">${botName}</div><div class="bot-panel-group"><h3>Generation</h3><div class="setting-item"><label class="setting-label">Temperature</label><input type="range" class="setting-input" min="0" max="2" step="0.1" value="${tempValue}" id="bot-temp"></div><div class="setting-item"><label class="setting-label">Max Tokens</label><input type="number" class="setting-input" value="${tokensValue}" id="bot-tokens"></div><div class="bot-panel-actions"><button class="btn btn-primary" id="bot-settings-save">Save</button></div></div>`;

	const tempInput = document.getElementById('bot-temp');
	const tokensInput = document.getElementById('bot-tokens');
	const saveBtn = document.getElementById('bot-settings-save');
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
	fetch('/api/settings', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'update', settings: payload })
	})
		.then(r => r.json())
		.then(() => {
			settingsDraft = { ...settingsDraft, ...payload };
			lastSavedSettings = { ...lastSavedSettings, ...payload };
		});
}
