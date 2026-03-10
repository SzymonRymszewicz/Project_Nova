const navItems = document.querySelectorAll('.nav-item');
const messagesContainer = document.getElementById('messages');
const inputArea = document.getElementById('inputArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatHeader = document.getElementById('chatHeader');
const themeStylesheet = document.getElementById('themeStylesheet');
let currentView = 'last-chat';
let currentBotName = null;
let currentBotInfo = null;
let currentPersonaInfo = null;
let currentChatId = null;
let currentChatMessages = [];
let currentChatContextStats = null;
const chatBotIamSelections = {};
let currentChatIamSetNames = [];
let lastSavedTheme = 'default';
let lastSavedSettings = {};
let settingsDraft = {};
let masonryResizeBound = false;
const observedMasonryGrids = new WeakSet();
let sectionLayoutResizeBound = false;

// Expose state to window for module access using getters
Object.defineProperty(window, 'currentBotName', {
	get: () => currentBotName,
	set: (value) => { currentBotName = value; }
});
Object.defineProperty(window, 'currentBotInfo', {
	get: () => currentBotInfo,
	set: (value) => { currentBotInfo = value; }
});
Object.defineProperty(window, 'currentPersonaInfo', {
	get: () => currentPersonaInfo,
	set: (value) => { currentPersonaInfo = value; }
});
Object.defineProperty(window, 'currentChatId', {
	get: () => currentChatId,
	set: (value) => { currentChatId = value; }
});
Object.defineProperty(window, 'currentChatMessages', {
	get: () => currentChatMessages,
	set: (value) => { currentChatMessages = value; }
});
Object.defineProperty(window, 'currentView', {
	get: () => currentView,
	set: (value) => { currentView = value; }
});
Object.defineProperty(window, 'settingsDraft', {
	get: () => settingsDraft,
	set: (value) => { settingsDraft = value; }
});
Object.defineProperty(window, 'lastSavedSettings', {
	get: () => lastSavedSettings,
	set: (value) => { lastSavedSettings = value; }
});

function estimateUiTokens(text) {
	if (window.NovaTKAMES && typeof window.NovaTKAMES.estimateTokens === 'function') {
		return window.NovaTKAMES.estimateTokens(text);
	}
	const raw = `${text || ''}`;
	if (!raw.trim()) {
		return 0;
	}
	return Math.max(1, Math.ceil(raw.length / 4));
}

function getCurrentGenerationMaxTokens() {
	const draftValue = Number.parseInt((settingsDraft && settingsDraft.max_tokens), 10);
	if (Number.isFinite(draftValue) && draftValue > 0) {
		return draftValue;
	}
	const savedValue = Number.parseInt((lastSavedSettings && lastSavedSettings.max_tokens), 10);
	if (Number.isFinite(savedValue) && savedValue > 0) {
		return savedValue;
	}
	return 10000;
}

function setCurrentChatContextStats(stats) {
	currentChatContextStats = stats || null;
}

function showToast(message, type = 'info', durationMs = 1800) {
	if (!message) {
		return;
	}
	let container = document.getElementById('app-toast-container');
	if (!container) {
		container = document.createElement('div');
		container.id = 'app-toast-container';
		container.className = 'app-toast-container';
		document.body.appendChild(container);
	}

	const toast = document.createElement('div');
	toast.className = `app-toast app-toast-${type}`;
	toast.textContent = message;
	container.appendChild(toast);

	requestAnimationFrame(() => {
		toast.classList.add('visible');
	});

	window.setTimeout(() => {
		toast.classList.remove('visible');
		window.setTimeout(() => {
			if (toast.parentNode === container) {
				container.removeChild(toast);
			}
			if (!container.childElementCount && container.parentNode) {
				container.parentNode.removeChild(container);
			}
		}, 220);
	}, Math.max(800, durationMs));
}

function extractImageUrlFromElement(element) {
	if (!element) {
		return '';
	}
	if (element.tagName && element.tagName.toLowerCase() === 'img') {
		return `${element.getAttribute('src') || ''}`.trim();
	}

	const nestedImage = element.querySelector('img');
	if (nestedImage) {
		const nestedSrc = `${nestedImage.getAttribute('src') || ''}`.trim();
		if (nestedSrc) {
			return nestedSrc;
		}
	}

	const computed = window.getComputedStyle(element);
	const backgroundImage = `${computed.backgroundImage || ''}`;
	if (!backgroundImage || backgroundImage === 'none') {
		return '';
	}

	const urlMatch = backgroundImage.match(/url\((['"]?)(.*?)\1\)/i);
	if (!urlMatch || !urlMatch[2]) {
		return '';
	}
	return `${urlMatch[2] || ''}`.trim();
}

function initImageFocusViewer() {
	const focusableSelector = [
		'.detail-cover',
		'.detail-icon',
		'.image-thumb',
		'.bot-panel-cover',
		'.card-cover',
		'.chat-group-icon',
		'.chat-item-icon',
		'.persona-option-icon',
		'.message-avatar',
		'.message-avatar-img'
	].join(', ');

	let overlay = null;
	let overlayImage = null;
	let resetButton = null;
	let zoomScale = 1;
	let panX = 0;
	let panY = 0;
	let isDragging = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let dragOriginX = 0;
	let dragOriginY = 0;

	const MIN_ZOOM = 1;
	const MAX_ZOOM = 6;

	const applyTransform = () => {
		if (!overlayImage) {
			return;
		}
		overlayImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
		overlayImage.classList.toggle('zoomed', zoomScale > 1.001);
		overlayImage.classList.toggle('dragging', isDragging && zoomScale > 1.001);
		if (resetButton) {
			resetButton.classList.toggle('visible', zoomScale > 1.001);
		}
	};

	const resetZoomAndPan = () => {
		zoomScale = 1;
		panX = 0;
		panY = 0;
		isDragging = false;
		applyTransform();
	};

	const ensureOverlay = () => {
		if (overlay && overlayImage && resetButton) {
			return;
		}
		overlay = document.createElement('div');
		overlay.id = 'image-focus-overlay';
		overlay.className = 'image-focus-overlay';
		overlay.innerHTML = '<div class="image-focus-modal" id="image-focus-modal"><button type="button" id="image-focus-reset" class="image-focus-reset" aria-label="Reset zoom" title="Reset zoom">↻</button><img id="image-focus-preview" class="image-focus-preview" alt="Focused preview"></div>';
		document.body.appendChild(overlay);
		overlayImage = document.getElementById('image-focus-preview');
		resetButton = document.getElementById('image-focus-reset');

		if (resetButton) {
			resetButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				resetZoomAndPan();
			});
		}

		if (overlayImage) {
			overlayImage.addEventListener('wheel', (event) => {
				if (!overlay || !overlay.classList.contains('visible')) {
					return;
				}
				event.preventDefault();

				const delta = event.deltaY;
				const factor = delta < 0 ? 1.12 : 0.89;
				const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomScale * factor));
				if (Math.abs(nextZoom - zoomScale) < 0.001) {
					return;
				}

				const bounds = overlayImage.getBoundingClientRect();
				const anchorX = event.clientX - (bounds.left + bounds.width / 2);
				const anchorY = event.clientY - (bounds.top + bounds.height / 2);
				const ratio = nextZoom / zoomScale;
				panX = panX * ratio + anchorX * (1 - ratio);
				panY = panY * ratio + anchorY * (1 - ratio);
				zoomScale = nextZoom;
				if (zoomScale <= 1.001) {
					panX = 0;
					panY = 0;
				}
				applyTransform();
			}, { passive: false });

			overlayImage.addEventListener('mousedown', (event) => {
				if (zoomScale <= 1.001) {
					return;
				}
				event.preventDefault();
				isDragging = true;
				dragStartX = event.clientX;
				dragStartY = event.clientY;
				dragOriginX = panX;
				dragOriginY = panY;
				applyTransform();
			});
		}

		document.addEventListener('mousemove', (event) => {
			if (!isDragging || zoomScale <= 1.001) {
				return;
			}
			panX = dragOriginX + (event.clientX - dragStartX);
			panY = dragOriginY + (event.clientY - dragStartY);
			applyTransform();
		});

		document.addEventListener('mouseup', () => {
			if (!isDragging) {
				return;
			}
			isDragging = false;
			applyTransform();
		});

		overlay.addEventListener('click', (event) => {
			if (event.target === overlay) {
				closeOverlay();
			}
		});
	};

	const openOverlay = (url) => {
		const safeUrl = `${url || ''}`.trim();
		if (!safeUrl) {
			return;
		}
		ensureOverlay();
		if (!overlay || !overlayImage) {
			return;
		}
		overlayImage.src = safeUrl;
		resetZoomAndPan();
		overlay.classList.add('visible');
		document.body.classList.add('image-focus-open');
	};

	const closeOverlay = () => {
		if (!overlay) {
			return;
		}
		overlay.classList.remove('visible');
		isDragging = false;
		resetZoomAndPan();
		if (overlayImage) {
			overlayImage.removeAttribute('src');
		}
		document.body.classList.remove('image-focus-open');
	};

	document.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		if (currentView === 'chats') {
			return;
		}

		if (currentView === 'bots' && target.closest('.bot-card')) {
			return;
		}

		if (target.closest('.img-action-btn, .image-actions button')) {
			return;
		}

		const focusable = target.closest(focusableSelector);
		if (!focusable) {
			return;
		}

		const imageUrl = extractImageUrlFromElement(focusable);
		if (!imageUrl) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		openOverlay(imageUrl);
	});

	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape') {
			return;
		}
		if (!overlay || !overlay.classList.contains('visible')) {
			return;
		}
		event.preventDefault();
		closeOverlay();
	});
}

