function showPersonas() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Personas</div><div class="chat-subtitle">Choose your persona</div></div>';
	fetch('/api/personas')
		.then(r => r.json())
		.then(personas => {
			const grid = document.createElement('div');
			grid.className = 'bot-grid';
			personas.forEach(p => {
				const card = document.createElement('div');
				card.className = 'persona-card';
				const isUser = p.id === 'User';
				const initial = isUser ? 'U' : p.name[0].toUpperCase();
				const bgGrad = isUser ? 'linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%)' : 'linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%)';
				const coverStyle = p.cover_art ? buildImageStyle(p.cover_art, p.cover_art_fit || null) : `background:${bgGrad};`;
				const coverContent = p.cover_art ? '' : `<div>${initial}</div>`;
				card.innerHTML = `<div class="card-cover" style="${coverStyle}">${coverContent}</div><div class="card-content"><div class="card-title">${p.name}</div><div class="card-desc">${p.description || 'No description'}</div></div>`;
				card.onclick = () => selectPersona(p);
				grid.appendChild(card);
			});
			messagesContainer.appendChild(grid);
		});
}

function selectPersona(persona) {
	currentPersonaInfo = persona;
	console.log('Persona selected:', persona.name);
	showPersonaDetail(persona);
}

function showPersonaDetail(persona) {
	chatHeader.innerHTML = `<div><div class="chat-title">${persona.name}</div><div class="chat-subtitle">Persona Details</div></div>`;
	// Clear the messages container to replace the persona grid
	messagesContainer.innerHTML = '';
	const detail = document.createElement('div');
	detail.className = 'bot-detail';
	const isUser = persona.id === 'User';
	const initial = isUser ? 'U' : persona.name[0].toUpperCase();
	const defaultGrad = isUser ? 'linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%)' : 'linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%)';
	const coverStyle = persona.cover_art
		? buildImageStyle(persona.cover_art, persona.cover_art_fit || null)
		: `background:${defaultGrad};`;
	const coverContent = persona.cover_art ? '' : `<div>${initial}</div>`;
	detail.innerHTML = `<div class="detail-cover" style="${coverStyle}">${coverContent}</div><div class="detail-info"><div class="detail-title-row"><h2>${persona.name}</h2><button class="icon-btn persona-edit-btn" type="button" title="Edit persona" aria-label="Edit persona"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-1 1-3.828-3.828 1-1a2 2 0 012.828 0zM2 13.586l9.586-9.586 3.828 3.828L5.828 17.414H2v-3.828z"/></svg></button></div><p>${persona.description || 'No description provided.'}</p></div>`;
	messagesContainer.appendChild(detail);
	const editBtn = detail.querySelector('.persona-edit-btn');
	if (editBtn) {
		editBtn.addEventListener('click', () => {
			showPersonaEditor(persona);
		});
	}
}

function normalizePersonaEditDraft(raw) {
	const source = raw && typeof raw === 'object' ? raw : {};
	const coverFit = source.cover_art_fit && typeof source.cover_art_fit === 'object' ? source.cover_art_fit : {};
	const iconFit = source.icon_fit && typeof source.icon_fit === 'object' ? source.icon_fit : {};
	return {
		name: `${source.name || ''}`,
		description: `${source.description || ''}`,
		cover_art: `${source.cover_art || ''}`,
		icon_art: `${source.icon_art || ''}`,
		cover_art_fit: {
			size: Number.isFinite(coverFit.size) ? coverFit.size : 100,
			x: Number.isFinite(coverFit.x) ? coverFit.x : 50,
			y: Number.isFinite(coverFit.y) ? coverFit.y : 50
		},
		icon_fit: {
			size: Number.isFinite(iconFit.size) ? iconFit.size : 100,
			x: Number.isFinite(iconFit.x) ? iconFit.x : 50,
			y: Number.isFinite(iconFit.y) ? iconFit.y : 50
		}
	};
}

function applyPersonaEditDraft(persona, rawDraft) {
	if (!persona || !rawDraft || typeof rawDraft !== 'object') {
		return persona;
	}
	const draft = normalizePersonaEditDraft(rawDraft);
	return {
		...persona,
		name: draft.name || persona.name,
		description: draft.description,
		cover_art: draft.cover_art || persona.cover_art,
		icon_art: draft.icon_art || persona.icon_art,
		cover_art_fit: draft.cover_art_fit,
		icon_fit: draft.icon_fit,
		__draftApplied: true
	};
}

function ensurePersonaEditDraftLoaded(personaId) {
	if (!personaId) {
		return Promise.resolve(null);
	}
	return fetch('/api/persona/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'load_edit', persona_id: personaId })
	})
		.then(r => r.json())
		.then(result => {
			if (!result || !result.success || !result.draft || typeof result.draft !== 'object') {
				return null;
			}
			return normalizePersonaEditDraft(result.draft);
		})
		.catch(() => null);
}

function savePersonaEditDraft(personaId, draft) {
	if (!personaId || !draft || typeof draft !== 'object') {
		return;
	}
	fetch('/api/persona/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'save_edit', persona_id: personaId, draft: normalizePersonaEditDraft(draft) })
	}).catch(() => {});
}

function clearPersonaEditDraft(personaId) {
	if (!personaId) {
		return;
	}
	fetch('/api/persona/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'clear_edit', persona_id: personaId })
	}).catch(() => {});
}

function collectPersonaEditorDraft(personaId) {
	if (!personaId) {
		return null;
	}
	const nameInput = document.getElementById('persona-name');
	const descriptionInput = document.getElementById('persona-description');
	const coverArtInput = document.getElementById('cover-art-value');
	const iconArtInput = document.getElementById('icon-art-value');
	const coverArtFit = readPersonaFitInputs('cover');
	const iconFit = readPersonaFitInputs('icon');

	return normalizePersonaEditDraft({
		name: nameInput ? nameInput.value : (currentPersonaInfo?.name || ''),
		description: descriptionInput ? descriptionInput.value : (currentPersonaInfo?.description || ''),
		cover_art: coverArtInput ? coverArtInput.value : (currentPersonaInfo?.cover_art || ''),
		icon_art: iconArtInput ? iconArtInput.value : (currentPersonaInfo?.icon_art || ''),
		cover_art_fit: coverArtFit,
		icon_fit: iconFit
	});
}

