const datasetState = {
	datasets: [],
	selectedDatasetId: '',
	isLoading: false,
};

function captureDatasetScrollState() {
	const datasetList = document.getElementById('dataset-list');
	const entriesList = document.getElementById('dataset-entries-list');
	return {
		selectedDatasetId: `${datasetState.selectedDatasetId || ''}`,
		datasetListScrollTop: datasetList ? datasetList.scrollTop : 0,
		entriesListScrollTop: entriesList ? entriesList.scrollTop : 0,
	};
}

function restoreDatasetScrollState(state) {
	if (!state) {
		return;
	}
	const datasetList = document.getElementById('dataset-list');
	if (datasetList) {
		datasetList.scrollTop = state.datasetListScrollTop;
	}
	if (`${state.selectedDatasetId || ''}` !== `${datasetState.selectedDatasetId || ''}`) {
		return;
	}
	const applyEntriesScroll = () => {
		const entriesList = document.getElementById('dataset-entries-list');
		if (entriesList) {
			entriesList.scrollTop = state.entriesListScrollTop;
		}
	};
	requestAnimationFrame(() => {
		requestAnimationFrame(applyEntriesScroll);
	});
}

function datasetEscapeHtml(value) {
	return `${value ?? ''}`
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function datasetGetJson(url) {
	return fetch(url).then((r) => r.json());
}

function datasetPostJson(url, payload) {
	return fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload || {})
	}).then((r) => r.json());
}

function getDatasetById(datasetId) {
	return (datasetState.datasets || []).find((row) => `${row?.id || ''}` === `${datasetId || ''}`) || null;
}

function ensureDatasetSelection() {
	if (!datasetState.datasets.length) {
		datasetState.selectedDatasetId = '';
		return;
	}
	if (!getDatasetById(datasetState.selectedDatasetId)) {
		datasetState.selectedDatasetId = `${datasetState.datasets[0].id || ''}`;
	}
}

function setDatasetLoading(loading, subtitleText = null) {
	datasetState.isLoading = !!loading;
	if (!chatHeader) {
		return;
	}
	if (datasetState.isLoading) {
		chatHeader.innerHTML = '<div><div class="chat-title">Dataset</div><div class="chat-subtitle">Loading datasets...</div></div>';
		return;
	}
	if (subtitleText) {
		chatHeader.innerHTML = `<div><div class="chat-title">Dataset</div><div class="chat-subtitle">${subtitleText}</div></div>`;
	}
}

function loadDatasets() {
	return datasetGetJson('/api/datasets')
		.then((result) => {
			const datasets = Array.isArray(result?.datasets) ? result.datasets : [];
			datasetState.datasets = datasets;
			ensureDatasetSelection();
			renderDatasetView();
		});
}

function refreshDatasets() {
	setDatasetLoading(true);
	return loadDatasets()
		.catch(() => {
			datasetState.datasets = [];
			datasetState.selectedDatasetId = '';
			renderDatasetView();
		})
		.finally(() => {
			setDatasetLoading(false, 'Global memory packs for optional bot injection');
		});
}

function createDatasetListMarkup() {
	if (!datasetState.datasets.length) {
		return '<div class="dataset-empty">No datasets yet.</div>';
	}
	return datasetState.datasets.map((dataset) => {
		const isActive = `${dataset?.id || ''}` === `${datasetState.selectedDatasetId || ''}`;
		const name = datasetEscapeHtml(`${dataset?.name || 'Untitled Dataset'}`);
		const entryCount = Array.isArray(dataset?.entries) ? dataset.entries.length : 0;
		const datasetId = datasetEscapeHtml(dataset.id);
		return `
			<div class="dataset-list-item${isActive ? ' active' : ''}" data-dataset-id="${datasetId}" role="button" tabindex="0" aria-label="Select dataset ${name}">
				<div class="dataset-list-item-title-row"><div class="dataset-list-item-name">${name}</div><div class="dataset-list-item-meta">${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}</div></div>
				<button type="button" class="action-btn delete-btn dataset-list-delete-btn" data-dataset-id="${datasetId}" title="Delete dataset">Delete</button>
			</div>
		`;
	}).join('');
}

