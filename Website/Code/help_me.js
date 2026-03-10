function escapeHelpMeText(value) {
	return `${value || ''}`
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function normalizeHelpMeSearch(value) {
	return `${value || ''}`.trim().toLowerCase();
}

function escapeHelpMeRegex(value) {
	return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeHelpMeHtml(html) {
	const template = document.createElement('template');
	template.innerHTML = `${html || ''}`;

	const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta']);
	const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
	const toRemove = [];

	while (walker.nextNode()) {
		const element = walker.currentNode;
		const tagName = `${element.tagName || ''}`.toLowerCase();
		if (blockedTags.has(tagName)) {
			toRemove.push(element);
			continue;
		}

		Array.from(element.attributes || []).forEach(attribute => {
			const attrName = `${attribute.name || ''}`.toLowerCase();
			const attrValue = `${attribute.value || ''}`.trim();
			if (attrName.startsWith('on')) {
				element.removeAttribute(attribute.name);
				return;
			}
			if ((attrName === 'href' || attrName === 'src') && /^javascript:/i.test(attrValue)) {
				element.removeAttribute(attribute.name);
			}
		});
	}

	toRemove.forEach(node => {
		if (node && node.parentNode) {
			node.parentNode.removeChild(node);
		}
	});

	return template.innerHTML;
}

function parseHelpMeReadme(rawContent) {
	const source = `${rawContent || ''}`;
	if (!source.trim()) {
		return { css: '', html: '' };
	}

	const cssBlocks = [];
	const withoutStyles = source.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, cssContent) => {
		cssBlocks.push(`${cssContent || ''}`);
		return '';
	});

	const looksLikeHtml = /<\/?(?:html|head|body|article|section|main|aside|header|footer|nav|div|span|p|h[1-6]|ul|ol|li|pre|code|blockquote|table|thead|tbody|tr|th|td|a|img|strong|em|br|hr)\b[^>]*>/i.test(withoutStyles);
	if (looksLikeHtml) {
		return {
			css: cssBlocks.join('\n\n'),
			html: sanitizeHelpMeHtml(withoutStyles)
		};
	}

	const markdownHtml = renderHelpMeMarkdown(withoutStyles);
	return {
		css: cssBlocks.join('\n\n'),
		html: markdownHtml
	};
}

function renderHelpMeMarkdown(rawMarkdown) {
	const markdown = `${rawMarkdown || ''}`.replace(/\r\n?/g, '\n');
	const lines = markdown.split('\n');
	const htmlParts = [];

	let inCode = false;
	let codeBuffer = [];
	let listMode = null;
	let inQuote = false;

	const flushCode = () => {
		if (!inCode) {
			return;
		}
		htmlParts.push(`<pre><code>${escapeHelpMeText(codeBuffer.join('\n'))}</code></pre>`);
		inCode = false;
		codeBuffer = [];
	};

	const closeList = () => {
		if (listMode) {
			htmlParts.push(`</${listMode}>`);
			listMode = null;
		}
	};

	const closeQuote = () => {
		if (inQuote) {
			htmlParts.push('</blockquote>');
			inQuote = false;
		}
	};

	const inlineFormat = (text) => {
		let value = escapeHelpMeText(text);
		value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
		value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');
		return value;
	};

	lines.forEach(line => {
		const raw = `${line || ''}`;
		const trimmed = raw.trim();

		if (trimmed.startsWith('```')) {
			if (inCode) {
				flushCode();
			} else {
				closeList();
				closeQuote();
				inCode = true;
			}
			return;
		}

		if (inCode) {
			codeBuffer.push(raw);
			return;
		}

		if (!trimmed) {
			closeList();
			closeQuote();
			htmlParts.push('<div class="readme-spacer"></div>');
			return;
		}

		const hrMatch = trimmed.match(/^(?:-{3,}|_{3,}|\*{3,})$/);
		if (hrMatch) {
			closeList();
			closeQuote();
			htmlParts.push('<hr>');
			return;
		}

		const headingMatch = raw.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			closeList();
			closeQuote();
			const level = Math.min(6, headingMatch[1].length);
			htmlParts.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
			return;
		}

		const quoteMatch = raw.match(/^\s*>\s?(.+)$/);
		if (quoteMatch) {
			closeList();
			if (!inQuote) {
				htmlParts.push('<blockquote>');
				inQuote = true;
			}
			htmlParts.push(`<p>${inlineFormat(quoteMatch[1])}</p>`);
			return;
		}
		closeQuote();

		const bulletMatch = raw.match(/^\s*[-*]\s+(.+)$/);
		if (bulletMatch) {
			if (listMode !== 'ul') {
				closeList();
				htmlParts.push('<ul>');
				listMode = 'ul';
			}
			htmlParts.push(`<li>${inlineFormat(bulletMatch[1])}</li>`);
			return;
		}

		const orderedMatch = raw.match(/^\s*\d+[\.)]\s+(.+)$/);
		if (orderedMatch) {
			if (listMode !== 'ol') {
				closeList();
				htmlParts.push('<ol>');
				listMode = 'ol';
			}
			htmlParts.push(`<li>${inlineFormat(orderedMatch[1])}</li>`);
			return;
		}

		closeList();
		htmlParts.push(`<p>${inlineFormat(raw)}</p>`);
	});

	flushCode();
	closeList();
	closeQuote();

	return htmlParts.join('\n');
}

