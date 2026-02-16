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

function showPersonaEditor(persona) {
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
	
	editor.innerHTML = `
		<div class="editor-grid masonry-grid">
			<div class="editor-section">
				<h3>Persona Details</h3>
				<div class="form-group">
					<label>Name</label>
					<input type="text" id="persona-name" class="text-input" value="${persona.name || ''}">
				</div>
				<div class="form-group">
					<label>Description</label>
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
			<button type="button" class="action-btn cancel-btn" onclick="showPersonaDetail(currentPersonaInfo)">Cancel</button>
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
			currentPersonaInfo.cover_art = `/Personas/${personaId}/Coverart/${filename}`;
			document.getElementById('cover-art-value').value = currentPersonaInfo.cover_art;
			document.getElementById('cover-preview').style.cssText = buildImageStyle(currentPersonaInfo.cover_art, currentPersonaInfo.cover_art_fit || null);
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
			currentPersonaInfo.icon_art = `/Personas/${personaId}/Coverart/${filename}`;
			document.getElementById('icon-art-value').value = currentPersonaInfo.icon_art;
			document.getElementById('icon-preview').style.cssText = buildImageStyle(currentPersonaInfo.icon_art, currentPersonaInfo.icon_fit || null);
			loadPersonaImages(currentPersonaInfo);
		}
	});
}

function bindPersonaImageAdjustments(persona) {
	// Cover art adjustments
	const updateCoverPreview = () => {
		const zoom = parseInt(document.getElementById('cover-zoom').value);
		const x = parseInt(document.getElementById('cover-posX').value);
		const y = parseInt(document.getElementById('cover-posY').value);
		document.getElementById('cover-zoom-val').textContent = zoom + '%';
		document.getElementById('cover-posX-val').textContent = x + '%';
		document.getElementById('cover-posY-val').textContent = y + '%';
		const fit = { size: zoom, x, y };
		document.getElementById('cover-preview').style.cssText = buildImageStyle(persona.cover_art, fit);
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
		document.getElementById('icon-preview').style.cssText = buildImageStyle(persona.icon_art, fit);
	};
	
	document.getElementById('icon-zoom').addEventListener('input', updateIconPreview);
	document.getElementById('icon-posX').addEventListener('input', updateIconPreview);
	document.getElementById('icon-posY').addEventListener('input', updateIconPreview);
}

function readPersonaFitInputs(prefix) {
	return {
		size: parseInt(document.getElementById(prefix + '-zoom').value),
		x: parseInt(document.getElementById(prefix + '-posX').value),
		y: parseInt(document.getElementById(prefix + '-posY').value)
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
		if (data.success) {
			currentPersonaInfo = { ...currentPersonaInfo, name, description, cover_art_fit: coverArtFit, icon_fit: iconFit };
			showPersonaDetail(currentPersonaInfo);
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