function persistPersonaEditorDraft(personaId) {
	const draft = collectPersonaEditorDraft(personaId);
	if (draft) {
		savePersonaEditDraft(personaId, draft);
	}
}

function showPersonaEditor(persona) {
	if (persona && persona.id && !persona.__draftApplied) {
		ensurePersonaEditDraftLoaded(persona.id).then(draft => {
			const effectivePersona = draft ? applyPersonaEditDraft(persona, draft) : { ...persona, __draftApplied: true };
			showPersonaEditor(effectivePersona);
		});
		return;
	}

	chatHeader.innerHTML = `<div><div class="chat-title">Edit ${persona.name}</div><div class="chat-subtitle">Persona Editor</div></div>`;
	messagesContainer.innerHTML = '';
	const editor = document.createElement('div');
	editor.className = 'persona-editor';
	
	const isUser = persona.id === 'User';
	const initial = isUser ? 'U' : persona.name[0].toUpperCase();
	const defaultGrad = isUser ? 'linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%)' : 'linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%)';
	
	const coverStyle = persona.cover_art
		? buildImageStyle(persona.cover_art, persona.cover_art_fit || null)
		: `background:${defaultGrad};`;
	const iconStyle = persona.icon_art
		? buildImageStyle(persona.icon_art, persona.icon_fit || null)
		: `background:${defaultGrad};`;
	
	const coverContent = persona.cover_art ? '' : `<div>${initial}</div>`;
	const iconContent = persona.icon_art ? '' : `<div style="font-size: 24px;">${initial}</div>`;
	const deleteButton = persona.id === 'User'
		? ''
		: `<button type="button" class="action-btn delete-btn" onclick="deletePersona('${persona.id}')">Delete</button>`;
	
	editor.innerHTML = `
		<div class="editor-grid masonry-grid">
			<div class="editor-section">
				<h3>Persona Details</h3>
				<div class="form-group">
					<label>Name</label>
					<input type="text" id="persona-name" class="text-input" value="${persona.name || ''}">
				</div>
				<div class="form-group">
					<label>Description <span class="token-badge" id="persona-desc-token-count">0 tok</span></label>
					<textarea id="persona-description" class="text-input" rows="3">${persona.description || ''}</textarea>
				</div>
			</div>
			
			<div class="editor-section">
				<div class="preview-with-controls">
					<div class="preview-container">
						<h3>Cover Art</h3>
						<div class="detail-cover" id="cover-preview" style="${coverStyle}">${coverContent}</div>
						<input type="hidden" id="cover-art-value" value="${persona.cover_art || ''}">
					</div>
					<div class="controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item">
								<label>Zoom (%)</label>
								<input type="range" id="cover-zoom" min="50" max="300" value="${(persona.cover_art_fit?.size || 100)}" class="slider">
								<span id="cover-zoom-val">${(persona.cover_art_fit?.size || 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="cover-posX" min="0" max="100" value="${(persona.cover_art_fit?.x || 50)}" class="slider">
								<span id="cover-posX-val">${(persona.cover_art_fit?.x || 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="cover-posY" min="0" max="100" value="${(persona.cover_art_fit?.y || 50)}" class="slider">
								<span id="cover-posY-val">${(persona.cover_art_fit?.y || 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
			
			<div class="editor-section">
				<h3>Images</h3>
				<div class="form-group">
					<input type="file" id="persona-image-upload" multiple accept="image/*" style="display:none;">
					<button type="button" class="action-btn" onclick="document.getElementById('persona-image-upload').click()">Upload Images</button>
				</div>
				<div id="persona-image-gallery" class="image-gallery"></div>
			</div>
			
			<div class="editor-section">
				<div class="preview-with-controls">
					<div class="preview-container">
						<h3>Icon</h3>
						<div class="detail-icon" id="icon-preview" style="${iconStyle}">${iconContent}</div>
						<input type="hidden" id="icon-art-value" value="${persona.icon_art || ''}">
					</div>
					<div class="controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item">
								<label>Zoom (%)</label>
								<input type="range" id="icon-zoom" min="50" max="300" value="${(persona.icon_fit?.size || 100)}" class="slider">
								<span id="icon-zoom-val">${(persona.icon_fit?.size || 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="icon-posX" min="0" max="100" value="${(persona.icon_fit?.x || 50)}" class="slider">
								<span id="icon-posX-val">${(persona.icon_fit?.x || 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="icon-posY" min="0" max="100" value="${(persona.icon_fit?.y || 50)}" class="slider">
								<span id="icon-posY-val">${(persona.icon_fit?.y || 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<div class="editor-footer">
			<button type="button" class="action-btn cancel-btn" id="persona-edit-cancel">Cancel</button>
			${deleteButton}
			<button type="button" class="action-btn save-btn" onclick="savePersonaEdits('${persona.id}')">Save</button>
		</div>
	`;
	messagesContainer.appendChild(editor);
	makeSectionsCollapsible(editor, '.editor-section', `persona-edit:${persona.id || persona.name || 'unknown'}`);
	scheduleMasonryRefresh(editor);
	
	// Load images
	loadPersonaImages(persona);
	
	// Bind image adjustments
	bindPersonaImageAdjustments(persona);
	
	// Bind image upload
	document.getElementById('persona-image-upload').addEventListener('change', (e) => {
		uploadPersonaImages(persona.id, e.target.files);
	});

	const descriptionInput = document.getElementById('persona-description');
	const nameInput = document.getElementById('persona-name');
	if (nameInput) {
		nameInput.addEventListener('input', () => persistPersonaEditorDraft(persona.id));
	}
	if (descriptionInput) {
		descriptionInput.addEventListener('input', () => {
			refreshPersonaEditorTokenCounter();
			persistPersonaEditorDraft(persona.id);
		});
	}

	const cancelBtn = document.getElementById('persona-edit-cancel');
	if (cancelBtn) {
		cancelBtn.addEventListener('click', () => {
			clearPersonaEditDraft(persona.id);
			showPersonaDetail(currentPersonaInfo);
		});
	}

	persistPersonaEditorDraft(persona.id);
	refreshPersonaEditorTokenCounter();
}