function buildImageStyle(url, fit) {
	if (!url) {
		return '';
	}
	const rawSize = fit ? Number(fit.size) : NaN;
	const rawX = fit ? Number(fit.x) : NaN;
	const rawY = fit ? Number(fit.y) : NaN;
	const size = Number.isFinite(rawSize) ? rawSize : 100;
	const x = Number.isFinite(rawX) ? rawX : 50;
	const y = Number.isFinite(rawY) ? rawY : 50;
	return `background-image:url('${url}');background-size:${size}%;background-position:${x}% ${y}%;background-repeat:no-repeat;`;
}

function toStorageSafeKey(value) {
	const raw = `${value || ''}`.trim();
	if (!raw) {
		return 'default';
	}
	return encodeURIComponent(raw.toLowerCase());
}

function makeCollapsibleStorageKey(scope, title, index) {
	const safeScope = toStorageSafeKey(scope || 'global');
	const safeTitle = toStorageSafeKey(title || 'section');
	return `nova:section-collapsed:${safeScope}:${safeTitle}:${index}`;
}

function readCollapsedState(storageKey) {
	if (!storageKey) {
		return false;
	}
	try {
		return localStorage.getItem(storageKey) === '1';
	} catch (_error) {
		return false;
	}
}

function writeCollapsedState(storageKey, collapsed) {
	if (!storageKey) {
		return;
	}
	try {
		if (collapsed) {
			localStorage.setItem(storageKey, '1');
		} else {
			localStorage.removeItem(storageKey);
		}
	} catch (_error) {
		// Ignore storage write failures (private mode, disabled storage, etc.)
	}
}

