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
const chatBotIamSelections = {};
let currentChatIamSetNames = [];
let lastSavedTheme = 'default';
let lastSavedSettings = {};
let settingsDraft = {};
let masonryResizeBound = false;
const observedMasonryGrids = new WeakSet();
let sectionLayoutResizeBound = false;

function buildImageStyle(url, fit) {
	if (!url) {
		return '';
	}
	const size = fit && Number.isFinite(fit.size) ? fit.size : 100;
	const x = fit && Number.isFinite(fit.x) ? fit.x : 50;
	const y = fit && Number.isFinite(fit.y) ? fit.y : 50;
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

function clearCollapsedStateForScope(scope) {
	const safeScope = toStorageSafeKey(scope || 'global');
	const prefix = `nova:section-collapsed:${safeScope}:`;
	try {
		const keysToRemove = [];
		for (let idx = 0; idx < localStorage.length; idx += 1) {
			const key = localStorage.key(idx);
			if (key && key.startsWith(prefix)) {
				keysToRemove.push(key);
				keysToRemove.push(`${key}:height`);
			}
		}
		keysToRemove.forEach(key => localStorage.removeItem(key));
	} catch (_error) {
		// Ignore storage failures
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

		const columns = getGridColumnCount(grid);
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

		const hasCollapsed = items.some(item => item.classList.contains('section-collapsed'));
		if (hasCollapsed) {
			items.forEach(item => {
				const storageKey = item.dataset.collapsibleStorageKey || '';
				if (item.classList.contains('section-collapsed')) {
					item.style.minHeight = '';
					delete item.dataset.lockedExpandedHeight;
					return;
				}
				if (!item.dataset.lockedExpandedHeight) {
					const storedHeight = readStoredSectionHeight(storageKey);
					const measuredHeight = item.getBoundingClientRect().height;
					const baseline = storedHeight > 0 ? storedHeight : measuredHeight;
					item.dataset.lockedExpandedHeight = `${baseline}`;
				}
				const lockedHeight = parseFloat(item.dataset.lockedExpandedHeight) || 0;
				if (lockedHeight > 0) {
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