function refreshPersonaEditorTokenCounter() {
	const descriptionInput = document.getElementById('persona-description');
	const badge = document.getElementById('persona-desc-token-count');
	if (!badge) {
		return;
	}
	badge.textContent = `${estimateUiTokens(descriptionInput ? descriptionInput.value : '')} tok`;
}

function loadPersonaImages(persona) {
	fetch('/api/persona/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'list', persona_id: persona.id })
	})
	.then(r => r.json())
	.then(data => {
		const gallery = document.getElementById('persona-image-gallery');
		const images = (data && data.items) ? data.items : [];
		if (!images || images.length === 0) {
			gallery.innerHTML = '<p style="color: #999; grid-column: 1/-1;">No images yet</p>';
			return;
		}
		gallery.innerHTML = '';
		images.forEach(img => {
			const card = document.createElement('div');
			card.className = 'image-card';
			card.innerHTML = `
				<div class="image-thumb" style="background-image: url('${img.url}'); background-size: cover; background-position: center;"></div>
				<div class="image-actions">
					<button class="img-action-btn" onclick="setPersonaCoverArt('${persona.id}', '${img.name}')" title="Set as cover">🖼️</button>
					<button class="img-action-btn" onclick="setPersonaIcon('${persona.id}', '${img.name}')" title="Set as icon">👤</button>
					<button class="img-action-btn delete-btn" onclick="deletePersonaImage('${persona.id}', '${img.name}')" title="Delete">🗑️</button>
				</div>
			`;
			gallery.appendChild(card);
		});
	});
}

function uploadPersonaImages(personaId, files) {
	if (!files || files.length === 0) {
		return;
	}
	const uploads = Array.from(files).map(file => new Promise(resolve => {
		const reader = new FileReader();
		reader.onload = () => {
			fetch('/api/persona/images', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'upload', persona_id: personaId, filename: file.name, data_url: reader.result })
			})
				.then(() => resolve());
		};
		reader.readAsDataURL(file);
	}));
	Promise.all(uploads).then(() => {
		loadPersonaImages(currentPersonaInfo);
	});
}

function deletePersonaImage(personaId, filename) {
	if (!confirm(`Delete ${filename}?`)) return;
	fetch('/api/persona/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'delete', persona_id: personaId, filename })
	})
	.then(r => r.json())
	.then(() => {
		loadPersonaImages(currentPersonaInfo); // Reload
	});
}

function setPersonaCoverArt(personaId, filename) {
	fetch('/api/persona/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'set_coverart', persona_id: personaId, filename })
	})
	.then(r => r.json())
	.then(result => {
		if (result && result.persona) {
			currentPersonaInfo = result.persona;
			document.getElementById('cover-art-value').value = `${currentPersonaInfo.cover_art || ''}`;
			document.getElementById('cover-preview').style.cssText = buildImageStyle(currentPersonaInfo.cover_art, currentPersonaInfo.cover_art_fit || null);
			persistPersonaEditorDraft(personaId);
			loadPersonaImages(currentPersonaInfo);
		}
	});
}

function setPersonaIcon(personaId, filename) {
	fetch('/api/persona/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'set_icon', persona_id: personaId, filename })
	})
	.then(r => r.json())
	.then(result => {
		if (result && result.persona) {
			currentPersonaInfo = result.persona;
			document.getElementById('icon-art-value').value = `${currentPersonaInfo.icon_art || ''}`;
			document.getElementById('icon-preview').style.cssText = buildImageStyle(currentPersonaInfo.icon_art, currentPersonaInfo.icon_fit || null);
			persistPersonaEditorDraft(personaId);
			loadPersonaImages(currentPersonaInfo);
		}
	});
}

function bindPersonaImageAdjustments(persona) {
	const resolveCoverArt = () => {
		const hidden = document.getElementById('cover-art-value');
		const hiddenValue = hidden ? `${hidden.value || ''}`.trim() : '';
		if (hiddenValue) {
			return hiddenValue;
		}
		if (currentPersonaInfo && currentPersonaInfo.cover_art) {
			return `${currentPersonaInfo.cover_art}`;
		}
		return `${(persona && persona.cover_art) || ''}`;
	};

	const resolveIconArt = () => {
		const hidden = document.getElementById('icon-art-value');
		const hiddenValue = hidden ? `${hidden.value || ''}`.trim() : '';
		if (hiddenValue) {
			return hiddenValue;
		}
		if (currentPersonaInfo && currentPersonaInfo.icon_art) {
			return `${currentPersonaInfo.icon_art}`;
		}
		return `${(persona && persona.icon_art) || ''}`;
	};

	// Cover art adjustments
	const updateCoverPreview = () => {
		const zoom = parseInt(document.getElementById('cover-zoom').value);
		const x = parseInt(document.getElementById('cover-posX').value);
		const y = parseInt(document.getElementById('cover-posY').value);
		document.getElementById('cover-zoom-val').textContent = zoom + '%';
		document.getElementById('cover-posX-val').textContent = x + '%';
		document.getElementById('cover-posY-val').textContent = y + '%';
		const fit = { size: zoom, x, y };
		document.getElementById('cover-preview').style.cssText = buildImageStyle(resolveCoverArt(), fit);
		persistPersonaEditorDraft(persona?.id);
	};
	
	document.getElementById('cover-zoom').addEventListener('input', updateCoverPreview);
	document.getElementById('cover-posX').addEventListener('input', updateCoverPreview);
	document.getElementById('cover-posY').addEventListener('input', updateCoverPreview);
	
	// Icon adjustments
	const updateIconPreview = () => {
		const zoom = parseInt(document.getElementById('icon-zoom').value);
		const x = parseInt(document.getElementById('icon-posX').value);
		const y = parseInt(document.getElementById('icon-posY').value);
		document.getElementById('icon-zoom-val').textContent = zoom + '%';
		document.getElementById('icon-posX-val').textContent = x + '%';
		document.getElementById('icon-posY-val').textContent = y + '%';
		const fit = { size: zoom, x, y };
		document.getElementById('icon-preview').style.cssText = buildImageStyle(resolveIconArt(), fit);
		persistPersonaEditorDraft(persona?.id);
	};
	
	document.getElementById('icon-zoom').addEventListener('input', updateIconPreview);
	document.getElementById('icon-posX').addEventListener('input', updateIconPreview);
	document.getElementById('icon-posY').addEventListener('input', updateIconPreview);
}