function makeSectionHeightStorageKey(storageKey) {
	if (!storageKey) {
		return '';
	}
	return `${storageKey}:height`;
}

function readStoredSectionHeight(storageKey) {
	const heightKey = makeSectionHeightStorageKey(storageKey);
	if (!heightKey) {
		return 0;
	}
	try {
		const value = parseFloat(localStorage.getItem(heightKey) || '0');
		return Number.isFinite(value) && value > 0 ? value : 0;
	} catch (_error) {
		return 0;
	}
}

function writeStoredSectionHeight(storageKey, height) {
	const heightKey = makeSectionHeightStorageKey(storageKey);
	if (!heightKey) {
		return;
	}
	const numeric = Number(height);
	try {
		if (Number.isFinite(numeric) && numeric > 0) {
			localStorage.setItem(heightKey, `${numeric}`);
		}
	} catch (_error) {
		// Ignore storage write failures
	}
}

function clearAllCollapsedStates() {
	const prefix = 'nova:section-collapsed:';
	try {
		const keysToRemove = [];
		for (let idx = 0; idx < localStorage.length; idx += 1) {
			const key = localStorage.key(idx);
			if (key && key.startsWith(prefix)) {
				keysToRemove.push(key);
			}
		}
		keysToRemove.forEach(key => localStorage.removeItem(key));
	} catch (_error) {
		// Ignore storage failures
	}
}