function datasetEditorMarkup(dataset) {
	if (!dataset) {
		return `
			<div class="dataset-editor-empty">
				Select a dataset to edit entries.
			</div>
		`;
	}

	const entries = Array.isArray(dataset.entries) ? [...dataset.entries] : [];
	entries.sort((a, b) => (Number(a?.order || 0) - Number(b?.order || 0)));

	const entriesMarkup = entries.length
		? entries.map((entry, index) => datasetEntryRowMarkup(entry, index)).join('')
		: '<div class="dataset-empty">No entries yet. Add your first entry.</div>';

	return `
		<div class="dataset-editor-header">
			<div class="dataset-name-inline-wrap">
				<label for="dataset-name-input" class="dataset-name-inline-label">Dataset Name:</label>
				<input type="text" id="dataset-name-input" class="text-input dataset-name-inline-input" value="${datasetEscapeHtml(`${dataset?.name || ''}`)}" aria-label="Dataset Name">
				<button type="button" class="action-btn save-btn dataset-name-inline-save" id="dataset-save-btn">Save</button>
			</div>
		</div>
		<div class="dataset-entries-header">
			<h3>Entries</h3>
			<button type="button" class="action-btn dataset-entry-inline-add" id="dataset-add-entry-btn">Add Entry</button>
		</div>
		<div class="dataset-entries-list${entries.length > 1 ? ' has-multiple-entries' : ''}" id="dataset-entries-list">${entriesMarkup}</div>
	`;
}

function datasetEntryRowMarkup(entry, index) {
	const entryId = `${entry?.id || ''}`;
	const isCollapsed = entry?.collapsed === true;
	const entryName = datasetEscapeHtml(`${entry?.name || ''}`);
	const context = datasetEscapeHtml(`${entry?.context || ''}`);
	const modeRaw = `${entry?.mode || 'static'}`.toLowerCase();
	const mode = modeRaw === 'dynamic' || modeRaw === 'inactive' ? modeRaw : 'static';
	const keywords = Array.isArray(entry?.keywords) ? entry.keywords.join(', ') : `${entry?.keywords || ''}`;
	return `
		<div class="dataset-entry-row${isCollapsed ? ' collapsed' : ''}" data-entry-id="${datasetEscapeHtml(entryId)}" draggable="true">
			<div class="dataset-entry-topbar">
				<div class="dataset-entry-index-group">
					<span class="dataset-entry-order">${index + 1}.</span>
					<span class="dataset-entry-drag" title="Drag to reorder">::</span>
				</div>
				<div class="dataset-entry-name-inline-wrap">
					<label class="dataset-entry-name-inline-label">Entry Name:</label>
					<input type="text" class="text-input dataset-entry-name-input" value="${entryName}" placeholder="Entry Name">
					<button type="button" class="action-btn save-btn dataset-entry-name-save">Save</button>
				</div>
				<div class="dataset-entry-topbar-controls">
					<div class="dataset-entry-actions">
						<button type="button" class="action-btn save-btn dataset-entry-save-btn">Save</button>
						<button type="button" class="action-btn delete-btn dataset-entry-delete-btn">Delete</button>
					</div>
					<button type="button" class="dataset-entry-collapse-btn" aria-expanded="${isCollapsed ? 'false' : 'true'}" title="${isCollapsed ? 'Expand entry' : 'Collapse entry'}">${isCollapsed ? '<' : 'v'}</button>
				</div>
			</div>
			<div class="dataset-entry-body">
				<div class="dataset-entry-mode-keywords-row">
					<div class="form-group dataset-entry-mode-group">
						<label>Mode</label>
						<select class="text-input dataset-entry-mode">
							<option value="static" ${mode === 'static' ? 'selected' : ''}>Static</option>
							<option value="dynamic" ${mode === 'dynamic' ? 'selected' : ''}>Dynamic</option>
							<option value="inactive" ${mode === 'inactive' ? 'selected' : ''}>Inactive</option>
						</select>
					</div>
					<div class="form-group dataset-entry-keywords-group${mode === 'dynamic' ? '' : ' is-inactive'}">
						<label>Keywords</label>
						<input type="text" class="text-input dataset-entry-keywords" value="${datasetEscapeHtml(keywords)}" placeholder="ai, hobby, weather">
						<div class="dataset-entry-keywords-helper"></div>
					</div>
				</div>
				<div class="form-group">
					<div class="dataset-entry-context-header">
						<div class="dataset-entry-context-title">
							<label>Context</label>
							<span class="token-badge dataset-entry-context-token">0 tok</span>
						</div>
					</div>
					<textarea class="text-input dataset-entry-context" rows="4">${context}</textarea>
				</div>
			</div>
		</div>
	`;
}