function readPersonaFitInputs(prefix) {
	const zoomInput = document.getElementById(prefix + '-zoom');
	const posXInput = document.getElementById(prefix + '-posX');
	const posYInput = document.getElementById(prefix + '-posY');
	const fallback = (currentPersonaInfo && currentPersonaInfo[`${prefix}_fit`]) || { size: 100, x: 50, y: 50 };
	const size = Number.parseInt(zoomInput ? zoomInput.value : '', 10);
	const x = Number.parseInt(posXInput ? posXInput.value : '', 10);
	const y = Number.parseInt(posYInput ? posYInput.value : '', 10);
	return {
		size: Number.isFinite(size) ? size : (Number.isFinite(fallback.size) ? fallback.size : 100),
		x: Number.isFinite(x) ? x : (Number.isFinite(fallback.x) ? fallback.x : 50),
		y: Number.isFinite(y) ? y : (Number.isFinite(fallback.y) ? fallback.y : 50)
	};
}

function savePersonaEdits(personaId) {
	const name = document.getElementById('persona-name').value || currentPersonaInfo.name;
	const description = document.getElementById('persona-description').value || '';
	const coverArtFit = readPersonaFitInputs('cover');
	const iconFit = readPersonaFitInputs('icon');
	
	const payload = {
		action: 'update',
		persona_id: personaId,
		name,
		description,
		cover_art_fit: coverArtFit,
		icon_fit: iconFit
	};
	
	fetch('/api/personas', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	})
	.then(r => r.json())
	.then(data => {
		const success = !!(data && data.success);
		if (success) {
			const updatedPersona = (data && data.persona) ? data.persona : null;
			currentPersonaInfo = updatedPersona || { ...currentPersonaInfo, name, description, cover_art_fit: coverArtFit, icon_fit: iconFit };
			clearPersonaEditDraft(personaId);
			showPersonaEditor(currentPersonaInfo);
			if (typeof showToast === 'function') {
				showToast('Persona saved.', 'success');
			}
		} else if (typeof showToast === 'function') {
			showToast((data && data.message) ? data.message : 'Failed to save persona.', 'error');
		}
	});
}

function loadDefaultPersona() {
	fetch('/api/personas')
		.then(r => r.json())
		.then(personas => {
			const defaultPersona = personas.find(p => p.id === 'User') || personas[0];
			if (defaultPersona) {
				currentPersonaInfo = defaultPersona;
			}
		})
		.catch(() => {
			currentPersonaInfo = { name: 'User', cover_art: '' };
		});
}

function deletePersona(personaId) {
	if (!personaId) {
		return;
	}
	if (personaId === 'User') {
		alert('Default User persona cannot be deleted.');
		return;
	}
	const personaName = (currentPersonaInfo && currentPersonaInfo.id === personaId && currentPersonaInfo.name) ? currentPersonaInfo.name : personaId;
	const confirmed = confirm(`Delete persona "${personaName}" permanently?`);
	if (!confirmed) {
		return;
	}
	const typedName = prompt(`Type the persona name to confirm deletion: ${personaName}`);
	if (typedName === null) {
		return;
	}
	if (typedName.trim() !== personaName) {
		alert('Deletion cancelled: persona name did not match.');
		return;
	}
	fetch('/api/personas', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'delete', persona_id: personaId })
	})
		.then(r => r.json())
		.then(result => {
			if (!result || !result.success) {
				alert((result && result.message) || 'Failed to delete persona');
				return;
			}
			if (currentPersonaInfo && currentPersonaInfo.id === personaId) {
				currentPersonaInfo = null;
			}
			const personasNavItem = Array.from(navItems || []).find(item => item.dataset && item.dataset.view === 'personas');
			if (personasNavItem) {
				personasNavItem.click();
			} else {
				showPersonas();
			}
		});
}

let personaCreationDraft = null;
let personaCreationDraftLoadPromise = null;

function getEmptyPersonaCreationDraft() {
	return {
		name: '',
		description: '',
		cover_art: '',
		icon_art: '',
		cover_art_fit: { size: 100, x: 50, y: 50 },
		icon_fit: { size: 100, x: 50, y: 50 },
		images: [],
		cover_image_name: '',
		icon_image_name: ''
	};
}

function normalizePersonaCreationDraft(raw) {
	const defaults = getEmptyPersonaCreationDraft();
	const draft = raw && typeof raw === 'object' ? raw : {};
	return {
		...defaults,
		...draft,
		cover_art_fit: {
			size: Number.isFinite(draft?.cover_art_fit?.size) ? draft.cover_art_fit.size : defaults.cover_art_fit.size,
			x: Number.isFinite(draft?.cover_art_fit?.x) ? draft.cover_art_fit.x : defaults.cover_art_fit.x,
			y: Number.isFinite(draft?.cover_art_fit?.y) ? draft.cover_art_fit.y : defaults.cover_art_fit.y
		},
		icon_fit: {
			size: Number.isFinite(draft?.icon_fit?.size) ? draft.icon_fit.size : defaults.icon_fit.size,
			x: Number.isFinite(draft?.icon_fit?.x) ? draft.icon_fit.x : defaults.icon_fit.x,
			y: Number.isFinite(draft?.icon_fit?.y) ? draft.icon_fit.y : defaults.icon_fit.y
		},
		images: Array.isArray(draft?.images) ? draft.images : []
	};
}