function makeSectionsCollapsible(container, sectionSelector, stateScope = '') {
	if (!container || !sectionSelector) {
		return;
	}

	const sections = container.querySelectorAll(sectionSelector);
	const resolvedScope = stateScope || container.dataset.collapsibleScope || currentView || 'global';
	sections.forEach((section, index) => {
		if (!section || section.dataset.collapsibleInit === '1') {
			return;
		}

		const directHeaderRow = Array.from(section.children).find(child => child.classList && child.classList.contains('detail-title-row'));
		const directH3 = Array.from(section.children).find(child => child.tagName === 'H3');
		let header = directHeaderRow || directH3;
		let title = 'Section';

		if (header) {
			const headerH3 = header.tagName === 'H3' ? header : header.querySelector('h3');
			title = (headerH3 ? headerH3.textContent : header.textContent || '').trim() || 'Section';
		} else {
			const firstH3 = section.querySelector('h3');
			title = (firstH3 ? firstH3.textContent : '').trim() || 'Section';
			if (firstH3) {
				firstH3.classList.add('section-collapsible-source-title');
			}
			header = document.createElement('div');
			header.className = 'section-collapsible-header';
			const titleEl = document.createElement('span');
			titleEl.className = 'section-collapsible-title';
			titleEl.textContent = title;
			header.appendChild(titleEl);
			section.prepend(header);
		}

		header.classList.add('section-collapsible-header');

		if (header.tagName === 'H3') {
			const originalTitle = (header.textContent || '').trim() || title;
			header.textContent = '';
			const titleEl = document.createElement('span');
			titleEl.className = 'section-collapsible-title';
			titleEl.textContent = originalTitle;
			header.appendChild(titleEl);
		}

		if (!header.querySelector('.section-collapsible-title')) {
			const headerH3 = header.querySelector('h3');
			if (headerH3) {
				headerH3.classList.add('section-collapsible-title');
			}
		}

		const toggleBtn = document.createElement('button');
		toggleBtn.type = 'button';
		toggleBtn.className = 'section-collapsible-toggle';
		header.appendChild(toggleBtn);

		const storageKey = makeCollapsibleStorageKey(resolvedScope, title, index);
		section.dataset.collapsibleStorageKey = storageKey;

		const body = document.createElement('div');
		body.className = 'section-collapsible-body';
		const toMove = Array.from(section.childNodes).filter(node => node !== header);
		toMove.forEach(node => body.appendChild(node));
		section.appendChild(body);
		body.style.maxHeight = 'none';
		body.style.opacity = '1';
		body.style.transform = 'translateY(0)';

		const applyExpandedBodyStyles = (animate = true) => {
			section.classList.remove('section-collapsed');
			const targetHeight = body.scrollHeight;
			if (!animate) {
				body.style.maxHeight = 'none';
				body.style.opacity = '1';
				body.style.transform = 'translateY(0)';
				return;
			}
			body.style.maxHeight = '0px';
			body.style.opacity = '0';
			body.style.transform = 'translateY(-4px)';
			requestAnimationFrame(() => {
				body.style.maxHeight = `${targetHeight}px`;
				body.style.opacity = '1';
				body.style.transform = 'translateY(0)';
			});
		};

		const applyCollapsedBodyStyles = (animate = true) => {
			const currentHeight = body.scrollHeight;
			if (!animate) {
				body.style.maxHeight = '0px';
				body.style.opacity = '0';
				body.style.transform = 'translateY(-4px)';
				section.classList.add('section-collapsed');
				return;
			}
			body.style.maxHeight = `${currentHeight}px`;
			body.style.opacity = '1';
			body.style.transform = 'translateY(0)';
			requestAnimationFrame(() => {
				body.style.maxHeight = '0px';
				body.style.opacity = '0';
				body.style.transform = 'translateY(-4px)';
				section.classList.add('section-collapsed');
			});
		};

		body.addEventListener('transitionend', (event) => {
			if (event.propertyName !== 'max-height') {
				return;
			}
			if (!section.classList.contains('section-collapsed')) {
				body.style.maxHeight = 'none';
			}
			scheduleMasonryRefresh(container);
		});

		const setCollapsed = (collapsed, animate = true) => {
			toggleBtn.textContent = collapsed ? '<' : 'v';
			toggleBtn.setAttribute('aria-label', collapsed ? `Expand ${title}` : `Collapse ${title}`);
			toggleBtn.title = collapsed ? `Expand ${title}` : `Collapse ${title}`;
			if (collapsed) {
				applyCollapsedBodyStyles(animate);
			} else {
				applyExpandedBodyStyles(animate);
			}
			writeCollapsedState(storageKey, collapsed);
			scheduleMasonryRefresh(container);
		};

		toggleBtn.addEventListener('click', () => {
			setCollapsed(!section.classList.contains('section-collapsed'), true);
		});

		setCollapsed(readCollapsedState(storageKey), false);
		section.dataset.collapsibleInit = '1';
	});
}