function renderDatasetView() {
	const scrollState = captureDatasetScrollState();
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Dataset</div><div class="chat-subtitle">Global static, dynamic, and inactive memory packs</div></div>';
	messagesContainer.innerHTML = `
		<div class="bot-editor dataset-layout">
			<div class="dataset-hero">
				<div class="dataset-hero-title">DATASET CORE</div>
				<div class="dataset-hero-subtitle">Build reusable AI context packs and assign them per bot in configuration.</div>
			</div>
			<div class="bot-editor-grid dataset-grid">
				<div class="bot-editor-section dataset-sidebar">
					<div class="dataset-sidebar-head">
						<h3>Datasets</h3>
						<div class="dataset-sidebar-head-actions">
							<button type="button" class="action-btn dataset-create-inline-btn" id="dataset-create-btn">Create Dataset</button>
						</div>
					</div>
					<div class="dataset-list" id="dataset-list">${createDatasetListMarkup()}</div>
				</div>
				<div class="bot-editor-section dataset-main" id="dataset-main-editor">
					<div class="dataset-main-head"><h3>Editor</h3></div>
					${datasetEditorMarkup(getDatasetById(datasetState.selectedDatasetId))}
				</div>
			</div>
		</div>
	`;
	bindDatasetViewEvents();
	restoreDatasetScrollState(scrollState);
}

function readEntryRowPayload(row) {
	const nameInput = row.querySelector('.dataset-entry-name-input');
	const contextInput = row.querySelector('.dataset-entry-context');
	const modeInput = row.querySelector('.dataset-entry-mode');
	const keywordsInput = row.querySelector('.dataset-entry-keywords');
	return {
		name: nameInput ? nameInput.value : '',
		context: contextInput ? contextInput.value : '',
		mode: modeInput ? modeInput.value : 'static',
		keywords: keywordsInput ? keywordsInput.value : '',
		collapsed: row.classList.contains('collapsed'),
	};
}

function updateEntryOrderLabels() {
	document.querySelectorAll('.dataset-entry-row .dataset-entry-order').forEach((el, index) => {
		el.textContent = `${index + 1}.`;
	});
}

function updateEntriesOvershootSpacing(entriesList) {
	if (!entriesList) {
		return;
	}
	const rows = Array.from(entriesList.querySelectorAll('.dataset-entry-row'));
	if (rows.length < 2) {
		entriesList.style.removeProperty('--dataset-entry-overshoot');
		return;
	}
	const lastRow = rows[rows.length - 1];
	if (!lastRow) {
		entriesList.style.removeProperty('--dataset-entry-overshoot');
		return;
	}
	const listHeight = entriesList.clientHeight;
	if (!listHeight) {
		entriesList.style.removeProperty('--dataset-entry-overshoot');
		return;
	}
	const computed = window.getComputedStyle(entriesList);
	const gap = Number.parseFloat(computed.rowGap || computed.gap || '0') || 0;
	const overshoot = Math.max(0, Math.floor(listHeight - lastRow.offsetHeight - gap));
	entriesList.style.setProperty('--dataset-entry-overshoot', `${overshoot}px`);
}

function bindDatasetEntryDrag(listElement) {
	let draggingEl = null;

	listElement.addEventListener('dragstart', (event) => {
		const row = event.target.closest('.dataset-entry-row');
		if (!row) {
			return;
		}
		draggingEl = row;
		row.classList.add('dragging');
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', row.getAttribute('data-entry-id') || '');
		}
	});

	listElement.addEventListener('dragend', () => {
		if (draggingEl) {
			draggingEl.classList.remove('dragging');
		}
		draggingEl = null;
		updateEntryOrderLabels();
	});

	listElement.addEventListener('dragover', (event) => {
		event.preventDefault();
		if (!draggingEl) {
			return;
		}
		const target = event.target.closest('.dataset-entry-row');
		if (!target || target === draggingEl) {
			return;
		}
		const rect = target.getBoundingClientRect();
		const after = event.clientY > rect.top + (rect.height / 2);
		if (after) {
			target.after(draggingEl);
		} else {
			target.before(draggingEl);
		}
		updateEntryOrderLabels();
	});

	listElement.addEventListener('drop', (event) => {
		event.preventDefault();
		updateEntryOrderLabels();
		const datasetId = datasetState.selectedDatasetId;
		if (!datasetId) {
			return;
		}
		const entryIds = Array.from(listElement.querySelectorAll('.dataset-entry-row'))
			.map((row) => `${row.getAttribute('data-entry-id') || ''}`)
			.filter((id) => id && !id.startsWith('temp_'));
		datasetPostJson('/api/datasets', {
			action: 'reorder_entries',
			dataset_id: datasetId,
			entry_ids: entryIds,
		}).then((result) => {
			if (!result?.success) {
				if (typeof showToast === 'function') {
					showToast('Failed to reorder entries.', 'error');
				}
				return;
			}
			datasetState.datasets = Array.isArray(result.datasets) ? result.datasets : [];
			ensureDatasetSelection();
			renderDatasetView();
		});
	});
}