function ensurePersonaCreationDraftLoaded(forceReload = false) {
	if (!forceReload && personaCreationDraft) {
		return Promise.resolve(personaCreationDraft);
	}
	if (!forceReload && personaCreationDraftLoadPromise) {
		return personaCreationDraftLoadPromise;
	}

	personaCreationDraftLoadPromise = fetch('/api/persona/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'load' })
	})
		.then(r => r.json())
		.then(result => {
			const serverDraft = result && result.success ? result.draft : null;
			personaCreationDraft = normalizePersonaCreationDraft(serverDraft || getEmptyPersonaCreationDraft());
			return personaCreationDraft;
		})
		.catch(() => {
			personaCreationDraft = normalizePersonaCreationDraft(getEmptyPersonaCreationDraft());
			return personaCreationDraft;
		})
		.finally(() => {
			personaCreationDraftLoadPromise = null;
		});

	return personaCreationDraftLoadPromise;
}

function savePersonaCreationDraft() {
	if (!personaCreationDraft) {
		return true;
	}
	fetch('/api/persona/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'save', draft: personaCreationDraft })
	})
		.then(r => r.json())
		.then(result => {
			if (!result || !result.success) {
				if (typeof showToast === 'function') {
					showToast('Failed to save persona draft on disk.', 'warning', 2400);
				}
			}
		})
		.catch(() => {
			if (typeof showToast === 'function') {
				showToast('Failed to save persona draft on disk.', 'warning', 2400);
			}
		});
	return true;
}

function clearPersonaCreationDraft() {
	personaCreationDraft = getEmptyPersonaCreationDraft();
	fetch('/api/persona/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'clear' })
	}).catch(() => {});
}

function setPersonaCreationPreviewStyle(targetId, art, fit, fallback) {
	const target = document.getElementById(targetId);
	if (!target) {
		return;
	}
	if (art) {
		target.style.cssText = buildImageStyle(art, fit);
		target.textContent = '';
		return;
	}
	target.style.cssText = fallback;
	target.textContent = personaCreationDraft.name ? personaCreationDraft.name[0].toUpperCase() : 'P';
}

function updatePersonaCreationDraftFromForm() {
	if (!personaCreationDraft) {
		return;
	}
	const nameInput = document.getElementById('create-persona-name');
	const descInput = document.getElementById('create-persona-description');
	const coverZoom = document.getElementById('create-persona-cover-zoom');
	const coverPosX = document.getElementById('create-persona-cover-posX');
	const coverPosY = document.getElementById('create-persona-cover-posY');
	const iconZoom = document.getElementById('create-persona-icon-zoom');
	const iconPosX = document.getElementById('create-persona-icon-posX');
	const iconPosY = document.getElementById('create-persona-icon-posY');

	if (nameInput) {
		personaCreationDraft.name = nameInput.value;
	}
	if (descInput) {
		personaCreationDraft.description = descInput.value;
	}
	if (coverZoom && coverPosX && coverPosY) {
		personaCreationDraft.cover_art_fit = {
			size: parseInt(coverZoom.value, 10),
			x: parseInt(coverPosX.value, 10),
			y: parseInt(coverPosY.value, 10)
		};
	}
	if (iconZoom && iconPosX && iconPosY) {
		personaCreationDraft.icon_fit = {
			size: parseInt(iconZoom.value, 10),
			x: parseInt(iconPosX.value, 10),
			y: parseInt(iconPosY.value, 10)
		};
	}
	savePersonaCreationDraft();
}

