// Developer Tools Tab
// Only accessible when debug mode is enabled

const DEV_DELETE_LOGS_DEFAULT_TEXT = 'Delete All Debug Logs';
const DEV_DELETE_LOGS_BUSY_TEXT = 'Deleting...';

function showDev() {
	if (!isDebugModeEnabled()) {
		messagesContainer.innerHTML = '<div class="error-message">Debug mode must be enabled in Settings to access Developer Tools.</div>';
		return;
	}

	messagesContainer.innerHTML = `
		<div class="dev-container">
			<h2>Developer Tools</h2>
			<p class="dev-subtitle">Debug and development utilities</p>

			<div class="dev-section">
				<h3>System Information</h3>
				<div id="systemInfo" class="info-panel">Loading...</div>
			</div>

			<div class="dev-section">
				<h3>Debug Logs</h3>
				<div id="debugLogs" class="info-panel">Loading...</div>
				<div class="dev-actions">
					<button class="btn btn-danger dev-debug-delete-btn" id="deleteAllDebugLogsBtn">${DEV_DELETE_LOGS_DEFAULT_TEXT}</button>
				</div>
			</div>
		</div>
	`;

	loadDevData();
	setupDevEventListeners();
}

function fetchDevJson(url, options = null) {
	return fetch(url, options || undefined).then(async (response) => {
		const rawText = await response.text();
		let data = {};
		if (rawText) {
			try {
				data = JSON.parse(rawText);
			} catch (_error) {
				throw new Error(`Invalid server response (${response.status})`);
			}
		}
		if (!response.ok) {
			throw new Error(data.error || `Request failed (${response.status})`);
		}
		return data;
	});
}

function loadDevData() {
	loadDevSystemInfo();
	loadDevDebugLogs();
}

function loadDevSystemInfo() {
	fetchDevJson('/api/dev/system-info')
		.then((data) => {
			const systemInfo = document.getElementById('systemInfo');
			if (!systemInfo) {
				return;
			}
			systemInfo.innerHTML = `
				<div class="info-row"><strong>Python:</strong> ${escapeDevHtml(data.python_version || 'N/A')}</div>
				<div class="info-row"><strong>Platform:</strong> ${escapeDevHtml(data.platform || 'N/A')}</div>
				<div class="info-row"><strong>Working Directory:</strong> ${escapeDevHtml(data.working_directory || 'N/A')}</div>
			`;
		})
		.catch((error) => {
			const systemInfo = document.getElementById('systemInfo');
			if (systemInfo) {
				systemInfo.innerHTML = `<div class="error">Failed to load system info: ${escapeDevHtml(error.message)}</div>`;
			}
		});
}

function loadDevDebugLogs() {
	fetchDevJson('/api/dev/debug-logs')
		.then((data) => {
			const debugLogs = document.getElementById('debugLogs');
			if (!debugLogs) {
				return;
			}
			if (!data.available || !Array.isArray(data.logs) || data.logs.length === 0) {
				debugLogs.innerHTML = '<div class="info-row">No debug logs found</div>';
				return;
			}
			const logsList = data.logs.map((log) => `
				<div class="info-row">
					<strong>${escapeDevHtml(log.name)}</strong>
					<span class="info-detail">${formatBytes(log.size)} | ${formatDateTime(log.modified)}</span>
				</div>
			`).join('');
			debugLogs.innerHTML = logsList;
		})
		.catch((error) => {
			const debugLogs = document.getElementById('debugLogs');
			if (debugLogs) {
				debugLogs.innerHTML = `<div class="error">Failed to load debug logs: ${escapeDevHtml(error.message)}</div>`;
			}
		});
}

function setupDevEventListeners() {
	const deleteLogsBtn = document.getElementById('deleteAllDebugLogsBtn');

	if (deleteLogsBtn) {
		deleteLogsBtn.addEventListener('click', () => {
			deleteAllDebugLogs(deleteLogsBtn);
		});
	}
}

function deleteAllDebugLogs(deleteLogsBtn) {
	if (!deleteLogsBtn) {
		return;
	}
	if (!confirm('Are you sure you want to delete ALL debug logs? This cannot be undone.')) {
		return;
	}

	deleteLogsBtn.disabled = true;
	deleteLogsBtn.textContent = DEV_DELETE_LOGS_BUSY_TEXT;

	fetchDevJson('/api/dev/delete-debug-logs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({})
	})
		.then((data) => {
			if (data.success) {
				alert(`Successfully deleted ${data.deleted || 0} debug log file(s).`);
				loadDevData();
				return;
			}
			alert(`Failed to delete debug logs: ${data.error || 'Unknown error'}`);
		})
		.catch((error) => {
			alert(`Error: ${error.message}`);
		})
		.finally(() => {
			deleteLogsBtn.disabled = false;
			deleteLogsBtn.textContent = DEV_DELETE_LOGS_DEFAULT_TEXT;
		});
}

function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}
	const units = ['B', 'KB', 'MB', 'GB'];
	const base = 1024;
	const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(base)));
	const value = Math.round((bytes / Math.pow(base, index)) * 100) / 100;
	return `${value} ${units[index]}`;
}

function formatDateTime(isoString) {
	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) {
		return `${isoString || ''}`;
	}
	return date.toLocaleString();
}

function escapeDevHtml(text) {
	const div = document.createElement('div');
	div.textContent = `${text || ''}`;
	return div.innerHTML;
}