function bindDatasetViewEvents() {
	const createBtn = document.getElementById('dataset-create-btn');
	if (createBtn) {
		createBtn.addEventListener('click', () => {
			const name = prompt('Dataset name:', 'New Dataset');
			if (name === null) {
				return;
			}
			datasetPostJson('/api/datasets', {
				action: 'create_dataset',
				name,
			}).then((result) => {
				if (!result?.success) {
					if (typeof showToast === 'function') {
						showToast(result?.message || 'Failed to create dataset.', 'error');
					}
					return;
				}
				datasetState.datasets = Array.isArray(result.datasets) ? result.datasets : [];
				if (datasetState.datasets.length) {
					datasetState.selectedDatasetId = `${datasetState.datasets[datasetState.datasets.length - 1].id || ''}`;
				}
				renderDatasetView();
			});
		});
	}

	document.querySelectorAll('.dataset-list-item').forEach((button) => {
		button.addEventListener('click', () => {
			datasetState.selectedDatasetId = `${button.getAttribute('data-dataset-id') || ''}`;
			renderDatasetView();
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}
			event.preventDefault();
			datasetState.selectedDatasetId = `${button.getAttribute('data-dataset-id') || ''}`;
			renderDatasetView();
		});
	});

	document.querySelectorAll('.dataset-list-delete-btn').forEach((deleteBtn) => {
		deleteBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			const datasetId = `${deleteBtn.getAttribute('data-dataset-id') || ''}`;
			const targetDataset = getDatasetById(datasetId);
			if (!targetDataset) {
				return;
			}
			if (!confirm(`Delete dataset "${targetDataset.name}"?`)) {
				return;
			}
			datasetPostJson('/api/datasets', {
				action: 'delete_dataset',
				dataset_id: targetDataset.id,
			}).then((result) => {
				if (!result?.success) {
					if (typeof showToast === 'function') {
						showToast(result?.message || 'Failed to delete dataset.', 'error');
					}
					return;
				}
				datasetState.datasets = Array.isArray(result.datasets) ? result.datasets : [];
				ensureDatasetSelection();
				renderDatasetView();
			});
		});
	});

	const currentDataset = getDatasetById(datasetState.selectedDatasetId);
	if (!currentDataset) {
		return;
	}

	const saveDatasetBtn = document.getElementById('dataset-save-btn');
	const nameInput = document.getElementById('dataset-name-input');
	if (saveDatasetBtn && nameInput) {
		let originalName = `${currentDataset?.name || ''}`;
		let preserveNameOnBlur = false;

		const setSaveVisible = (visible) => {
			saveDatasetBtn.classList.toggle('is-visible', !!visible);
		};

		const hasNameChange = () => `${nameInput.value || ''}` !== originalName;

		const syncSaveVisibility = () => {
			const isFocused = document.activeElement === nameInput;
			setSaveVisible(isFocused && hasNameChange());
		};

		nameInput.addEventListener('focus', () => {
			syncSaveVisibility();
		});

		nameInput.addEventListener('input', () => {
			syncSaveVisibility();
		});

		saveDatasetBtn.addEventListener('mousedown', () => {
			preserveNameOnBlur = true;
		});

		nameInput.addEventListener('blur', () => {
			if (preserveNameOnBlur) {
				preserveNameOnBlur = false;
				return;
			}
			if (hasNameChange()) {
				nameInput.value = originalName;
			}
			setSaveVisible(false);
		});

		saveDatasetBtn.addEventListener('click', () => {
			const nextName = `${nameInput.value || ''}`;
			datasetPostJson('/api/datasets', {
				action: 'update_dataset',
				dataset_id: currentDataset.id,
				name: nextName,
			}).then((result) => {
				if (!result?.success) {
					if (typeof showToast === 'function') {
						showToast(result?.message || 'Failed to save dataset.', 'error');
					}
					return;
				}
				datasetState.datasets = Array.isArray(result.datasets) ? result.datasets : [];
				ensureDatasetSelection();
				originalName = nextName;
				setSaveVisible(false);
				const datasetItem = Array.from(document.querySelectorAll('.dataset-list-item')).find((item) => `${item.getAttribute('data-dataset-id') || ''}` === `${currentDataset.id || ''}`);
				const nameEl = datasetItem ? datasetItem.querySelector('.dataset-list-item-name') : null;
				if (nameEl) {
					nameEl.textContent = nextName;
				}
				if (typeof showToast === 'function') {
					showToast('Dataset saved.', 'success');
				}
			});
		});

		setSaveVisible(false);
	}

	const addEntryBtn = document.getElementById('dataset-add-entry-btn');
	const entriesList = document.getElementById('dataset-entries-list');
	if (addEntryBtn && entriesList) {
		addEntryBtn.addEventListener('click', () => {
			const tempId = `temp_${Date.now()}`;
			const wrapper = document.createElement('div');
			wrapper.innerHTML = datasetEntryRowMarkup({
				id: tempId,
				context: '',
				mode: 'static',
				keywords: [],
				order: entriesList.querySelectorAll('.dataset-entry-row').length,
			}, entriesList.querySelectorAll('.dataset-entry-row').length);
			const row = wrapper.firstElementChild;
			entriesList.appendChild(row);
			updateEntryOrderLabels();
			bindSingleEntryRowEvents(row, currentDataset.id);
			requestAnimationFrame(() => updateEntriesOvershootSpacing(entriesList));
		});
		bindDatasetEntryDrag(entriesList);
	}

	document.querySelectorAll('.dataset-entry-row').forEach((row) => {
		bindSingleEntryRowEvents(row, currentDataset.id);
	});

	if (entriesList) {
		requestAnimationFrame(() => updateEntriesOvershootSpacing(entriesList));
	}
}