function expandAllCollapsibleSections(container) {
	if (!container) {
		return;
	}
	const sections = container.querySelectorAll('.section-collapsed');
	sections.forEach(section => {
		section.classList.remove('section-collapsed');
		writeCollapsedState(section.dataset.collapsibleStorageKey || '', false);
		const toggleBtn = section.querySelector('.section-collapsible-toggle');
		const body = section.querySelector('.section-collapsible-body');
		if (body) {
			body.style.maxHeight = 'none';
			body.style.opacity = '1';
			body.style.transform = 'translateY(0)';
		}
		if (toggleBtn) {
			const titleEl = section.querySelector('.section-collapsible-title');
			const title = (titleEl ? titleEl.textContent : 'Section') || 'Section';
			toggleBtn.textContent = 'v';
			toggleBtn.setAttribute('aria-label', `Collapse ${title}`);
			toggleBtn.title = `Collapse ${title}`;
		}
	});
	scheduleMasonryRefresh(container);
}

function getGridColumnCount(grid) {
	const style = window.getComputedStyle(grid);
	const template = style.gridTemplateColumns || '';
	if (!template || template === 'none') {
		return 1;
	}
	return template.split(' ').filter(Boolean).length || 1;
}

function clearGridItemLayout(item) {
	if (!item) {
		return;
	}
	item.style.gridColumn = '';
	item.style.gridRow = '';
	item.style.gridRowEnd = 'auto';
}