function renderHelpMeReadme(hostElement, rawContent) {
	if (!hostElement) {
		return null;
	}

	const parsed = parseHelpMeReadme(rawContent);
	const hasContent = `${parsed.html || ''}`.trim().length > 0;

	if (!hasContent) {
		hostElement.innerHTML = '<div class="help-me-empty">No README content for this section yet.</div>';
		return null;
	}

	hostElement.innerHTML = '<div class="help-me-doc-shadow-host" id="helpMeDocShadowHost"></div>';
	const shadowHost = hostElement.querySelector('#helpMeDocShadowHost');
	if (!shadowHost) {
		hostElement.innerHTML = '<div class="help-me-empty">Failed to render README.</div>';
		return null;
	}

	const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
	const baseCss = `
		:host { display: block; color: #d5e2ff; }
		.readme-root {
			color: #dbeaff;
			font-family: "Segoe UI", Arial, sans-serif;
			line-height: 1.65;
			font-size: 0.99rem;
			max-width: 58rem;
			margin: 0 auto;
			padding: 0.25rem 0.15rem 0.4rem;
		}
		h1, h2, h3, h4, h5, h6 {
			color: #8cedff;
			margin: 1.15rem 0 0.55rem;
			line-height: 1.24;
			letter-spacing: 0.01em;
		}
		h1 {
			font-size: 1.7rem;
			padding: 0.2rem 0 0.65rem;
			border-bottom: 1px solid #234663;
			margin-top: 0.2rem;
			margin-bottom: 0.95rem;
			text-shadow: 0 0 0.9rem rgba(66, 195, 255, 0.2);
		}
		h2 {
			font-size: 1.34rem;
			padding-top: 0.35rem;
		}
		h3 { font-size: 1.14rem; }
		p { margin: 0.4rem 0 0.9rem; color: #d3e4f7; }
		ul, ol {
			margin: 0.45rem 0 1rem 1.3rem;
			padding: 0;
		}
		li { margin: 0.28rem 0; }
		hr {
			border: none;
			height: 1px;
			background: linear-gradient(90deg, rgba(48, 106, 156, 0) 0%, rgba(58, 140, 204, 0.85) 50%, rgba(48, 106, 156, 0) 100%);
			margin: 1rem 0;
		}
		pre {
			margin: 0.75rem 0 1.05rem;
			padding: 0.9rem;
			border-radius: 0.65rem;
			border: 1px solid #2a4763;
			background: linear-gradient(180deg, #0a1624 0%, #091320 100%);
			overflow: auto;
			box-shadow: inset 0 0 0.75rem rgba(22, 52, 83, 0.25);
		}
		code {
			font-family: "Consolas", "Courier New", monospace;
			font-size: 0.92em;
			color: #dbf4ff;
			background: rgba(22, 44, 66, 0.55);
			padding: 0.12rem 0.32rem;
			border-radius: 0.35rem;
		}
		pre code {
			white-space: pre;
			background: transparent;
			padding: 0;
			border-radius: 0;
		}
		a { color: #8dedff; text-underline-offset: 2px; }
		a:hover { color: #b5f6ff; }
		blockquote {
			margin: 0.65rem 0 1.05rem;
			padding: 0.55rem 0.8rem;
			border-left: 3px solid #3e78a5;
			background: rgba(17, 31, 46, 0.6);
			border-radius: 0 0.45rem 0.45rem 0;
			color: #a8c4df;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			margin: 0.7rem 0 1rem;
			font-size: 0.95rem;
		}
		th, td {
			border: 1px solid #27425d;
			padding: 0.45rem 0.55rem;
			vertical-align: top;
		}
		th {
			background: rgba(26, 52, 79, 0.7);
			color: #a9e7ff;
			text-align: left;
		}
		td { background: rgba(11, 22, 34, 0.55); }
		.readme-spacer { height: 0.15rem; }
		mark.help-me-find-mark {
			background: rgba(255, 211, 76, 0.35);
			border: 1px solid rgba(255, 211, 76, 0.55);
			color: #fff3d0;
			border-radius: 0.25rem;
			padding: 0.02rem 0.12rem;
		}
		mark.help-me-find-mark.help-me-find-active {
			background: rgba(255, 135, 66, 0.42);
			border-color: rgba(255, 162, 94, 0.95);
			box-shadow: 0 0 0.55rem rgba(255, 162, 94, 0.4);
		}
	`;

	shadowRoot.innerHTML = `
		<style>${baseCss}\n${parsed.css || ''}</style>
		<article class="readme-root">
			${parsed.html || ''}
		</article>
	`;

	return {
		shadowRoot,
		readmeRoot: shadowRoot.querySelector('.readme-root')
	};
}