function bindSingleEntryRowEvents(row, datasetId) {
	const saveBtn = row.querySelector('.dataset-entry-save-btn');
	const deleteBtn = row.querySelector('.dataset-entry-delete-btn');
	bindEntryCollapseEvents(row, datasetId);
	bindEntryModeVisibilityEvents(row);
	bindEntryQualityHelpers(row);
	bindingEntryNameInlineEvents(row, datasetId);

	if (saveBtn) {
		saveBtn.addEventListener('click', () => {
			const entryPayload = readEntryRowPayload(row);
			submitEntrySave(row, datasetId, entryPayload, 'Entry saved.', { forceRerender: false });
		});
	}

	if (deleteBtn) {
		deleteBtn.addEventListener('click', () => {
			const rawName = `${(row.querySelector('.dataset-entry-name-input')?.value || '').trim()}`;
			const entryDisplayName = rawName || 'Unnamed';
			if (!confirm(`Delete entry "${entryDisplayName}"?`)) {
				return;
			}
			const entryId = `${row.getAttribute('data-entry-id') || ''}`;
			if (entryId.startsWith('temp_')) {
				row.remove();
				updateEntryOrderLabels();
				return;
			}
			datasetPostJson('/api/datasets', {
				action: 'delete_entry',
				dataset_id: datasetId,
				entry_id: entryId,
			}).then((result) => {
				if (!result?.success) {
					if (typeof showToast === 'function') {
						showToast(result?.message || 'Failed to delete entry.', 'error');
					}
					return;
				}
				datasetState.datasets = Array.isArray(result.datasets) ? result.datasets : [];
				datasetState.selectedDatasetId = datasetId;
				renderDatasetView();
			});
		});
	}
}

function estimateEntryTokens(text) {
	const content = `${text || ''}`.trim();
	if (!content) {
		return 0;
	}
	return Math.max(1, Math.ceil(content.length / 4));
}