function renderPersonaCreationImageGallery() {
	const gallery = document.getElementById('create-persona-image-gallery');
	if (!gallery || !personaCreationDraft) {
		return;
	}
	if (!personaCreationDraft.images.length) {
		gallery.innerHTML = '<p style="color: #999; grid-column: 1/-1;">No images yet</p>';
		return;
	}
	gallery.innerHTML = '';
	personaCreationDraft.images.forEach(img => {
		const card = document.createElement('div');
		card.className = 'image-card';
		card.innerHTML = `
			<div class="image-thumb" style="background-image: url('${img.data_url}'); background-size: cover; background-position: center;"></div>
			<div class="image-actions">
				<button class="img-action-btn create-persona-img-cover" type="button" title="Set as cover">🖼️</button>
				<button class="img-action-btn create-persona-img-icon" type="button" title="Set as icon">👤</button>
				<button class="img-action-btn delete-btn create-persona-img-delete" type="button" title="Delete">🗑️</button>
			</div>
		`;
		card.querySelector('.create-persona-img-cover').addEventListener('click', () => {
			personaCreationDraft.cover_art = img.data_url;
			personaCreationDraft.cover_image_name = img.name;
			savePersonaCreationDraft();
			setPersonaCreationPreviewStyle('create-persona-cover-preview', personaCreationDraft.cover_art, personaCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
		});
		card.querySelector('.create-persona-img-icon').addEventListener('click', () => {
			personaCreationDraft.icon_art = img.data_url;
			personaCreationDraft.icon_image_name = img.name;
			savePersonaCreationDraft();
			setPersonaCreationPreviewStyle('create-persona-icon-preview', personaCreationDraft.icon_art, personaCreationDraft.icon_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
		});
		card.querySelector('.create-persona-img-delete').addEventListener('click', () => {
			personaCreationDraft.images = personaCreationDraft.images.filter(item => item.name !== img.name);
			if (personaCreationDraft.cover_image_name === img.name) {
				personaCreationDraft.cover_image_name = '';
				personaCreationDraft.cover_art = '';
			}
			if (personaCreationDraft.icon_image_name === img.name) {
				personaCreationDraft.icon_image_name = '';
				personaCreationDraft.icon_art = '';
			}
			savePersonaCreationDraft();
			renderPersonaCreationImageGallery();
			setPersonaCreationPreviewStyle('create-persona-cover-preview', personaCreationDraft.cover_art, personaCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
			setPersonaCreationPreviewStyle('create-persona-icon-preview', personaCreationDraft.icon_art, personaCreationDraft.icon_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
		});
		gallery.appendChild(card);
	});
}

function uploadPersonaCreationImages(files) {
	if (!files || files.length === 0 || !personaCreationDraft) {
		return;
	}
	const uploads = Array.from(files).map(file => new Promise(resolve => {
		const reader = new FileReader();
		reader.onload = () => {
			const ext = (file.name && file.name.split('.').pop()) || 'png';
			const baseName = (file.name || `persona_image_${Date.now()}.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');
			let candidate = baseName;
			let idx = 1;
			const existing = new Set((personaCreationDraft.images || []).map(img => img.name));
			while (existing.has(candidate)) {
				const dot = baseName.lastIndexOf('.');
				const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
				const suffix = dot > 0 ? baseName.slice(dot) : '';
				candidate = `${stem}_${idx}${suffix}`;
				idx += 1;
			}
			personaCreationDraft.images.push({ name: candidate, data_url: reader.result });
			resolve();
		};
		reader.readAsDataURL(file);
	}));
	Promise.all(uploads).then(() => {
		savePersonaCreationDraft();
		renderPersonaCreationImageGallery();
	});
}

function bindPersonaCreationAdjustments() {
	const bindRange = (id, callback) => {
		const el = document.getElementById(id);
		if (!el) {
			return;
		}
		el.addEventListener('input', callback);
	};

	const updateCover = () => {
		updatePersonaCreationDraftFromForm();
		document.getElementById('create-persona-cover-zoom-val').textContent = `${personaCreationDraft.cover_art_fit.size}%`;
		document.getElementById('create-persona-cover-posX-val').textContent = `${personaCreationDraft.cover_art_fit.x}%`;
		document.getElementById('create-persona-cover-posY-val').textContent = `${personaCreationDraft.cover_art_fit.y}%`;
		setPersonaCreationPreviewStyle('create-persona-cover-preview', personaCreationDraft.cover_art, personaCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
	};

	const updateIcon = () => {
		updatePersonaCreationDraftFromForm();
		document.getElementById('create-persona-icon-zoom-val').textContent = `${personaCreationDraft.icon_fit.size}%`;
		document.getElementById('create-persona-icon-posX-val').textContent = `${personaCreationDraft.icon_fit.x}%`;
		document.getElementById('create-persona-icon-posY-val').textContent = `${personaCreationDraft.icon_fit.y}%`;
		setPersonaCreationPreviewStyle('create-persona-icon-preview', personaCreationDraft.icon_art, personaCreationDraft.icon_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
	};

	['create-persona-cover-zoom', 'create-persona-cover-posX', 'create-persona-cover-posY'].forEach(id => bindRange(id, updateCover));
	['create-persona-icon-zoom', 'create-persona-icon-posX', 'create-persona-icon-posY'].forEach(id => bindRange(id, updateIcon));
}

function fetchPersonaUrlAsDataUrl(url) {
	if (!url) {
		return Promise.resolve('');
	}
	if (typeof fetchUrlAsDataUrl === 'function') {
		return fetchUrlAsDataUrl(url).catch(() => '');
	}
	return fetch(url)
		.then(response => {
			if (!response.ok) {
				throw new Error('Failed to fetch image');
			}
			return response.blob();
		})
		.then(blob => new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(new Error('Failed to convert image'));
			reader.readAsDataURL(blob);
		}))
		.catch(() => '');
}

function getFilenameFromUrl(url, fallbackName = '') {
	if (!url) {
		return fallbackName;
	}
	try {
		const normalized = `${url}`.split('?')[0];
		const parts = normalized.split('/').filter(Boolean);
		return decodeURIComponent(parts[parts.length - 1] || fallbackName);
	} catch (_error) {
		return fallbackName;
	}
}

function ensureUniquePersonaDraftImageName(images, fileName) {
	const sanitized = (fileName || `persona_image_${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');
	const existing = new Set((images || []).map(img => img.name));
	if (!existing.has(sanitized)) {
		return sanitized;
	}
	const dot = sanitized.lastIndexOf('.');
	const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
	const suffix = dot > 0 ? sanitized.slice(dot) : '';
	let idx = 1;
	let candidate = `${stem}_${idx}${suffix}`;
	while (existing.has(candidate)) {
		idx += 1;
		candidate = `${stem}_${idx}${suffix}`;
	}
	return candidate;
}

function loadClonePersonaOptions(menuEl) {
	if (!menuEl) {
		return;
	}
	menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Loading personas...</button>';
	fetch('/api/personas')
		.then(r => r.json())
		.then(personas => {
			const list = Array.isArray(personas) ? personas : [];
			if (!list.length) {
				menuEl.innerHTML = '<button class="persona-option" type="button" disabled>No personas available</button>';
				return;
			}
			menuEl.innerHTML = '';
			list.forEach(persona => {
				const option = document.createElement('button');
				option.type = 'button';
				option.className = 'persona-option';
				const icon = document.createElement('span');
				icon.className = 'persona-option-icon';
				if (persona.icon_art || persona.cover_art) {
					icon.style.cssText = buildImageStyle(persona.icon_art || persona.cover_art, persona.icon_fit || persona.cover_art_fit || null);
					icon.textContent = '';
				} else {
					icon.textContent = (persona.name || 'P')[0].toUpperCase();
				}
				const text = document.createElement('span');
				text.className = 'persona-option-text';
				text.textContent = persona.name || persona.id;
				option.appendChild(icon);
				option.appendChild(text);
				option.addEventListener('click', () => {
					cloneExistingPersonaIntoDraft(persona.id);
					menuEl.classList.add('hidden');
				});
				menuEl.appendChild(option);
			});
		})
		.catch(() => {
			menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Failed to load personas</button>';
		});
}

function cloneExistingPersonaIntoDraft(personaId) {
	if (!personaId) {
		return;
	}
	Promise.all([
		fetch('/api/personas').then(r => r.json()),
		fetch('/api/persona/images', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'list', persona_id: personaId })
		}).then(r => r.json())
	])
		.then(async ([personasResponse, imagesResponse]) => {
			const personas = Array.isArray(personasResponse) ? personasResponse : [];
			const persona = personas.find(item => item.id === personaId);
			if (!persona) {
				alert('Failed to clone persona.');
				return;
			}

			const imageItems = (imagesResponse && Array.isArray(imagesResponse.items)) ? imagesResponse.items : [];
			const convertedImages = await Promise.all(imageItems.map(async (img) => {
				const data_url = await fetchPersonaUrlAsDataUrl(img.url);
				if (!data_url) {
					return null;
				}
				return { name: img.name, data_url };
			}));
			const images = convertedImages.filter(Boolean);

			const ensureImageFromUrl = async (url, fallbackName) => {
				if (!url) {
					return { name: '', data_url: '' };
				}
				const candidateName = getFilenameFromUrl(url, fallbackName);
				const existing = images.find(img => img.name === candidateName);
				if (existing) {
					return existing;
				}
				const data_url = await fetchPersonaUrlAsDataUrl(url);
				if (!data_url) {
					return { name: '', data_url: '' };
				}
				const uniqueName = ensureUniquePersonaDraftImageName(images, candidateName || fallbackName);
				const created = { name: uniqueName, data_url };
				images.push(created);
				return created;
			};

			const coverImage = await ensureImageFromUrl(persona.cover_art, 'cover.png');
			const iconImage = await ensureImageFromUrl(persona.icon_art, 'icon.png');

			personaCreationDraft = normalizePersonaCreationDraft({
				name: `${persona.name || persona.id}_copy`,
				description: persona.description || '',
				cover_art: coverImage.data_url || '',
				icon_art: iconImage.data_url || '',
				cover_art_fit: persona.cover_art_fit || { size: 100, x: 50, y: 50 },
				icon_fit: persona.icon_fit || { size: 100, x: 50, y: 50 },
				images,
				cover_image_name: coverImage.name || '',
				icon_image_name: iconImage.name || ''
			});
			savePersonaCreationDraft();
			renderPersonaCreationView();
		})
		.catch(() => {
			alert('Failed to clone persona.');
		});
}

function showPersonaCreation() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Create Persona</div><div class="chat-subtitle">Add a new user persona</div></div>';
	ensurePersonaCreationDraftLoaded().then(() => {
		renderPersonaCreationView();
	});
}

function renderPersonaCreationView() {
	personaCreationDraft = normalizePersonaCreationDraft(personaCreationDraft || getEmptyPersonaCreationDraft());
	messagesContainer.innerHTML = '';
	const editor = document.createElement('div');
	editor.className = 'persona-editor';
	const initial = personaCreationDraft.name ? personaCreationDraft.name[0].toUpperCase() : 'P';

	editor.innerHTML = `
		<div class="editor-grid masonry-grid">
			<div class="editor-section">
				<div class="detail-title-row"><h3>Persona Details</h3><div class="persona-picker"><button class="btn btn-secondary persona-picker-btn" type="button" id="clonePersonaBtn">Clone Existing Persona</button><div class="persona-picker-menu hidden" id="clonePersonaMenu"></div></div></div>
				<div class="form-group">
					<label>Name</label>
					<input type="text" id="create-persona-name" class="text-input" value="${personaCreationDraft.name || ''}">
				</div>
				<div class="form-group">
					<label>Description <span class="token-badge" id="create-persona-desc-token-count">0 tok</span></label>
					<textarea id="create-persona-description" class="text-input" rows="4">${personaCreationDraft.description || ''}</textarea>
				</div>
			</div>

			<div class="editor-section">
				<div class="preview-with-controls">
					<div class="preview-container">
						<h3>Cover Art</h3>
						<div class="detail-cover" id="create-persona-cover-preview">${personaCreationDraft.cover_art ? '' : initial}</div>
					</div>
					<div class="controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item"><label>Zoom (%)</label><input type="range" id="create-persona-cover-zoom" min="50" max="300" value="${(personaCreationDraft.cover_art_fit?.size || 100)}" class="slider"><span id="create-persona-cover-zoom-val">${(personaCreationDraft.cover_art_fit?.size || 100)}%</span></div>
							<div class="adjust-item"><label>Position X (%)</label><input type="range" id="create-persona-cover-posX" min="0" max="100" value="${(personaCreationDraft.cover_art_fit?.x || 50)}" class="slider"><span id="create-persona-cover-posX-val">${(personaCreationDraft.cover_art_fit?.x || 50)}%</span></div>
							<div class="adjust-item"><label>Position Y (%)</label><input type="range" id="create-persona-cover-posY" min="0" max="100" value="${(personaCreationDraft.cover_art_fit?.y || 50)}" class="slider"><span id="create-persona-cover-posY-val">${(personaCreationDraft.cover_art_fit?.y || 50)}%</span></div>
						</div>
					</div>
				</div>
			</div>

			<div class="editor-section">
				<h3>Images</h3>
				<div class="form-group">
					<input type="file" id="create-persona-image-upload" multiple accept="image/*" style="display:none;">
					<button type="button" class="action-btn" id="create-persona-upload-btn">Upload Images</button>
				</div>
				<div id="create-persona-image-gallery" class="image-gallery"></div>
			</div>

			<div class="editor-section">
				<div class="preview-with-controls">
					<div class="preview-container">
						<h3>Icon</h3>
						<div class="detail-icon" id="create-persona-icon-preview">${personaCreationDraft.icon_art ? '' : `<div style="font-size: 24px;">${initial}</div>`}</div>
					</div>
					<div class="controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item"><label>Zoom (%)</label><input type="range" id="create-persona-icon-zoom" min="50" max="300" value="${(personaCreationDraft.icon_fit?.size || 100)}" class="slider"><span id="create-persona-icon-zoom-val">${(personaCreationDraft.icon_fit?.size || 100)}%</span></div>
							<div class="adjust-item"><label>Position X (%)</label><input type="range" id="create-persona-icon-posX" min="0" max="100" value="${(personaCreationDraft.icon_fit?.x || 50)}" class="slider"><span id="create-persona-icon-posX-val">${(personaCreationDraft.icon_fit?.x || 50)}%</span></div>
							<div class="adjust-item"><label>Position Y (%)</label><input type="range" id="create-persona-icon-posY" min="0" max="100" value="${(personaCreationDraft.icon_fit?.y || 50)}" class="slider"><span id="create-persona-icon-posY-val">${(personaCreationDraft.icon_fit?.y || 50)}%</span></div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<div class="editor-footer">
			<button type="button" class="action-btn cancel-btn" id="create-persona-cancel">Cancel</button>
			<button type="button" class="action-btn save-btn" id="create-persona-save">Create Persona</button>
		</div>
	`;

	messagesContainer.appendChild(editor);
	makeSectionsCollapsible(editor, '.editor-section', 'persona-create');
	scheduleMasonryRefresh(editor);

	setPersonaCreationPreviewStyle('create-persona-cover-preview', personaCreationDraft.cover_art, personaCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
	setPersonaCreationPreviewStyle('create-persona-icon-preview', personaCreationDraft.icon_art, personaCreationDraft.icon_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
	renderPersonaCreationImageGallery();
	bindPersonaCreationAdjustments();

	const uploadInput = document.getElementById('create-persona-image-upload');
	const uploadBtn = document.getElementById('create-persona-upload-btn');
	if (uploadBtn && uploadInput) {
		uploadBtn.addEventListener('click', () => uploadInput.click());
		uploadInput.addEventListener('change', (e) => {
			uploadPersonaCreationImages(e.target.files);
			uploadInput.value = '';
		});
	}

	const nameInput = document.getElementById('create-persona-name');
	const descInput = document.getElementById('create-persona-description');
	if (nameInput) {
		nameInput.addEventListener('input', () => {
			updatePersonaCreationDraftFromForm();
			setPersonaCreationPreviewStyle('create-persona-cover-preview', personaCreationDraft.cover_art, personaCreationDraft.cover_art_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
			setPersonaCreationPreviewStyle('create-persona-icon-preview', personaCreationDraft.icon_art, personaCreationDraft.icon_fit, 'background:linear-gradient(135deg,#ffd166 0%,#ff6b9d 100%);');
		});
	}
	if (descInput) {
		descInput.addEventListener('input', () => {
			updatePersonaCreationDraftFromForm();
			refreshPersonaCreationTokenCounter();
		});
	}
	refreshPersonaCreationTokenCounter();

	const cloneBtn = document.getElementById('clonePersonaBtn');
	const cloneMenu = document.getElementById('clonePersonaMenu');
	if (cloneBtn && cloneMenu) {
		cloneBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			const willOpen = cloneMenu.classList.contains('hidden');
			if (willOpen) {
				loadClonePersonaOptions(cloneMenu);
			}
			cloneMenu.classList.toggle('hidden');
		});
		cloneMenu.addEventListener('click', (event) => {
			event.stopPropagation();
		});
		messagesContainer.addEventListener('click', () => {
			cloneMenu.classList.add('hidden');
		});
	}

	const cancelBtn = document.getElementById('create-persona-cancel');
	if (cancelBtn) {
		cancelBtn.addEventListener('click', () => {
			if (confirm('Discard persona creation draft?')) {
				clearPersonaCreationDraft();
				const personasNavItem = Array.from(navItems || []).find(item => item.dataset && item.dataset.view === 'personas');
				if (personasNavItem) {
					personasNavItem.click();
				} else {
					showPersonas();
				}
			}
		});
	}
	const saveBtn = document.getElementById('create-persona-save');
	if (saveBtn) {
		saveBtn.addEventListener('click', createPersonaFromDraft);
	}
}

function refreshPersonaCreationTokenCounter() {
	const descriptionInput = document.getElementById('create-persona-description');
	const badge = document.getElementById('create-persona-desc-token-count');
	if (!badge) {
		return;
	}
	badge.textContent = `${estimateUiTokens(descriptionInput ? descriptionInput.value : '')} tok`;
}

function createPersonaFromDraft() {
	if (!personaCreationDraft) {
		return;
	}
	updatePersonaCreationDraftFromForm();
	const name = (personaCreationDraft.name || '').trim();
	if (!name) {
		alert('Please enter a persona name.');
		return;
	}

	fetch('/api/personas', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			action: 'create',
			name,
			description: personaCreationDraft.description || '',
			cover_art: ''
		})
	})
		.then(r => r.json())
		.then(createdPersona => {
			if (!createdPersona || !createdPersona.id) {
				alert('Failed to create persona.');
				return null;
			}
			const personaId = createdPersona.id;
			const uploads = (personaCreationDraft.images || []).map(img => fetch('/api/persona/images', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'upload', persona_id: personaId, filename: img.name, data_url: img.data_url })
			}));
			return Promise.all(uploads)
				.then(() => {
					const tasks = [];
					if (personaCreationDraft.cover_image_name) {
						tasks.push(fetch('/api/persona/images', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ action: 'set_coverart', persona_id: personaId, filename: personaCreationDraft.cover_image_name })
						}));
					}
					if (personaCreationDraft.icon_image_name) {
						tasks.push(fetch('/api/persona/images', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ action: 'set_icon', persona_id: personaId, filename: personaCreationDraft.icon_image_name, source: 'Images' })
						}));
					}
					return Promise.all(tasks);
				})
				.then(() => fetch('/api/personas', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'update',
						persona_id: personaId,
						name,
						description: personaCreationDraft.description || '',
						cover_art_fit: personaCreationDraft.cover_art_fit,
						icon_fit: personaCreationDraft.icon_fit
					})
				}))
				.then(() => personaId);
		})
		.then((personaId) => {
			if (!personaId) {
				return;
			}
			clearPersonaCreationDraft();
			alert('Persona created!');
			const personasNavItem = Array.from(navItems || []).find(item => item.dataset && item.dataset.view === 'personas');
			if (personasNavItem) {
				personasNavItem.click();
			} else {
				showPersonas();
			}
		})
		.catch(() => {
			alert('Failed to create persona.');
		});
}