function applyCollapsedColumnStackLayout(grid, items, columns) {
	if (!grid || !items.length || columns <= 1) {
		return;
	}

	const style = window.getComputedStyle(grid);
	const rowGap = parseFloat(style.rowGap || style.gridRowGap || '0') || 0;
	const rowUnit = 8;
	const step = rowUnit + rowGap;
	const nextRowByColumn = Array(columns).fill(1);

	grid.style.gridAutoFlow = 'row';
	grid.style.gridAutoRows = `${rowUnit}px`;

	items.forEach((item, index) => {
		const column = (index % columns) + 1;
		const rowStart = nextRowByColumn[column - 1];
		const height = item.getBoundingClientRect().height || 0;
		const span = Math.max(1, Math.ceil((height + rowGap) / (step || rowUnit)));
		item.style.gridColumn = `${column} / span 1`;
		item.style.gridRow = `${rowStart} / span ${span}`;
		nextRowByColumn[column - 1] += span;
	});
}

function equalizeSectionRows(root = document) {
	if (!root) {
		return;
	}

	const grids = root.querySelectorAll
		? root.querySelectorAll('.settings-grid, .bot-editor-grid, .editor-grid')
		: [];

	grids.forEach(grid => {
		const items = Array.from(grid.children || []).filter(node => node && node.nodeType === 1);
		if (!items.length) {
			return;
		}

		const hasActiveCollapseTransition = items.some(item => {
			const body = item.querySelector(':scope > .section-collapsible-body');
			if (!body) {
				return false;
			}
			const maxHeight = body.style.maxHeight || '';
			return !!maxHeight && maxHeight !== 'none';
		});

		const columns = getGridColumnCount(grid);
		const isFixedSettingsLayout = grid.classList.contains('settings-layout-fixed');
		items.forEach(item => {
			clearGridItemLayout(item);
		});
		grid.style.gridAutoFlow = '';
		grid.style.gridAutoRows = '';

		if (columns <= 1) {
			items.forEach(item => {
				item.style.minHeight = '';
				delete item.dataset.lockedExpandedHeight;
			});
			return;
		}

		if (isFixedSettingsLayout) {
			const generationGroup = items[0] || null;
			const apiGroup = items[1] || null;
			const styleGroup = items[2] || null;
			const otherGroup = items[3] || null;
			const topRowGroups = [apiGroup, styleGroup, otherGroup].filter(Boolean);
			const expandedTopRowGroups = topRowGroups.filter(item => !item.classList.contains('section-collapsed'));
			const styleAnchor = (styleGroup && !styleGroup.classList.contains('section-collapsed'))
				? (styleGroup.getBoundingClientRect().height || 0)
				: 0;
			const fallbackAnchor = expandedTopRowGroups.length
				? Math.max(...expandedTopRowGroups.map(item => item.getBoundingClientRect().height || 0))
				: 0;
			const topRowAnchorHeight = Math.max(styleAnchor, fallbackAnchor);

			topRowGroups.forEach(item => {
				if (item.classList.contains('section-collapsed') || topRowAnchorHeight <= 0) {
					item.style.minHeight = '';
					delete item.dataset.lockedExpandedHeight;
					return;
				}
				item.style.minHeight = `${topRowAnchorHeight}px`;
			});

			if (generationGroup) {
				generationGroup.style.minHeight = '';
				delete generationGroup.dataset.lockedExpandedHeight;
			}

			const orderedItems = [apiGroup, styleGroup, otherGroup, generationGroup].filter(Boolean);
			const hasCollapsedTop = topRowGroups.some(item => item.classList.contains('section-collapsed')) || hasActiveCollapseTransition;
			if (hasCollapsedTop) {
				const stackColumns = Math.max(1, Math.min(columns, 3));
				applyCollapsedColumnStackLayout(grid, orderedItems, stackColumns);
			}

			return;
		}

		const hasCollapsed = items.some(item => item.classList.contains('section-collapsed')) || hasActiveCollapseTransition;
		if (hasCollapsed) {
			items.forEach(item => {
				const storageKey = item.dataset.collapsibleStorageKey || '';
				if (item.classList.contains('section-collapsed')) {
					item.style.minHeight = '';
					return;
				}
				const stableThreshold = 24;
				const storedHeight = readStoredSectionHeight(storageKey);
				const existingLockedHeight = parseFloat(item.dataset.lockedExpandedHeight || '0') || 0;
				const measuredHeight = item.getBoundingClientRect().height || 0;
				const stableMeasuredHeight = measuredHeight > stableThreshold ? measuredHeight : 0;
				const lockedHeight = Math.max(existingLockedHeight, storedHeight, stableMeasuredHeight);
				if (lockedHeight > 0) {
					item.dataset.lockedExpandedHeight = `${lockedHeight}`;
					item.style.minHeight = `${lockedHeight}px`;
					writeStoredSectionHeight(storageKey, lockedHeight);
				}
			});
			applyCollapsedColumnStackLayout(grid, items, columns);
			return;
		}

		items.forEach(item => {
			item.style.minHeight = '';
			delete item.dataset.lockedExpandedHeight;
		});

		for (let idx = 0; idx < items.length; idx += columns) {
			const rowItems = items.slice(idx, idx + columns);
			const expandedItems = rowItems.filter(item => !item.classList.contains('section-collapsed'));
			if (!expandedItems.length) {
				continue;
			}
			const tallest = Math.max(...expandedItems.map(item => {
				const measured = item.getBoundingClientRect().height || 0;
				const stored = readStoredSectionHeight(item.dataset.collapsibleStorageKey || '');
				return Math.max(measured, stored);
			}));
			expandedItems.forEach(item => {
				item.style.minHeight = `${tallest}px`;
				writeStoredSectionHeight(item.dataset.collapsibleStorageKey || '', tallest);
			});
		}
	});
}