function analyzeKeywords(rawKeywords) {
	const parts = `${rawKeywords || ''}`
		.split(',')
		.map((part) => part.trim())
		.filter((part) => !!part);

	const seen = new Set();
	let duplicateCount = 0;
	let punctuationCount = 0;
	let shortCount = 0;

	parts.forEach((tokenRaw) => {
		const token = tokenRaw.toLowerCase();
		if (seen.has(token)) {
			duplicateCount += 1;
		} else {
			seen.add(token);
		}
		if (/[^\w\s-]/.test(tokenRaw)) {
			punctuationCount += 1;
		}
		if (token.length > 0 && token.length < 2) {
			shortCount += 1;
		}
	});

	return {
		count: parts.length,
		duplicateCount,
		punctuationCount,
		shortCount,
	};
}

function bindEntryQualityHelpers(row) {
	const contextInput = row.querySelector('.dataset-entry-context');
	const tokenBadge = row.querySelector('.dataset-entry-context-token');
	const keywordsInput = row.querySelector('.dataset-entry-keywords');
	const keywordsHelper = row.querySelector('.dataset-entry-keywords-helper');

	if (contextInput && tokenBadge) {
		const updateTokenBadge = () => {
			tokenBadge.textContent = `${estimateEntryTokens(contextInput.value)} tok`;
		};
		contextInput.addEventListener('input', updateTokenBadge);
		updateTokenBadge();
	}

	if (keywordsInput && keywordsHelper) {
		const updateKeywordsHelper = () => {
			const result = analyzeKeywords(keywordsInput.value);
			const notes = [`${result.count} keyword${result.count === 1 ? '' : 's'}`];
			if (result.duplicateCount > 0) {
				notes.push(`${result.duplicateCount} duplicate${result.duplicateCount === 1 ? '' : 's'}`);
			}
			if (result.punctuationCount > 0) {
				notes.push(`${result.punctuationCount} with punctuation`);
			}
			if (result.shortCount > 0) {
				notes.push(`${result.shortCount} very short`);
			}
			keywordsHelper.textContent = notes.join(' | ');
			keywordsHelper.classList.toggle(
				'warning',
				result.duplicateCount > 0 || result.punctuationCount > 0 || result.shortCount > 0,
			);
		};
		keywordsInput.addEventListener('input', updateKeywordsHelper);
		updateKeywordsHelper();
	}
}

function bindEntryModeVisibilityEvents(row) {
	const modeInput = row.querySelector('.dataset-entry-mode');
	const keywordsGroup = row.querySelector('.dataset-entry-keywords-group');
	const keywordsInput = row.querySelector('.dataset-entry-keywords');
	if (!modeInput || !keywordsGroup) {
		return;
	}

	const applyVisibility = () => {
		const isDynamic = `${modeInput.value || ''}`.toLowerCase() === 'dynamic';
		keywordsGroup.classList.toggle('is-inactive', !isDynamic);
		if (keywordsInput) {
			keywordsInput.disabled = !isDynamic;
		}
	};

	modeInput.addEventListener('change', applyVisibility);
	applyVisibility();
}

function bindEntryCollapseEvents(row, datasetId) {
	const collapseBtn = row.querySelector('.dataset-entry-collapse-btn');
	if (!collapseBtn) {
		return;
	}

	const preserveRowViewportPosition = (mutate) => {
		const entriesList = row.closest('.dataset-entries-list');
		if (!entriesList) {
			mutate();
			return;
		}
		const beforeTop = row.getBoundingClientRect().top;
		const beforeScrollTop = entriesList.scrollTop;
		mutate();
		requestAnimationFrame(() => {
			const afterTop = row.getBoundingClientRect().top;
			const delta = afterTop - beforeTop;
			if (delta !== 0) {
				entriesList.scrollTop = beforeScrollTop + delta;
			}
			// Final guard: avoid sub-pixel clipping by fully containing the row.
			const listRect = entriesList.getBoundingClientRect();
			const rowRect = row.getBoundingClientRect();
			const edgePadding = 2;
			if (rowRect.top < listRect.top + edgePadding) {
				entriesList.scrollTop += rowRect.top - (listRect.top + edgePadding);
			}
			if (rowRect.bottom > listRect.bottom - edgePadding) {
				entriesList.scrollTop += rowRect.bottom - (listRect.bottom - edgePadding);
			}
		});
	};

	const applyCollapsedState = (collapsed) => {
		row.classList.toggle('collapsed', !!collapsed);
		collapseBtn.setAttribute('aria-expanded', (!collapsed).toString());
		collapseBtn.textContent = collapsed ? '<' : 'v';
		collapseBtn.title = collapsed ? 'Expand entry' : 'Collapse entry';
		const entriesList = row.closest('.dataset-entries-list');
		if (entriesList) {
			requestAnimationFrame(() => updateEntriesOvershootSpacing(entriesList));
		}
	};

	collapseBtn.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const collapsed = !row.classList.contains('collapsed');
		preserveRowViewportPosition(() => {
			applyCollapsedState(collapsed);
		});
		persistEntryCollapseState(row, datasetId, collapsed);
	});

	applyCollapsedState(row.classList.contains('collapsed'));
}