function showHelpMe() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Help me</div><div class="chat-subtitle">Documentation</div></div>';
	messagesContainer.innerHTML = `
		<div class="help-me-layout">
			<div class="help-me-tree-panel">
				<div class="help-me-tree-header">
					<div class="help-me-tree-title-row">
						<span>Sections</span>
					</div>
					<div class="help-me-tree-search-wrap">
						<input id="helpMeSearchInput" class="help-me-search-input" type="text" placeholder="Search sections...">
						<button id="helpMeSearchPrev" class="help-me-search-nav" type="button" aria-label="Previous match">↑</button>
						<button id="helpMeSearchNext" class="help-me-search-nav" type="button" aria-label="Next match">↓</button>
						<button id="helpMeClearSearch" class="help-me-search-clear" type="button">Clear</button>
					</div>
				</div>
				<div id="helpMeTree" class="help-me-tree-list">Loading...</div>
			</div>
			<div class="help-me-content-panel">
				<div class="help-me-doc-topbar">
					<div id="helpMeDocTitle" class="help-me-doc-title">Select a section</div>
				</div>
				<div id="helpMeDocContent" class="help-me-doc-content">Choose a folder from the tree to view its README content.</div>
			</div>
		</div>
	`;

	const treeContainer = document.getElementById('helpMeTree');
	const docTitle = document.getElementById('helpMeDocTitle');
	const docContent = document.getElementById('helpMeDocContent');
	const searchInput = document.getElementById('helpMeSearchInput');
	const searchPrevButton = document.getElementById('helpMeSearchPrev');
	const searchNextButton = document.getElementById('helpMeSearchNext');
	const clearSearchButton = document.getElementById('helpMeClearSearch');

	const nodeMap = new Map();
	const parentMap = new Map();
	const expandedNodes = new Set();
	let selectedNodeId = null;
	let searchTerm = '';
	let nodesRoot = [];
	let globalMatchedNodeIds = [];
	const docFindState = {
		query: '',
		matches: [],
		activeIndex: -1,
		readmeRoot: null,
		originalHtml: ''
	};

	const refreshDocFindCounter = () => {
		const total = docFindState.matches.length;
		if (!docFindState.query || total === 0) {
			if (searchInput) {
				searchInput.title = 'Find in section and current document';
			}
			return;
		}
		if (searchInput) {
			searchInput.title = `Match ${docFindState.activeIndex + 1}/${total} in current document`;
		}
	};

	const setActiveDocMatch = (index, shouldScroll = true) => {
		const total = docFindState.matches.length;
		if (!total) {
			docFindState.activeIndex = -1;
			refreshDocFindCounter();
			return;
		}
		const normalized = ((index % total) + total) % total;
		docFindState.activeIndex = normalized;
		docFindState.matches.forEach((node, nodeIndex) => {
			node.classList.toggle('help-me-find-active', nodeIndex === normalized);
		});
		refreshDocFindCounter();
		if (shouldScroll) {
			const active = docFindState.matches[normalized];
			if (active && typeof active.scrollIntoView === 'function') {
				active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
			}
		}
	};

	const resetDocFindContent = () => {
		if (!docFindState.readmeRoot) {
			docFindState.matches = [];
			docFindState.activeIndex = -1;
			refreshDocFindCounter();
			return;
		}
		docFindState.readmeRoot.innerHTML = docFindState.originalHtml || '';
		docFindState.matches = [];
		docFindState.activeIndex = -1;
		refreshDocFindCounter();
	};

	const applyDocFind = (rawQuery) => {
		const query = `${rawQuery || ''}`;
		docFindState.query = query;
		resetDocFindContent();
		if (!query.trim() || !docFindState.readmeRoot) {
			return;
		}

		const regex = new RegExp(escapeHelpMeRegex(query), 'gi');
		const walker = document.createTreeWalker(docFindState.readmeRoot, NodeFilter.SHOW_TEXT);
		const textNodes = [];
		while (walker.nextNode()) {
			const currentNode = walker.currentNode;
			const parentTag = `${currentNode.parentElement && currentNode.parentElement.tagName || ''}`.toLowerCase();
			if (!currentNode.nodeValue || !currentNode.nodeValue.trim()) {
				continue;
			}
			if (parentTag === 'script' || parentTag === 'style') {
				continue;
			}
			textNodes.push(currentNode);
		}

		textNodes.forEach(textNode => {
			const textValue = textNode.nodeValue || '';
			regex.lastIndex = 0;
			if (!regex.test(textValue)) {
				return;
			}
			regex.lastIndex = 0;
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			let match = regex.exec(textValue);
			while (match) {
				const start = match.index;
				const end = start + match[0].length;
				if (start > lastIndex) {
					fragment.appendChild(document.createTextNode(textValue.slice(lastIndex, start)));
				}
				const mark = document.createElement('mark');
				mark.className = 'help-me-find-mark';
				mark.textContent = textValue.slice(start, end);
				fragment.appendChild(mark);
				lastIndex = end;
				match = regex.exec(textValue);
			}
			if (lastIndex < textValue.length) {
				fragment.appendChild(document.createTextNode(textValue.slice(lastIndex)));
			}
			if (textNode.parentNode) {
				textNode.parentNode.replaceChild(fragment, textNode);
			}
		});

		docFindState.matches = Array.from(docFindState.readmeRoot.querySelectorAll('mark.help-me-find-mark'));
		if (docFindState.matches.length > 0) {
			setActiveDocMatch(0, false);
		} else {
			refreshDocFindCounter();
		}
	};

	const moveDocFind = (delta) => {
		if (!docFindState.matches.length) {
			return;
		}
		setActiveDocMatch(docFindState.activeIndex + delta, true);
	};

	const getNodeSearchHaystack = (node) => {
		if (!node) {
			return '';
		}
		return normalizeHelpMeSearch(`${node.title || ''} ${node.path || ''} ${node.content || ''}`);
	};

	const updateGlobalSearchMatches = (rawQuery) => {
		const query = normalizeHelpMeSearch(rawQuery);
		if (!query) {
			globalMatchedNodeIds = [];
			return;
		}
		const matchedIds = [];
		for (const [nodeId, node] of nodeMap.entries()) {
			if (getNodeSearchHaystack(node).includes(query)) {
				matchedIds.push(nodeId);
			}
		}
		globalMatchedNodeIds = matchedIds;
	};

	const collectNodes = (nodes, parentId = null) => {
		(nodes || []).forEach(node => {
			if (!node || !node.id) {
				return;
			}
			nodeMap.set(node.id, node);
			if (parentId) {
				parentMap.set(node.id, parentId);
			}
			if (Array.isArray(node.children) && node.children.length > 0) {
				expandedNodes.add(node.id);
				collectNodes(node.children, node.id);
			}
		});
	};

	const ensureAncestorExpanded = (nodeId) => {
		let currentId = nodeId;
		let safety = 0;
		while (currentId && parentMap.has(currentId) && safety < 120) {
			const parentId = parentMap.get(currentId);
			if (parentId) {
				expandedNodes.add(parentId);
			}
			currentId = parentId;
			safety += 1;
		}
	};

	const renderDocument = (node) => {
		if (!node) {
			if (docTitle) {
				docTitle.textContent = 'Section not found';
			}
			if (docContent) {
				docContent.innerHTML = '<div class="help-me-empty">No content available.</div>';
			}
			return;
		}

		if (docTitle) {
			docTitle.textContent = node.title || 'Untitled';
		}

		if (docContent) {
			const content = `${node.content || ''}`;
			const rendered = renderHelpMeReadme(docContent, content);
			docFindState.readmeRoot = rendered && rendered.readmeRoot ? rendered.readmeRoot : null;
			docFindState.originalHtml = docFindState.readmeRoot ? docFindState.readmeRoot.innerHTML : '';
			docContent.scrollTop = 0;
			applyDocFind(searchTerm);
		}
	};

	const selectAndRenderNode = (nodeId, options = {}) => {
		if (!nodeId || !nodeMap.has(nodeId)) {
			return;
		}
		selectedNodeId = nodeId;
		ensureAncestorExpanded(nodeId);
		renderTree(nodesRoot);
		renderDocument(nodeMap.get(nodeId));
		if (options.focusLastMatch && docFindState.matches.length > 0) {
			setActiveDocMatch(docFindState.matches.length - 1, true);
		}
	};

	const navigateSearch = (delta) => {
		if (!normalizeHelpMeSearch(searchTerm)) {
			return;
		}

		if (docFindState.matches.length > 0) {
			const atStart = docFindState.activeIndex <= 0;
			const atEnd = docFindState.activeIndex >= (docFindState.matches.length - 1);
			if (delta > 0 && !atEnd) {
				moveDocFind(1);
				return;
			}
			if (delta < 0 && !atStart) {
				moveDocFind(-1);
				return;
			}
		}

		if (!globalMatchedNodeIds.length) {
			return;
		}

		const currentIndex = globalMatchedNodeIds.indexOf(selectedNodeId);
		const baseIndex = currentIndex >= 0
			? currentIndex
			: (delta > 0 ? -1 : 0);
		const targetIndex = ((baseIndex + delta) % globalMatchedNodeIds.length + globalMatchedNodeIds.length) % globalMatchedNodeIds.length;
		const targetNodeId = globalMatchedNodeIds[targetIndex];
		if (!targetNodeId) {
			return;
		}
		selectAndRenderNode(targetNodeId, { focusLastMatch: delta < 0 });
	};

	const filterTree = (nodes, term) => {
		void term;
		return nodes;
	};

	const createTreeBranch = (nodes, depth) => {
		const branch = document.createElement('div');
		branch.className = 'help-me-tree-branch';

		(nodes || []).forEach(node => {
			if (!node || !node.id) {
				return;
			}

			const hasChildren = Array.isArray(node.children) && node.children.length > 0;
			const item = document.createElement('div');
			item.className = 'help-me-tree-item';

			const row = document.createElement('div');
			row.className = 'help-me-tree-row';
			row.style.paddingLeft = `${depth * 0.72}rem`;

			if (hasChildren) {
				const toggleButton = document.createElement('button');
				toggleButton.type = 'button';
				toggleButton.className = 'help-me-tree-toggle';
				toggleButton.textContent = expandedNodes.has(node.id) ? '▾' : '▸';
				toggleButton.addEventListener('click', (event) => {
					event.stopPropagation();
					if (expandedNodes.has(node.id)) {
						expandedNodes.delete(node.id);
					} else {
						expandedNodes.add(node.id);
					}
					renderTree(nodesRoot);
				});
				row.appendChild(toggleButton);
			} else {
				const spacer = document.createElement('span');
				spacer.className = 'help-me-tree-spacer';
				spacer.setAttribute('aria-hidden', 'true');
				row.appendChild(spacer);
			}

			const titleButton = document.createElement('button');
			titleButton.type = 'button';
			titleButton.className = 'help-me-tree-node';
			titleButton.textContent = node.title || 'Untitled';
			titleButton.classList.toggle('active', selectedNodeId === node.id);
			titleButton.addEventListener('click', () => {
				selectedNodeId = node.id;
				ensureAncestorExpanded(node.id);
				renderTree(nodesRoot);
				renderDocument(nodeMap.get(selectedNodeId));
			});

			row.appendChild(titleButton);
			item.appendChild(row);

			if (hasChildren && expandedNodes.has(node.id)) {
				item.appendChild(createTreeBranch(node.children, depth + 1));
			}

			branch.appendChild(item);
		});

		return branch;
	};

	const renderTree = (nodes) => {
		if (!treeContainer) {
			return;
		}
		treeContainer.innerHTML = '';
		const filtered = filterTree(nodes, searchTerm);
		if (!Array.isArray(filtered) || filtered.length === 0) {
			treeContainer.innerHTML = '<div class="help-me-empty">No documentation folders found.</div>';
			return;
		}
		treeContainer.appendChild(createTreeBranch(filtered, 0));
	};

	if (searchInput) {
		searchInput.addEventListener('input', () => {
			searchTerm = searchInput.value || '';
			updateGlobalSearchMatches(searchTerm);
			renderTree(nodesRoot);
			if (normalizeHelpMeSearch(searchTerm) && globalMatchedNodeIds.length > 0 && !globalMatchedNodeIds.includes(selectedNodeId)) {
				selectAndRenderNode(globalMatchedNodeIds[0]);
			} else {
				applyDocFind(searchTerm);
			}
		});
		searchInput.addEventListener('keydown', (event) => {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				navigateSearch(1);
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				navigateSearch(-1);
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				navigateSearch(event.shiftKey ? -1 : 1);
			}
		});
	}
	if (searchPrevButton) {
		searchPrevButton.addEventListener('click', () => {
			navigateSearch(-1);
		});
	}
	if (searchNextButton) {
		searchNextButton.addEventListener('click', () => {
			navigateSearch(1);
		});
	}
	if (clearSearchButton) {
		clearSearchButton.addEventListener('click', () => {
			searchTerm = '';
			updateGlobalSearchMatches('');
			if (searchInput) {
				searchInput.value = '';
				searchInput.title = '';
			}
			renderTree(nodesRoot);
			applyDocFind('');
		});
	}

	if (window.__helpMeDocFindShortcutHandler) {
		document.removeEventListener('keydown', window.__helpMeDocFindShortcutHandler, true);
	}
	window.__helpMeDocFindShortcutHandler = (event) => {
		if (currentView !== 'help-me') {
			return;
		}
		const triggerFind = (event.ctrlKey || event.metaKey) && `${event.key || ''}`.toLowerCase() === 'f';
		if (!triggerFind) {
			return;
		}
		event.preventDefault();
		if (searchInput) {
			searchInput.focus();
			searchInput.select();
		}
	};
	document.addEventListener('keydown', window.__helpMeDocFindShortcutHandler, true);

	fetch('/api/help-me')
		.then(r => r.json())
		.then(payload => {
			if (!payload || payload.available === false) {
				if (treeContainer) {
					treeContainer.innerHTML = '<div class="help-me-empty">HelpMe folder not found.</div>';
				}
				renderDocument(null);
				return;
			}

			nodesRoot = Array.isArray(payload.tree) ? payload.tree : [];
			collectNodes(nodesRoot, null);
			updateGlobalSearchMatches(searchTerm);

			selectedNodeId = payload.default_node_id || (nodesRoot[0] && nodesRoot[0].id) || null;
			if (selectedNodeId) {
				ensureAncestorExpanded(selectedNodeId);
			}

			renderTree(nodesRoot);
			renderDocument(nodeMap.get(selectedNodeId));
		})
		.catch(error => {
			if (treeContainer) {
				treeContainer.innerHTML = `<div class="help-me-empty">Failed to load Help me data: ${escapeHelpMeText(error && error.message ? error.message : 'Unknown error')}</div>`;
			}
			renderDocument(null);
		});
}