function refreshMasonryLayouts(root = document) {
	if (!root) {
		return;
	}
	const grids = root.querySelectorAll ? root.querySelectorAll('.masonry-grid') : [];
	grids.forEach(grid => {
		observeMasonryGrid(grid);
	});

	equalizeSectionRows(root);
}

function observeMasonryGrid(grid) {
	if (!grid || observedMasonryGrids.has(grid)) {
		return;
	}
	observedMasonryGrids.add(grid);

	const resizeObserver = new ResizeObserver(() => {
		scheduleMasonryRefresh(grid);
	});
	resizeObserver.observe(grid);
	Array.from(grid.children || []).forEach(child => {
		resizeObserver.observe(child);
	});

	const mutationObserver = new MutationObserver((mutations) => {
		let shouldRefresh = false;
		mutations.forEach(mutation => {
			if (mutation.type === 'childList') {
				shouldRefresh = true;
				Array.from(mutation.addedNodes || []).forEach(node => {
					if (node && node.nodeType === 1) {
						resizeObserver.observe(node);
					}
				});
			}
			if (mutation.type === 'attributes' || mutation.type === 'characterData') {
				shouldRefresh = true;
			}
		});
		if (shouldRefresh) {
			scheduleMasonryRefresh(grid);
		}
	});

	mutationObserver.observe(grid, {
		childList: true,
		subtree: true
	});
}

function scheduleMasonryRefresh(root = document) {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			refreshMasonryLayouts(root || document);
		});
	});

	if (!masonryResizeBound) {
		masonryResizeBound = true;
		window.addEventListener('resize', () => {
			scheduleMasonryRefresh(document);
		});
	}

	if (!sectionLayoutResizeBound) {
		sectionLayoutResizeBound = true;
		window.addEventListener('resize', () => {
			requestAnimationFrame(() => {
				equalizeSectionRows(document);
			});
		});
	}
}

function isDebugModeEnabled() {
	const draft = settingsDraft && settingsDraft.debug_mode;
	const saved = lastSavedSettings && lastSavedSettings.debug_mode;
	return draft === true || saved === true;
}

function updateDevTabVisibility() {
	const devNavItem = document.getElementById('devNavItem');
	if (devNavItem) {
		devNavItem.style.display = isDebugModeEnabled() ? '' : 'none';
	}
}

initImageFocusViewer();