function persistEntryCollapseState(row, datasetId, collapsed) {
	const entryId = `${row.getAttribute('data-entry-id') || ''}`;
	if (!datasetId || !entryId || entryId.startsWith('temp_')) {
		return;
	}
	datasetPostJson('/api/datasets', {
		action: 'update_entry',
		dataset_id: datasetId,
		entry_id: entryId,
		entry: { collapsed: !!collapsed },
	}).then((result) => {
		if (!result?.success) {
			return;
		}
		datasetState.datasets = Array.isArray(result.datasets) ? result.datasets : datasetState.datasets;
	});
}

function submitEntrySave(row, datasetId, entryPayload, successMessage = 'Entry saved.', options = {}) {
	const entryId = `${row.getAttribute('data-entry-id') || ''}`;
	const forceRerender = !!options?.forceRerender;
	const onSuccess = typeof options?.onSuccess === 'function' ? options.onSuccess : null;
	const payload = {
		action: entryId.startsWith('temp_') ? 'create_entry' : 'update_entry',
		dataset_id: datasetId,
		entry: entryPayload,
	};
	if (payload.action === 'update_entry') {
		payload.entry_id = entryId;
	}

	datasetPostJson('/api/datasets', payload).then((result) => {
		if (!result?.success) {
			if (typeof showToast === 'function') {
				showToast(result?.message || 'Failed to save entry.', 'error');
			}
			return;
		}
		datasetState.datasets = Array.isArray(result.datasets) ? result.datasets : [];
		datasetState.selectedDatasetId = datasetId;
		const shouldRerender = forceRerender || payload.action === 'create_entry';
		if (shouldRerender) {
			renderDatasetView();
		} else {
			const entriesList = row.closest('.dataset-entries-list');
			if (entriesList) {
				requestAnimationFrame(() => updateEntriesOvershootSpacing(entriesList));
			}
		}
		if (onSuccess) {
			onSuccess(result);
		}
		if (successMessage && typeof showToast === 'function') {
			showToast(successMessage, 'success');
		}
	});
}

function bindingEntryNameInlineEvents(row, datasetId) {
	const nameInput = row.querySelector('.dataset-entry-name-input');
	const saveBtn = row.querySelector('.dataset-entry-name-save');
	if (!nameInput || !saveBtn) {
		return;
	}

	let originalName = `${nameInput.value || ''}`;
	let preserveNameOnBlur = false;

	const setSaveVisible = (visible) => {
		saveBtn.classList.toggle('is-visible', !!visible);
	};

	const hasNameChange = () => `${nameInput.value || ''}` !== originalName;

	const syncSaveVisibility = () => {
		const isFocused = document.activeElement === nameInput;
		setSaveVisible(isFocused && hasNameChange());
	};

	nameInput.addEventListener('focus', () => {
		syncSaveVisibility();
	});

	nameInput.addEventListener('input', () => {
		syncSaveVisibility();
	});

	saveBtn.addEventListener('mousedown', () => {
		preserveNameOnBlur = true;
	});

	nameInput.addEventListener('blur', () => {
		if (preserveNameOnBlur) {
			preserveNameOnBlur = false;
			return;
		}
		if (hasNameChange()) {
			nameInput.value = originalName;
		}
		setSaveVisible(false);
	});

	saveBtn.addEventListener('click', () => {
		const entryId = `${row.getAttribute('data-entry-id') || ''}`;
		const entryPayload = entryId.startsWith('temp_')
			? readEntryRowPayload(row)
			: { name: nameInput.value };
		submitEntrySave(row, datasetId, entryPayload, 'Entry name saved.', {
			forceRerender: false,
			onSuccess: () => {
				originalName = `${nameInput.value || ''}`;
				setSaveVisible(false);
			},
		});
	});

	setSaveVisible(false);
}

function showDataset() {
	setDatasetLoading(true);
	refreshDatasets();
}
