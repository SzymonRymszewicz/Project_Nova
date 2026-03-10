const MODULE_PROMPT_PREFIX = 'module::';
const CREATION_PREVIEW_FALLBACK_STYLE = 'background:linear-gradient(135deg,#19f2ff 0%,#ff2b9a 100%);';

function loadBotCreationView(advancedMode = false) {
	return ensureAvailableModulesLoaded()
		.then(() => ensureBotCreationDraftLoaded())
		.then(() => {
			renderBotCreationView(advancedMode);
		});
}

function showBotCreation() {
	inputArea.classList.remove('visible');
	chatHeader.innerHTML = '<div><div class="chat-title">Create Bot</div><div class="chat-subtitle">Add a new AI bot</div></div>';
	loadBotCreationView(false);
}

function showBotCreationAdvanced() {
	loadBotCreationView(true);
}

let botCreationDraft = null;
let botCreationDraftLoadPromise = null;
const DEFAULT_IAM_SET = 'IAM_1';
let botEditorIamState = { botName: '', setNames: [DEFAULT_IAM_SET], currentSet: DEFAULT_IAM_SET };
let availableModuleNames = [];
let availableModuleDefinitions = [];
let availableModulesPromise = null;
const loadedModuleAssetUrls = new Set();

function modulePromptKey(moduleName) {
	return `${MODULE_PROMPT_PREFIX}${moduleName}`;
}

function parseModulePromptKey(promptKey) {
	if (typeof promptKey !== 'string') {
		return null;
	}
	if (!promptKey.startsWith(MODULE_PROMPT_PREFIX)) {
		return null;
	}
	const moduleName = promptKey.slice(MODULE_PROMPT_PREFIX.length).trim();
	return moduleName || null;
}

function escapeHtml(value) {
	const text = `${value ?? ''}`;
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function getPromptOrderDefaults() {
	const preferredModuleOrder = ['TKAMES', 'Emotion', 'Empathy', 'Reasoning'];
	const available = Array.isArray(availableModuleNames) ? availableModuleNames.filter(Boolean) : [];
	const availableSet = new Set(available);
	const moduleKeys = [];

	preferredModuleOrder.forEach((moduleName) => {
		if (availableSet.has(moduleName)) {
			moduleKeys.push(modulePromptKey(moduleName));
		}
	});

	available.forEach((moduleName) => {
		if (!preferredModuleOrder.includes(moduleName)) {
			moduleKeys.push(modulePromptKey(moduleName));
		}
	});

	return ['core', 'scenario', 'user_persona', 'dataset', 'example_messages', 'iam', 'user_input', ...moduleKeys];
}

function getAdvancedModulePlaceholderSectionsMarkup(options = {}) {
	const prefix = `${options.prefix || 'bot'}`;
	const moduleDefs = Array.isArray(availableModuleDefinitions) ? availableModuleDefinitions : [];
	if (!moduleDefs.length) {
		return '';
	}
	const moduleSettings = normalizeModuleSettings(options.module_settings, moduleDefs);
	return moduleDefs.map(moduleDef => {
		const moduleName = `${(moduleDef && moduleDef.name) || ''}`.trim();
		if (!moduleName) {
			return '';
		}
		const defaults = moduleDef && typeof moduleDef.settings_defaults === 'object' ? moduleDef.settings_defaults : {};
		const values = moduleSettings[moduleName] || {};
		const settingKeys = Array.from(new Set([...Object.keys(defaults), ...Object.keys(values)])).filter(Boolean);
		const restoreButtonMarkup = `
			<div class="form-group" style="margin-top:auto;display:flex;justify-content:center;">
				<button type="button" class="action-btn cancel-btn module-restore-defaults-btn" data-module-prefix="${prefix}" data-module-name="${escapeHtml(moduleName)}">Restore ${escapeHtml(moduleName)} to defaults</button>
			</div>
		`;

		if (!settingKeys.length) {
			return `
			<div class="bot-editor-section module-settings-section" data-module-prefix="${escapeHtml(prefix)}" data-module-name="${escapeHtml(moduleName)}">
				<h3>${moduleName} Module</h3>
				<div class="form-group">
					<p>No configurable settings for this module.</p>
				</div>
				${restoreButtonMarkup}
			</div>
		`;
		}

		const settingRows = settingKeys.map((key) => {
			const keyText = `${key || ''}`.trim();
			const valueText = `${(values[keyText] ?? defaults[keyText] ?? '')}`;
			return `
				<div class="form-group">
					<label>${escapeHtml(keyText)}</label>
					<input type="text" class="text-input module-setting-input" id="${getModuleSettingInputId(prefix, moduleName, keyText)}" data-module-prefix="${prefix}" data-module-name="${escapeHtml(moduleName)}" data-setting-key="${escapeHtml(keyText)}" value="${escapeHtml(valueText)}">
				</div>
			`;
		}).join('');

		return `
			<div class="bot-editor-section module-settings-section" data-module-prefix="${escapeHtml(prefix)}" data-module-name="${escapeHtml(moduleName)}">
				<h3>${moduleName} Module</h3>
				${settingRows}
				${restoreButtonMarkup}
			</div>
		`;
	}).join('');
}

function getModuleNamesInPromptOrder(order) {
	const names = new Set();
	(order || []).forEach((key) => {
		const moduleName = parseModulePromptKey(key);
		if (!moduleName) {
			return;
		}
		names.add(moduleName.toLowerCase());
	});
	return names;
}

function syncAdvancedModuleSectionsVisibility(prefix, promptOrder) {
	const normalizedPrefix = `${prefix || ''}`.trim().toLowerCase();
	if (!normalizedPrefix) {
		return;
	}
	const activeModules = getModuleNamesInPromptOrder(Array.isArray(promptOrder) ? promptOrder : []);
	document.querySelectorAll(`.module-settings-section[data-module-prefix="${normalizedPrefix}"]`).forEach((section) => {
		const moduleName = `${section.getAttribute('data-module-name') || ''}`.trim().toLowerCase();
		const visible = !!moduleName && activeModules.has(moduleName);
		section.classList.toggle('module-settings-section-hidden', !visible);
		section.style.display = visible ? '' : 'none';
	});
	if (typeof scheduleMasonryRefresh === 'function') {
		const editor = document.querySelector('.bot-editor');
		if (editor) {
			scheduleMasonryRefresh(editor);
		}
	}
}

function getModuleDefinitionByName(moduleName) {
	const nameText = `${moduleName || ''}`.trim();
	if (!nameText) {
		return null;
	}
	return (availableModuleDefinitions || []).find((def) => `${(def && def.name) || ''}`.trim() === nameText) || null;
}

function getModuleSettingsDefaults(moduleName) {
	const definition = getModuleDefinitionByName(moduleName);
	const defaults = definition && typeof definition.settings_defaults === 'object' ? definition.settings_defaults : {};
	const normalized = {};
	Object.keys(defaults).forEach((key) => {
		const keyText = `${key || ''}`.trim();
		if (!keyText) {
			return;
		}
		normalized[keyText] = `${defaults[key] ?? ''}`;
	});
	return normalized;
}

function normalizeModuleSettings(inputSettings, moduleDefs) {
	const defs = Array.isArray(moduleDefs) ? moduleDefs : [];
	const provided = inputSettings && typeof inputSettings === 'object' ? inputSettings : {};
	const normalized = {};

	defs.forEach((def) => {
		const moduleName = `${(def && def.name) || ''}`.trim();
		if (!moduleName) {
			return;
		}
		const defaults = getModuleSettingsDefaults(moduleName);
		const fromInput = provided[moduleName] && typeof provided[moduleName] === 'object' ? provided[moduleName] : {};
		const merged = { ...defaults };
		Object.keys(fromInput).forEach((key) => {
			const keyText = `${key || ''}`.trim();
			if (!keyText) {
				return;
			}
			merged[keyText] = `${fromInput[key] ?? ''}`;
		});
		normalized[moduleName] = merged;
	});

	Object.keys(provided).forEach((moduleName) => {
		const moduleText = `${moduleName || ''}`.trim();
		if (!moduleText || normalized[moduleText]) {
			return;
		}
		const value = provided[moduleName];
		if (!value || typeof value !== 'object') {
			return;
		}
		normalized[moduleText] = {};
		Object.keys(value).forEach((key) => {
			const keyText = `${key || ''}`.trim();
			if (!keyText) {
				return;
			}
			normalized[moduleText][keyText] = `${value[key] ?? ''}`;
		});
	});

	return normalized;
}

function getModuleSettingInputId(prefix, moduleName, settingKey) {
	const clean = (value) => `${value || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	return `${clean(prefix)}-module-${clean(moduleName)}-${clean(settingKey)}`;
}

function applyModuleDefaultsToInputs(prefix, moduleName) {
	const defaults = getModuleSettingsDefaults(moduleName);
	Object.keys(defaults).forEach((settingKey) => {
		const inputId = getModuleSettingInputId(prefix, moduleName, settingKey);
		const input = document.getElementById(inputId);
		if (input) {
			input.value = `${defaults[settingKey] ?? ''}`;
		}
	});
}

function handleCreateModuleDefaultsRestore(moduleName) {
	if (!botCreationDraft) {
		return;
	}
	const moduleText = `${moduleName || ''}`.trim();
	if (!moduleText) {
		return;
	}
	if (!confirm(`Restore ${moduleText} settings to defaults for this bot?`)) {
		return;
	}
	const defaults = getModuleSettingsDefaults(moduleText);
	const next = normalizeModuleSettings(botCreationDraft.module_settings, availableModuleDefinitions);
	next[moduleText] = { ...defaults };
	botCreationDraft.module_settings = next;
	applyModuleDefaultsToInputs('create', moduleText);
	updateCreationDraftFromForm();
}

function bindModuleRestoreButtons(prefix, onRestore) {
	document.querySelectorAll(`.module-restore-defaults-btn[data-module-prefix="${prefix}"]`).forEach((button) => {
		button.addEventListener('click', () => {
			const moduleName = `${button.getAttribute('data-module-name') || ''}`.trim();
			if (!moduleName) {
				return;
			}
			onRestore(moduleName);
		});
	});
}

function ensureAvailableModulesLoaded(forceReload = false) {
	if (!forceReload && availableModulesPromise) {
		return availableModulesPromise;
	}

	availableModulesPromise = fetch('/api/modules')
		.then(r => r.json())
		.then(data => {
			const list = Array.isArray(data) ? data : [];
			const map = new Map();
			list.forEach((item) => {
				const moduleName = typeof item === 'string'
					? `${item || ''}`.trim()
					: `${(item && item.name) || ''}`.trim();
				if (!moduleName) {
					return;
				}
				if (!map.has(moduleName)) {
					const rawSettingsDefaults = (item && typeof item.settings_defaults === 'object') ? item.settings_defaults : {};
					const normalizedSettingsDefaults = {};
					Object.keys(rawSettingsDefaults).forEach((key) => {
						const keyText = `${key || ''}`.trim();
						if (!keyText) {
							return;
						}
						normalizedSettingsDefaults[keyText] = `${rawSettingsDefaults[key] ?? ''}`;
					});
					const scriptUrls = Array.isArray(item && item.script_urls)
						? item.script_urls.map(url => `${url || ''}`.trim()).filter(Boolean)
						: [];
					const styleUrls = Array.isArray(item && item.style_urls)
						? item.style_urls.map(url => `${url || ''}`.trim()).filter(Boolean)
						: [];
					const scriptUrl = typeof item === 'string' ? '' : `${item.script_url || ''}`.trim();
					const styleUrl = typeof item === 'string' ? '' : `${item.style_url || ''}`.trim();
					if (scriptUrl && !scriptUrls.includes(scriptUrl)) {
						scriptUrls.unshift(scriptUrl);
					}
					if (styleUrl && !styleUrls.includes(styleUrl)) {
						styleUrls.unshift(styleUrl);
					}
					map.set(moduleName, {
						name: moduleName,
						prompt_key: typeof item === 'string' ? modulePromptKey(moduleName) : `${(item.prompt_key || modulePromptKey(moduleName))}`,
						script_url: scriptUrl,
						style_url: styleUrl,
						script_urls: scriptUrls,
						style_urls: styleUrls,
						settings_defaults: normalizedSettingsDefaults
					});
				}
			});

			availableModuleDefinitions = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
			availableModuleNames = availableModuleDefinitions.map(item => item.name);
			loadAvailableModuleAssets(availableModuleDefinitions);
			return availableModuleNames;
		})
		.catch(() => {
			availableModuleDefinitions = [];
			availableModuleNames = [];
			return availableModuleNames;
		});

	return availableModulesPromise;
}

function loadAvailableModuleAssets(moduleDefinitions) {
	(moduleDefinitions || []).forEach((moduleDef) => {
		const styleUrls = Array.isArray(moduleDef && moduleDef.style_urls)
			? moduleDef.style_urls
			: [`${(moduleDef && moduleDef.style_url) || ''}`.trim()].filter(Boolean);
		const scriptUrls = Array.isArray(moduleDef && moduleDef.script_urls)
			? moduleDef.script_urls
			: [`${(moduleDef && moduleDef.script_url) || ''}`.trim()].filter(Boolean);

		styleUrls.forEach((styleUrlRaw) => {
			const styleUrl = `${styleUrlRaw || ''}`.trim();
			if (!styleUrl || loadedModuleAssetUrls.has(styleUrl)) {
				return;
			}
			const exists = document.querySelector(`link[data-module-asset="${styleUrl}"]`);
			if (!exists) {
				const link = document.createElement('link');
				link.rel = 'stylesheet';
				link.href = styleUrl;
				link.setAttribute('data-module-asset', styleUrl);
				document.head.appendChild(link);
			}
			loadedModuleAssetUrls.add(styleUrl);
		});

		scriptUrls.forEach((scriptUrlRaw) => {
			const scriptUrl = `${scriptUrlRaw || ''}`.trim();
			if (!scriptUrl || loadedModuleAssetUrls.has(scriptUrl)) {
				return;
			}
			const exists = document.querySelector(`script[data-module-asset="${scriptUrl}"]`);
			if (!exists) {
				const script = document.createElement('script');
				script.src = scriptUrl;
				script.defer = true;
				script.setAttribute('data-module-asset', scriptUrl);
				document.body.appendChild(script);
			}
			loadedModuleAssetUrls.add(scriptUrl);
		});
	});
}

function getSortedIamSetNames(setNames) {
	const extractIndex = (name) => {
		const match = /^IAM_(\d+)$/i.exec(name || '');
		return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
	};
	return [...new Set((setNames || []).filter(Boolean))].sort((a, b) => {
		const ai = extractIndex(a);
		const bi = extractIndex(b);
		if (ai !== bi) {
			return ai - bi;
		}
		return String(a).localeCompare(String(b));
	});
}

function getNextIamSetName(existingNames) {
	const names = existingNames || [];
	let maxIndex = 0;
	names.forEach(name => {
		const match = /^IAM_(\d+)$/i.exec(name || '');
		if (match) {
			maxIndex = Math.max(maxIndex, parseInt(match[1], 10));
		}
	});
	return `IAM_${maxIndex + 1}`;
}

function normalizeIamSets(rawSets, rawCurrentSet, fallbackItems = []) {
	const fallback = Array.isArray(fallbackItems) ? fallbackItems : [];
	const input = rawSets && typeof rawSets === 'object' ? rawSets : {};
	const normalized = {};
	Object.keys(input).forEach(setName => {
		const safeName = setName || DEFAULT_IAM_SET;
		const value = input[setName];
		normalized[safeName] = Array.isArray(value) ? value.map(item => String(item || '')) : [];
	});
	if (Object.keys(normalized).length === 0) {
		normalized[DEFAULT_IAM_SET] = fallback.map(item => String(item || ''));
	}
	const orderedNames = getSortedIamSetNames(Object.keys(normalized));
	const current = orderedNames.includes(rawCurrentSet) ? rawCurrentSet : orderedNames[0];
	return { sets: normalized, currentSet: current, setNames: orderedNames };
}

function getCurrentCreationIamItems() {
	const { sets, currentSet } = normalizeIamSets(botCreationDraft?.iam_sets, botCreationDraft?.current_iam_set, botCreationDraft?.iam_items || []);
	return sets[currentSet] || [];
}

function getEmptyBotCreationDraft() {
	return {
		name: '',
		description: '',
		core_data: '',
		scenario_data: '',
		example_messages: '',
		example_injection_threshold: 0,
		dataset_injection_persistence: 6,
		cover_art: '',
		icon_art: '',
		cover_art_fit: { size: 100, x: 50, y: 50 },
		icon_fit: { size: 100, x: 50, y: 50 },
		active_dataset_id: '',
		prompt_order: getPromptOrderDefaults(),
		prompt_order_enabled: {},
		modules: {
			module_group_1: [],
			module_group_2: [],
			module_group_3: []
		},
		module_settings: {},
		iam_sets: { [DEFAULT_IAM_SET]: [] },
		current_iam_set: DEFAULT_IAM_SET,
		iam_items: [],
		images: [],
		cover_image_name: '',
		icon_image_name: ''
	};
}

function normalizeBotCreationDraft(raw) {
	const defaults = getEmptyBotCreationDraft();
	const draft = raw && typeof raw === 'object' ? raw : {};
	const normalizedIam = normalizeIamSets(draft?.iam_sets, draft?.current_iam_set, draft?.iam_items || []);
	return {
		...defaults,
		...draft,
		active_dataset_id: normalizeDatasetSelection(draft?.active_dataset_id),
		dataset_injection_persistence: Math.max(0, parseInt(draft?.dataset_injection_persistence, 10) || 6),
		example_messages: `${draft?.example_messages ?? defaults.example_messages}`,
		example_injection_threshold: Math.max(0, parseInt(draft?.example_injection_threshold, 10) || 0),
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
		prompt_order: normalizePromptOrder(draft?.prompt_order),
		prompt_order_enabled: normalizePromptOrderEnabled(draft?.prompt_order_enabled),
		modules: normalizeModuleGroups(draft?.modules),
		module_settings: normalizeModuleSettings(draft?.module_settings, availableModuleDefinitions),
		iam_sets: normalizedIam.sets,
		current_iam_set: normalizedIam.currentSet,
		iam_items: normalizedIam.sets[normalizedIam.currentSet] || [],
		images: Array.isArray(draft?.images) ? draft.images : []
	};
}

function normalizeDatasetSelection(value) {
	const safe = `${value || ''}`.trim();
	if (!safe || safe.toLowerCase() === 'none') {
		return '';
	}
	return safe;
}

function renderCreateDatasetOptions(datasetItems = []) {
	const select = document.getElementById('create-bot-dataset');
	if (!select) {
		return;
	}
	const selected = normalizeDatasetSelection(botCreationDraft && botCreationDraft.active_dataset_id);
	const rows = Array.isArray(datasetItems) ? datasetItems : [];
	const options = ['<option value="">None</option>'];
	rows.forEach((dataset) => {
		const id = `${dataset?.id || ''}`.trim();
		if (!id) {
			return;
		}
		const name = `${dataset?.name || 'Untitled Dataset'}`;
		const isSelected = id === selected ? 'selected' : '';
		options.push(`<option value="${escapeHtml(id)}" ${isSelected}>${escapeHtml(name)}</option>`);
	});
	select.innerHTML = options.join('');
	select.value = selected;
}

function refreshCreateDatasetOptions() {
	if (!botCreationDraft) {
		return Promise.resolve();
	}
	return fetch('/api/datasets')
		.then(r => r.json())
		.then((result) => {
			const rows = Array.isArray(result?.datasets) ? result.datasets : [];
			renderCreateDatasetOptions(rows);
		});
}

function ensureBotCreationDraftLoaded(forceReload = false) {
	if (!forceReload && botCreationDraft) {
		return Promise.resolve(botCreationDraft);
	}
	if (!forceReload && botCreationDraftLoadPromise) {
		return botCreationDraftLoadPromise;
	}

	botCreationDraftLoadPromise = fetch('/api/bot/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'load' })
	})
		.then(r => r.json())
		.then(result => {
			const serverDraft = result && result.success ? result.draft : null;
			botCreationDraft = normalizeBotCreationDraft(serverDraft || getEmptyBotCreationDraft());
			return botCreationDraft;
		})
		.catch(() => {
			botCreationDraft = normalizeBotCreationDraft(getEmptyBotCreationDraft());
			return botCreationDraft;
		})
		.finally(() => {
			botCreationDraftLoadPromise = null;
		});

	return botCreationDraftLoadPromise;
}

function saveBotCreationDraft() {
	if (!botCreationDraft) {
		return true;
	}
	fetch('/api/bot/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'save', draft: botCreationDraft })
	})
		.then(r => r.json())
		.then(result => {
			if (!result || !result.success) {
				if (typeof showToast === 'function') {
					showToast('Failed to save draft on disk.', 'warning', 2400);
				}
			}
		})
		.catch(() => {
			if (typeof showToast === 'function') {
				showToast('Failed to save draft on disk.', 'warning', 2400);
			}
		});
	return true;
}

function clearBotCreationDraft() {
	botCreationDraft = getEmptyBotCreationDraft();
	fetch('/api/bot/draft', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'clear' })
	}).catch(() => {});
}

function readFileAsDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsDataURL(file);
	});
}

function fetchUrlAsDataUrl(url) {
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
		}));
}

function getDataUrlExtension(dataUrl) {
	if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
		return 'png';
	}
	const match = dataUrl.match(/^data:([^;]+);/i);
	if (!match || !match[1]) {
		return 'png';
	}
	const mime = match[1].toLowerCase();
	if (mime === 'image/jpeg') {
		return 'jpg';
	}
	if (mime === 'image/svg+xml') {
		return 'svg';
	}
	if (mime === 'image/webp') {
		return 'webp';
	}
	if (mime === 'image/gif') {
		return 'gif';
	}
	return 'png';
}

function buildUniqueImageName(images, baseName) {
	const existingNames = new Set((images || []).map(img => img.name));
	if (!existingNames.has(baseName)) {
		return baseName;
	}
	const dotIndex = baseName.lastIndexOf('.');
	const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
	const ext = dotIndex > 0 ? baseName.slice(dotIndex) : '';
	let index = 1;
	let candidate = `${stem}_${index}${ext}`;
	while (existingNames.has(candidate)) {
		index += 1;
		candidate = `${stem}_${index}${ext}`;
	}
	return candidate;
}

function ensureDraftImageReference(images, preferredName, dataUrl, fallbackBaseName) {
	if (!dataUrl) {
		return preferredName || '';
	}
	const imageList = Array.isArray(images) ? images : [];
	if (preferredName && imageList.some(img => img.name === preferredName)) {
		return preferredName;
	}
	const existingByContent = imageList.find(img => img.data_url === dataUrl);
	if (existingByContent) {
		return existingByContent.name;
	}
	const extension = getDataUrlExtension(dataUrl);
	const proposedName = `${fallbackBaseName}.${extension}`;
	const uniqueName = buildUniqueImageName(imageList, proposedName);
	imageList.push({ name: uniqueName, data_url: dataUrl });
	return uniqueName;
}

function setCreationPreviewStyle(targetId, art, fit, fallback) {
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
	target.textContent = botCreationDraft.name ? botCreationDraft.name[0].toUpperCase() : 'B';
}

function setTokenBadgeValue(badgeId, value) {
	const badge = document.getElementById(badgeId);
	if (!badge) {
		return;
	}
	badge.textContent = `${Number.isFinite(value) ? value : 0} tok`;
}

function computeBotIamTokenTotal(containerId) {
	const container = document.getElementById(containerId);
	if (!container) {
		return 0;
	}
	const rows = Array.from(container.querySelectorAll('textarea'));
	return rows.reduce((total, row) => total + estimateUiTokens(row.value || ''), 0);
}

function refreshCreateBotTokenCounters() {
	const coreInput = document.getElementById('create-bot-core');
	const scenarioInput = document.getElementById('create-bot-scenario');
	const exampleMessagesInput = document.getElementById('create-bot-example-messages');
	setTokenBadgeValue('create-core-token-count', estimateUiTokens(coreInput ? coreInput.value : ''));
	setTokenBadgeValue('create-scenario-token-count', estimateUiTokens(scenarioInput ? scenarioInput.value : ''));
	setTokenBadgeValue('create-example-token-count', estimateUiTokens(exampleMessagesInput ? exampleMessagesInput.value : ''));
	setTokenBadgeValue('create-iam-token-total', computeBotIamTokenTotal('create-bot-iam-list'));
}

function refreshEditBotTokenCounters() {
	const coreInput = document.getElementById('bot-core');
	const scenarioInput = document.getElementById('bot-scenario');
	const exampleMessagesInput = document.getElementById('bot-example-messages');
	setTokenBadgeValue('bot-core-token-count', estimateUiTokens(coreInput ? coreInput.value : ''));
	setTokenBadgeValue('bot-scenario-token-count', estimateUiTokens(scenarioInput ? scenarioInput.value : ''));
	setTokenBadgeValue('bot-example-token-count', estimateUiTokens(exampleMessagesInput ? exampleMessagesInput.value : ''));
	setTokenBadgeValue('bot-iam-token-total', computeBotIamTokenTotal('bot-iam-list'));
}

function updateCreationDraftFromForm() {
	if (!botCreationDraft) {
		return;
	}
	const nameInput = document.getElementById('create-bot-name');
	const descInput = document.getElementById('create-bot-description');
	const coreInput = document.getElementById('create-bot-core');
	const scenarioInput = document.getElementById('create-bot-scenario');
	const exampleMessagesInput = document.getElementById('create-bot-example-messages');
	const exampleThresholdInput = document.getElementById('create-bot-example-threshold');
	const datasetPersistenceInput = document.getElementById('create-bot-dataset-injection-persistence');
	const coverZoom = document.getElementById('create-cover-zoom');
	const coverPosX = document.getElementById('create-cover-posX');
	const coverPosY = document.getElementById('create-cover-posY');
	const iconZoom = document.getElementById('create-icon-zoom');
	const iconPosX = document.getElementById('create-icon-posX');
	const iconPosY = document.getElementById('create-icon-posY');

	if (nameInput) {
		botCreationDraft.name = nameInput.value;
	}
	if (descInput) {
		botCreationDraft.description = descInput.value;
	}
	if (coreInput) {
		botCreationDraft.core_data = coreInput.value;
	}
	if (scenarioInput) {
		botCreationDraft.scenario_data = scenarioInput.value;
	}
	if (exampleMessagesInput) {
		botCreationDraft.example_messages = exampleMessagesInput.value;
	}
	if (exampleThresholdInput) {
		const parsedThreshold = parseInt(exampleThresholdInput.value, 10);
		botCreationDraft.example_injection_threshold = Math.max(0, Number.isFinite(parsedThreshold) ? parsedThreshold : 0);
	}
	if (datasetPersistenceInput) {
		const parsedPersistence = parseInt(datasetPersistenceInput.value, 10);
		botCreationDraft.dataset_injection_persistence = Math.max(0, Number.isFinite(parsedPersistence) ? parsedPersistence : 6);
	}
	const datasetSelect = document.getElementById('create-bot-dataset');
	if (datasetSelect) {
		botCreationDraft.active_dataset_id = normalizeDatasetSelection(datasetSelect.value);
	}

	if (coverZoom && coverPosX && coverPosY) {
		botCreationDraft.cover_art_fit = {
			size: parseInt(coverZoom.value, 10),
			x: parseInt(coverPosX.value, 10),
			y: parseInt(coverPosY.value, 10)
		};
	}
	if (iconZoom && iconPosX && iconPosY) {
		botCreationDraft.icon_fit = {
			size: parseInt(iconZoom.value, 10),
			x: parseInt(iconPosX.value, 10),
			y: parseInt(iconPosY.value, 10)
		};
	}

	const createPromptOrderContainer = document.getElementById('create-prompt-order-list');
	if (createPromptOrderContainer) {
		const promptOrderState = readPromptOrderEditorState('create-prompt-order-list');
		botCreationDraft.prompt_order = promptOrderState.order;
		botCreationDraft.prompt_order_enabled = promptOrderState.enabled;
	}

	const moduleInputs = document.querySelectorAll('.module-setting-input[data-module-prefix="create"]');
	if (moduleInputs.length) {
		const updatedModuleSettings = normalizeModuleSettings(botCreationDraft.module_settings, availableModuleDefinitions);
		moduleInputs.forEach((input) => {
			const moduleName = `${input.getAttribute('data-module-name') || ''}`.trim();
			const settingKey = `${input.getAttribute('data-setting-key') || ''}`.trim();
			if (!moduleName || !settingKey) {
				return;
			}
			if (!updatedModuleSettings[moduleName] || typeof updatedModuleSettings[moduleName] !== 'object') {
				updatedModuleSettings[moduleName] = {};
			}
			updatedModuleSettings[moduleName][settingKey] = `${input.value || ''}`;
		});
		botCreationDraft.module_settings = updatedModuleSettings;
	}

	const iamRows = document.querySelectorAll('.create-iam-item');
	const items = Array.from(iamRows)
		.map(row => (row.querySelector('.create-iam-input') || {}).value || '')
		.map(value => value.trim())
		.filter(Boolean);
	const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
	normalizedIam.sets[normalizedIam.currentSet] = items;
	botCreationDraft.iam_sets = normalizedIam.sets;
	botCreationDraft.current_iam_set = normalizedIam.currentSet;
	botCreationDraft.iam_items = items;

	refreshCreateBotTokenCounters();

	saveBotCreationDraft();
}

function renderBotCreationIamList() {
	const list = document.getElementById('create-bot-iam-list');
	if (!list || !botCreationDraft) {
		return;
	}
	const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
	botCreationDraft.iam_sets = normalizedIam.sets;
	botCreationDraft.current_iam_set = normalizedIam.currentSet;
	botCreationDraft.iam_items = normalizedIam.sets[normalizedIam.currentSet] || [];
	const iamLabel = document.getElementById('create-iam-set-label');
	if (iamLabel) {
		iamLabel.textContent = botCreationDraft.current_iam_set;
	}
	list.innerHTML = '';
	const items = botCreationDraft.iam_items.length ? botCreationDraft.iam_items : [''];
	items.forEach(content => {
		const row = document.createElement('div');
		row.className = 'iam-item create-iam-item';
		row.innerHTML = `<textarea class="setting-input iam-input create-iam-input" rows="2">${content || ''}</textarea><button class="btn btn-secondary create-iam-delete" type="button">Delete</button>`;
		const deleteBtn = row.querySelector('.create-iam-delete');
		const input = row.querySelector('.create-iam-input');
		if (deleteBtn) {
			deleteBtn.addEventListener('click', () => {
				row.remove();
				updateCreationDraftFromForm();
			});
		}
		if (input) {
			input.addEventListener('input', updateCreationDraftFromForm);
		}
		list.appendChild(row);
	});
	refreshCreateBotTokenCounters();
}

function renderBotCreationImages() {
	const gallery = document.getElementById('create-bot-image-gallery');
	if (!gallery || !botCreationDraft) {
		return;
	}
	if (!botCreationDraft.images.length) {
		gallery.innerHTML = '<p style="color: #999; grid-column: 1/-1;">No images yet</p>';
		return;
	}
	gallery.innerHTML = '';
	botCreationDraft.images.forEach(img => {
		const card = document.createElement('div');
		card.className = 'image-card';
		card.innerHTML = `
			<div class="image-thumb" style="background-image: url('${img.data_url}'); background-size: cover; background-position: center;"></div>
			<div class="image-actions">
				<button class="img-action-btn create-img-cover" type="button" title="Set as cover">🖼️</button>
				<button class="img-action-btn create-img-icon" type="button" title="Set as icon">👤</button>
				<button class="img-action-btn delete-btn create-img-delete" type="button" title="Delete">🗑️</button>
			</div>
		`;
		card.querySelector('.create-img-cover').addEventListener('click', () => {
			botCreationDraft.cover_art = img.data_url;
			botCreationDraft.cover_image_name = img.name;
			saveBotCreationDraft();
			setCreationPreviewStyle('create-cover-preview', botCreationDraft.cover_art, botCreationDraft.cover_art_fit, CREATION_PREVIEW_FALLBACK_STYLE);
		});
		card.querySelector('.create-img-icon').addEventListener('click', () => {
			botCreationDraft.icon_art = img.data_url;
			botCreationDraft.icon_image_name = img.name;
			saveBotCreationDraft();
			setCreationPreviewStyle('create-icon-preview', botCreationDraft.icon_art, botCreationDraft.icon_fit, CREATION_PREVIEW_FALLBACK_STYLE);
		});
		card.querySelector('.create-img-delete').addEventListener('click', () => {
			botCreationDraft.images = botCreationDraft.images.filter(item => item.name !== img.name);
			if (botCreationDraft.cover_image_name === img.name) {
				botCreationDraft.cover_image_name = '';
				botCreationDraft.cover_art = '';
			}
			if (botCreationDraft.icon_image_name === img.name) {
				botCreationDraft.icon_image_name = '';
				botCreationDraft.icon_art = '';
			}
			saveBotCreationDraft();
			renderBotCreationImages();
			setCreationPreviewStyle('create-cover-preview', botCreationDraft.cover_art, botCreationDraft.cover_art_fit, CREATION_PREVIEW_FALLBACK_STYLE);
			setCreationPreviewStyle('create-icon-preview', botCreationDraft.icon_art, botCreationDraft.icon_fit, CREATION_PREVIEW_FALLBACK_STYLE);
		});
		gallery.appendChild(card);
	});
}

function bindBotCreationAdjustments() {
	const bindRange = (id, callback) => {
		const el = document.getElementById(id);
		if (!el) {
			return;
		}
		el.addEventListener('input', callback);
	};

	const updateCover = () => {
		updateCreationDraftFromForm();
		document.getElementById('create-cover-zoom-val').textContent = `${botCreationDraft.cover_art_fit.size}%`;
		document.getElementById('create-cover-posX-val').textContent = `${botCreationDraft.cover_art_fit.x}%`;
		document.getElementById('create-cover-posY-val').textContent = `${botCreationDraft.cover_art_fit.y}%`;
		setCreationPreviewStyle('create-cover-preview', botCreationDraft.cover_art, botCreationDraft.cover_art_fit, CREATION_PREVIEW_FALLBACK_STYLE);
	};
	const updateIcon = () => {
		updateCreationDraftFromForm();
		document.getElementById('create-icon-zoom-val').textContent = `${botCreationDraft.icon_fit.size}%`;
		document.getElementById('create-icon-posX-val').textContent = `${botCreationDraft.icon_fit.x}%`;
		document.getElementById('create-icon-posY-val').textContent = `${botCreationDraft.icon_fit.y}%`;
		setCreationPreviewStyle('create-icon-preview', botCreationDraft.icon_art, botCreationDraft.icon_fit, CREATION_PREVIEW_FALLBACK_STYLE);
	};

	['create-cover-zoom', 'create-cover-posX', 'create-cover-posY'].forEach(id => bindRange(id, updateCover));
	['create-icon-zoom', 'create-icon-posX', 'create-icon-posY'].forEach(id => bindRange(id, updateIcon));
}

function loadCloneBotOptions(menuEl) {
	if (!menuEl) {
		return;
	}
	menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Loading bots...</button>';
	fetch('/api/bots')
		.then(r => r.json())
		.then(bots => {
			const list = Array.isArray(bots) ? bots : [];
			if (!list.length) {
				menuEl.innerHTML = '<button class="persona-option" type="button" disabled>No bots available</button>';
				return;
			}
			menuEl.innerHTML = '';
			list.forEach(bot => {
				const option = document.createElement('button');
				option.type = 'button';
				option.className = 'persona-option';
				const icon = document.createElement('span');
				icon.className = 'persona-option-icon';
				if (bot.icon_art || bot.cover_art) {
					icon.style.cssText = buildImageStyle(bot.icon_art || bot.cover_art, bot.icon_fit || bot.cover_art_fit || null);
					icon.textContent = '';
				} else {
					icon.textContent = (bot.name || 'B')[0].toUpperCase();
				}
				const text = document.createElement('span');
				text.className = 'persona-option-text';
				text.textContent = bot.name;
				option.appendChild(icon);
				option.appendChild(text);
				option.addEventListener('click', () => {
					cloneExistingBotIntoDraft(bot.name);
					menuEl.classList.add('hidden');
				});
				menuEl.appendChild(option);
			});
		})
		.catch(() => {
			menuEl.innerHTML = '<button class="persona-option" type="button" disabled>Failed to load bots</button>';
		});
}

function cloneExistingBotIntoDraft(botName) {
	Promise.all([
		fetch('/api/bot/select', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bot_name: botName })
		}).then(r => r.json()),
		fetch('/api/bot/iam', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'list_all', bot_name: botName })
		}).then(r => r.json()),
		fetch('/api/bot/images', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'list', bot_name: botName })
		}).then(r => r.json())
	])
		.then(async ([botResponse, iamResponse, imagesResponse]) => {
			if (!botResponse || !botResponse.success || !botResponse.bot) {
				alert('Failed to clone bot.');
				return;
			}
			const bot = botResponse.bot;
			const iamSetsPayload = (iamResponse && Array.isArray(iamResponse.sets)) ? iamResponse.sets : [];
			const iamSets = {};
			iamSetsPayload.forEach(setEntry => {
				const setName = (setEntry && setEntry.name) ? setEntry.name : DEFAULT_IAM_SET;
				const setItems = (setEntry && Array.isArray(setEntry.items)) ? setEntry.items.map(item => item.content).filter(Boolean) : [];
				iamSets[setName] = setItems;
			});
			const normalizedIam = normalizeIamSets(iamSets, iamResponse && iamResponse.current_set, []);
			const imageItems = (imagesResponse && imagesResponse.items) ? imagesResponse.items : [];

			const convertedImages = await Promise.all(imageItems.map(async (img) => {
				try {
					const data_url = await fetchUrlAsDataUrl(img.url);
					return { name: img.name, data_url };
				} catch (_error) {
					return null;
				}
			}));

			let coverArt = '';
			let iconArt = '';
			try {
				coverArt = bot.cover_art ? await fetchUrlAsDataUrl(bot.cover_art) : '';
			} catch (_error) {
				coverArt = '';
			}
			try {
				iconArt = bot.icon_art ? await fetchUrlAsDataUrl(bot.icon_art) : '';
			} catch (_error) {
				iconArt = '';
			}

			botCreationDraft = normalizeBotCreationDraft({
				name: `${bot.name}_copy`,
				description: bot.description || '',
				core_data: bot.core_data || '',
				scenario_data: bot.scenario_data || '',
				cover_art: coverArt,
				icon_art: iconArt,
				cover_art_fit: bot.cover_art_fit || { size: 100, x: 50, y: 50 },
				icon_fit: bot.icon_fit || { size: 100, x: 50, y: 50 },
				prompt_order: bot.prompt_order || getPromptOrderDefaults(),
				prompt_order_enabled: normalizePromptOrderEnabled(bot.prompt_order_enabled),
				active_dataset_id: '',
				dataset_injection_persistence: Math.max(0, parseInt(bot.dataset_injection_persistence, 10) || 6),
				modules: normalizeModuleGroups(bot.modules),
				module_settings: normalizeModuleSettings(bot.module_settings, availableModuleDefinitions),
				example_messages: bot.example_messages || '',
				example_injection_threshold: Math.max(0, parseInt(bot.example_injection_threshold, 10) || 0),
				iam_sets: normalizedIam.sets,
				current_iam_set: normalizedIam.currentSet,
				iam_items: normalizedIam.sets[normalizedIam.currentSet] || [],
				images: convertedImages.filter(Boolean)
			});
			saveBotCreationDraft();
			renderBotCreationView();
		})
		.catch((_error) => {
			alert('Failed to clone bot.');
		});
}

function renderBotCreationView(advancedMode = false) {
	botCreationDraft = normalizeBotCreationDraft(botCreationDraft || getEmptyBotCreationDraft());
	messagesContainer.innerHTML = '';
	const editor = document.createElement('div');
	editor.className = 'bot-editor';
	if (advancedMode) {
		editor.classList.add('bot-editor-advanced');
	}
	const advancedModuleSections = advancedMode
		? getAdvancedModulePlaceholderSectionsMarkup({ prefix: 'create', module_settings: botCreationDraft.module_settings })
		: '';
	const initial = botCreationDraft.name ? botCreationDraft.name[0].toUpperCase() : 'B';

	const detailsHeader = advancedMode
		? `<div class="detail-title-row"><button class="icon-btn create-bot-advanced-back-btn" type="button" title="Back to full editor" aria-label="Back to full editor"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.707 4.293a1 1 0 010 1.414L6.414 9H17a1 1 0 110 2H6.414l3.293 3.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></button><h3>Bot Details</h3><div class="persona-picker"><button class="btn btn-secondary persona-picker-btn" type="button" id="cloneBotBtn">Clone Existing Bot</button><div class="persona-picker-menu hidden" id="cloneBotMenu"></div></div></div>`
		: `<div class="detail-title-row"><h3>Bot Details</h3><div style="display:flex;align-items:center;gap:0.5rem;"><div class="persona-picker"><button class="btn btn-secondary persona-picker-btn" type="button" id="cloneBotBtn">Clone Existing Bot</button><div class="persona-picker-menu hidden" id="cloneBotMenu"></div></div><button class="icon-btn create-bot-advanced-settings-btn" type="button" title="Advanced settings" aria-label="Advanced settings"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg></button></div></div>`;

	const detailsSection = `
			<div class="bot-editor-section">
				${detailsHeader}
				${advancedMode ? '' : `<div class="form-group"><label>Dataset</label><select id="create-bot-dataset" class="text-input"><option value="">None</option></select></div>`}
				<div class="form-group">
					<label>Name</label>
					<input type="text" id="create-bot-name" class="text-input" value="${botCreationDraft.name || ''}">
				</div>
				<div class="form-group">
					<label>Description</label>
					<textarea id="create-bot-description" class="text-input" rows="3">${botCreationDraft.description || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Definition (core.txt) <span class="token-badge" id="create-core-token-count">0 tok</span></label>
					<textarea id="create-bot-core" class="text-input" rows="4">${botCreationDraft.core_data || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Rules (scenario.txt) <span class="token-badge" id="create-scenario-token-count">0 tok</span></label>
					<textarea id="create-bot-scenario" class="text-input" rows="4">${botCreationDraft.scenario_data || ''}</textarea>
				</div>
				<div class="form-group">
					<label>Initial Messages (IAM) <span class="token-badge" id="create-iam-token-total">0 tok</span></label>
					<div class="iam-set-nav" style="margin-bottom:0.5rem;">
						<button type="button" class="action-btn cancel-btn" id="create-iam-prev-btn">&lt;</button>
						<span class="iam-set-label" id="create-iam-set-label">${botCreationDraft.current_iam_set || DEFAULT_IAM_SET}</span>
						<button type="button" class="action-btn cancel-btn" id="create-iam-next-btn">&gt;</button>
						<button type="button" class="action-btn" id="create-iam-new-set-btn">Create New</button>
						<button type="button" class="action-btn delete-btn" id="create-iam-delete-set-btn">Delete IAM</button>
					</div>
					<div id="create-bot-iam-list" class="iam-list"></div>
					<div style="margin-top:1rem;display:flex;gap:0.5rem;">
						<button type="button" class="action-btn" id="create-bot-add-iam-btn">Add Message</button>
					</div>
				</div>
				${advancedMode ? `<div class="form-group"><label>Example Messages <span class="token-badge" id="create-example-token-count">0 tok</span></label><textarea id="create-bot-example-messages" class="text-input" rows="6">${botCreationDraft.example_messages || ''}</textarea><p style="margin-top:0.5rem;opacity:0.8;">Format with blocks starting at [Start], then lines like {{char}}: ... and {{user}}: ...</p></div><div class="form-group"><label>Example Injection Threshold</label><input type="number" id="create-bot-example-threshold" class="text-input" min="0" step="1" value="${Math.max(0, parseInt(botCreationDraft.example_injection_threshold, 10) || 0)}"><p style="margin-top:0.5rem;opacity:0.8;">0 = always inject. Values above 0 inject only for the first X user messages.</p></div><div class="form-group"><label>Dataset</label><label style="margin-top:0.5rem;display:block;opacity:0.85;">Injection persistance</label><input type="number" id="create-bot-dataset-injection-persistence" class="text-input" min="0" step="1" value="${Math.max(0, parseInt(botCreationDraft.dataset_injection_persistence, 10) || 6)}"><p style="margin-top:0.5rem;opacity:0.8;">Controls how many user turns dynamic dataset entries stay injected after a keyword trigger. Mentioning a keyword again resets the timer.</p></div>` : ''}
				${advancedMode ? `<div class="form-group"><label>Tabs</label><div class="prompt-tab-picker-list" id="create-prompt-tabs-list"></div></div><div class="form-group"><label>Prompt Order</label><div class="prompt-order-list" id="create-prompt-order-list"></div></div>` : ''}
			</div>`;

	const mediaSections = `
			<div class="bot-editor-section">
				<div class="bot-preview-with-controls">
					<div class="bot-preview-container">
						<h3>Cover Art</h3>
						<div class="detail-cover" id="create-cover-preview">${botCreationDraft.cover_art ? '' : initial}</div>
					</div>
					<div class="bot-controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item">
								<label>Zoom (%)</label>
								<input type="range" id="create-cover-zoom" min="50" max="300" value="${(botCreationDraft.cover_art_fit?.size ?? 100)}" class="slider">
								<span id="create-cover-zoom-val">${(botCreationDraft.cover_art_fit?.size ?? 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="create-cover-posX" min="0" max="100" value="${(botCreationDraft.cover_art_fit?.x ?? 50)}" class="slider">
								<span id="create-cover-posX-val">${(botCreationDraft.cover_art_fit?.x ?? 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="create-cover-posY" min="0" max="100" value="${(botCreationDraft.cover_art_fit?.y ?? 50)}" class="slider">
								<span id="create-cover-posY-val">${(botCreationDraft.cover_art_fit?.y ?? 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div class="bot-editor-section">
				<h3>Images</h3>
				<div class="form-group">
					<input type="file" id="create-bot-image-upload" multiple accept="image/*" style="display:none;">
					<button type="button" class="action-btn" onclick="document.getElementById('create-bot-image-upload').click()">Upload Images</button>
				</div>
				<div id="create-bot-image-gallery" class="image-gallery"></div>
			</div>

			<div class="bot-editor-section">
				<div class="bot-preview-with-controls">
					<div class="bot-preview-container">
						<h3>Icon</h3>
						<div class="detail-icon" id="create-icon-preview">${botCreationDraft.icon_art ? '' : initial}</div>
					</div>
					<div class="bot-controls-container">
						<h3>Fit</h3>
						<div class="adjust-grid">
							<div class="adjust-item">
								<label>Zoom (%)</label>
								<input type="range" id="create-icon-zoom" min="50" max="300" value="${(botCreationDraft.icon_fit?.size ?? 100)}" class="slider">
								<span id="create-icon-zoom-val">${(botCreationDraft.icon_fit?.size ?? 100)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position X (%)</label>
								<input type="range" id="create-icon-posX" min="0" max="100" value="${(botCreationDraft.icon_fit?.x ?? 50)}" class="slider">
								<span id="create-icon-posX-val">${(botCreationDraft.icon_fit?.x ?? 50)}%</span>
							</div>
							<div class="adjust-item">
								<label>Position Y (%)</label>
								<input type="range" id="create-icon-posY" min="0" max="100" value="${(botCreationDraft.icon_fit?.y ?? 50)}" class="slider">
								<span id="create-icon-posY-val">${(botCreationDraft.icon_fit?.y ?? 50)}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

	editor.innerHTML = `
		<div class="bot-editor-grid masonry-grid${advancedMode ? ' bot-editor-grid-advanced' : ''}">
			${detailsSection}
			${advancedMode ? advancedModuleSections : mediaSections}
		</div>
		<div class="bot-editor-footer">
			<button type="button" class="action-btn cancel-btn" id="create-bot-clear-btn">Clear</button>
			<button type="button" class="action-btn save-btn" id="create-bot-create-btn">Create</button>
		</div>
	`;
	messagesContainer.appendChild(editor);
	makeSectionsCollapsible(editor, '.bot-editor-section', `bot-create:${advancedMode ? 'advanced' : 'standard'}`);
	scheduleMasonryRefresh(editor);

	renderBotCreationIamList();

	if (!advancedMode) {
		setCreationPreviewStyle('create-cover-preview', botCreationDraft.cover_art, botCreationDraft.cover_art_fit, CREATION_PREVIEW_FALLBACK_STYLE);
		setCreationPreviewStyle('create-icon-preview', botCreationDraft.icon_art, botCreationDraft.icon_fit, CREATION_PREVIEW_FALLBACK_STYLE);
		renderBotCreationImages();
		bindBotCreationAdjustments();
	} else {
		initPromptOrderEditor(botCreationDraft.prompt_order, 'create-prompt-order-list', (state) => {
			botCreationDraft.prompt_order = state.order;
			botCreationDraft.prompt_order_enabled = state.enabled;
			syncAdvancedModuleSectionsVisibility('create', state.order);
			saveBotCreationDraft();
		}, botCreationDraft.prompt_order_enabled, 'create-prompt-tabs-list');
		syncAdvancedModuleSectionsVisibility('create', botCreationDraft.prompt_order);
	}
	refreshCreateDatasetOptions();

	['create-bot-name', 'create-bot-description', 'create-bot-core', 'create-bot-scenario', 'create-bot-example-messages', 'create-bot-example-threshold', 'create-bot-dataset-injection-persistence', 'create-bot-dataset'].forEach(id => {
		const input = document.getElementById(id);
		if (input) {
			const evt = input.tagName && input.tagName.toLowerCase() === 'select' ? 'change' : 'input';
			input.addEventListener(evt, updateCreationDraftFromForm);
		}
	});
	const createNameInput = document.getElementById('create-bot-name');
	if (createNameInput) {
		createNameInput.addEventListener('change', refreshCreateDatasetOptions);
	}

	if (advancedMode) {
		document.querySelectorAll('.module-setting-input[data-module-prefix="create"]').forEach((input) => {
			input.addEventListener('input', updateCreationDraftFromForm);
		});
		bindModuleRestoreButtons('create', handleCreateModuleDefaultsRestore);
	}
	refreshCreateBotTokenCounters();

	const addIamBtn = document.getElementById('create-bot-add-iam-btn');
	if (addIamBtn) {
		addIamBtn.addEventListener('click', () => {
			const list = document.getElementById('create-bot-iam-list');
			const row = document.createElement('div');
			row.className = 'iam-item create-iam-item';
			row.innerHTML = `<textarea class="setting-input iam-input create-iam-input" rows="2"></textarea><button class="btn btn-secondary create-iam-delete" type="button">Delete</button>`;
			row.querySelector('.create-iam-delete').addEventListener('click', () => {
				row.remove();
				updateCreationDraftFromForm();
			});
			row.querySelector('.create-iam-input').addEventListener('input', updateCreationDraftFromForm);
			list.appendChild(row);
			updateCreationDraftFromForm();
		});
	}

	const createPrevIamBtn = document.getElementById('create-iam-prev-btn');
	const createNextIamBtn = document.getElementById('create-iam-next-btn');
	const createNewSetBtn = document.getElementById('create-iam-new-set-btn');
	const createDeleteSetBtn = document.getElementById('create-iam-delete-set-btn');
	const switchCreateSet = (direction) => {
		updateCreationDraftFromForm();
		const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
		const setNames = normalizedIam.setNames;
		if (!setNames.length) {
			return;
		}
		const currentIndex = Math.max(0, setNames.indexOf(normalizedIam.currentSet));
		const nextIndex = (currentIndex + direction + setNames.length) % setNames.length;
		botCreationDraft.iam_sets = normalizedIam.sets;
		botCreationDraft.current_iam_set = setNames[nextIndex];
		botCreationDraft.iam_items = botCreationDraft.iam_sets[botCreationDraft.current_iam_set] || [];
		saveBotCreationDraft();
		renderBotCreationIamList();
	};
	if (createPrevIamBtn) {
		createPrevIamBtn.addEventListener('click', () => switchCreateSet(-1));
	}
	if (createNextIamBtn) {
		createNextIamBtn.addEventListener('click', () => switchCreateSet(1));
	}
	if (createNewSetBtn) {
		createNewSetBtn.addEventListener('click', () => {
			updateCreationDraftFromForm();
			const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
			const newSetName = getNextIamSetName(normalizedIam.setNames);
			normalizedIam.sets[newSetName] = [];
			botCreationDraft.iam_sets = normalizedIam.sets;
			botCreationDraft.current_iam_set = newSetName;
			botCreationDraft.iam_items = [];
			saveBotCreationDraft();
			renderBotCreationIamList();
		});
	}
	if (createDeleteSetBtn) {
		createDeleteSetBtn.addEventListener('click', () => {
			updateCreationDraftFromForm();
			if ((botCreationDraft.current_iam_set || DEFAULT_IAM_SET) === DEFAULT_IAM_SET) {
				alert('IAM_1 cannot be deleted.');
				return;
			}
			if (!confirm(`Delete ${botCreationDraft.current_iam_set}?`)) {
				return;
			}
			const normalizedIam = normalizeIamSets(botCreationDraft.iam_sets, botCreationDraft.current_iam_set, botCreationDraft.iam_items || []);
			delete normalizedIam.sets[normalizedIam.currentSet];
			const remaining = getSortedIamSetNames(Object.keys(normalizedIam.sets));
			botCreationDraft.iam_sets = normalizedIam.sets;
			botCreationDraft.current_iam_set = remaining.includes(DEFAULT_IAM_SET) ? DEFAULT_IAM_SET : (remaining[0] || DEFAULT_IAM_SET);
			botCreationDraft.iam_items = botCreationDraft.iam_sets[botCreationDraft.current_iam_set] || [];
			saveBotCreationDraft();
			renderBotCreationIamList();
		});
	}

	const imageUpload = document.getElementById('create-bot-image-upload');
	if (imageUpload && !advancedMode) {
		imageUpload.addEventListener('change', async (event) => {
			const files = Array.from(event.target.files || []);
			if (!files.length) {
				return;
			}
			for (const file of files) {
				try {
					const data_url = await readFileAsDataUrl(file);
					botCreationDraft.images.push({ name: file.name, data_url });
				} catch (_error) {
				}
			}
			saveBotCreationDraft();
			renderBotCreationImages();
			event.target.value = '';
		});
	}

	const cloneBtn = document.getElementById('cloneBotBtn');
	const cloneMenu = document.getElementById('cloneBotMenu');
	if (cloneBtn && cloneMenu) {
		cloneBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			const isHidden = cloneMenu.classList.contains('hidden');
			if (isHidden) {
				loadCloneBotOptions(cloneMenu);
			}
			cloneMenu.classList.toggle('hidden');
		});
		setTimeout(() => {
			document.addEventListener('click', (event) => {
				if (!editor.contains(event.target)) {
					cloneMenu.classList.add('hidden');
				}
			});
		}, 0);
	}

	const advancedBtn = document.querySelector('.create-bot-advanced-settings-btn');
	if (advancedBtn) {
		advancedBtn.addEventListener('click', () => showBotCreationAdvanced());
	}

	const backBtn = document.querySelector('.create-bot-advanced-back-btn');
	if (backBtn) {
		backBtn.addEventListener('click', () => showBotCreation());
	}

	const clearBtn = document.getElementById('create-bot-clear-btn');
	if (clearBtn) {
		clearBtn.addEventListener('click', () => {
			if (!confirm('Clear all bot creation fields?')) {
				return;
			}
			clearBotCreationDraft();
			renderBotCreationView(advancedMode);
		});
	}

	const createBtn = document.getElementById('create-bot-create-btn');
	if (createBtn) {
		createBtn.addEventListener('click', () => {
			createBotFromDraft();
		});
	}
}

function createBotFromDraft() {
	updateCreationDraftFromForm();
	const draft = normalizeBotCreationDraft(botCreationDraft);
	if (!draft.name.trim()) {
		alert('Bot name required');
		return;
	}
	const creationImages = [...(draft.images || [])];
	const coverImageName = ensureDraftImageReference(creationImages, draft.cover_image_name, draft.cover_art, 'cover_clone');
	const iconImageName = ensureDraftImageReference(creationImages, draft.icon_image_name, draft.icon_art, 'icon_clone');
	const normalizedIam = normalizeIamSets(draft.iam_sets, draft.current_iam_set, draft.iam_items || []);
	const promptOrderEnabled = normalizePromptOrderEnabled(draft.prompt_order_enabled);
	const moduleSettingsPayload = normalizeModuleSettings(draft.module_settings, availableModuleDefinitions);
	const iamSetsPayload = normalizedIam.setNames.map(setName => ({
		name: setName,
		items: (normalizedIam.sets[setName] || []).map(item => (item || '').trim()).filter(Boolean)
	}));

	fetch('/api/bots', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'create', name: draft.name.trim(), core_data: draft.core_data || '' })
	})
		.then(r => r.json())
		.then(created => {
			if (!created || !created.name) {
				throw new Error('Bot creation failed');
			}
			const botName = created.name;
			const updates = fetch('/api/bots', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'update',
					bot_name: botName,
					new_name: botName,
					description: draft.description,
					core_data: draft.core_data,
					scenario_data: draft.scenario_data,
					cover_art_fit: draft.cover_art_fit,
					icon_fit: draft.icon_fit,
					prompt_order: draft.prompt_order,
					prompt_order_enabled: promptOrderEnabled,
					active_dataset_id: normalizeDatasetSelection(draft.active_dataset_id),
					module_settings: moduleSettingsPayload,
					active_iam_set: normalizedIam.currentSet,
					dataset_injection_persistence: Math.max(0, parseInt(draft.dataset_injection_persistence, 10) || 6),
					example_messages: draft.example_messages,
					example_injection_threshold: Math.max(0, parseInt(draft.example_injection_threshold, 10) || 0)
				})
			});

			const uploadImages = Promise.all(creationImages.map(img =>
				fetch('/api/bot/images', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'upload', bot_name: botName, filename: img.name, data_url: img.data_url })
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('Image upload failed');
						}
					})
			));

			const saveIamSets = iamSetsPayload.reduce((chain, iamSet) =>
				chain.then(() => fetch('/api/bot/iam', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'create_set', bot_name: botName, iam_set: iamSet.name })
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('IAM set creation failed');
						}
					})
					.then(() => fetch('/api/bot/iam', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'replace', bot_name: botName, iam_set: iamSet.name, items: iamSet.items })
					}))
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('IAM set save failed');
						}
					})), Promise.resolve()
			);

			return Promise.all([updates, uploadImages, saveIamSets]).then(() => botName);
		})
		.then(botName => {
			const postActions = [];
			if (coverImageName) {
				postActions.push(fetch('/api/bot/images', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'set_coverart', bot_name: botName, filename: coverImageName })
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('Setting cover image failed');
						}
					}));
			}
			if (iconImageName) {
				postActions.push(fetch('/api/bot/images', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'set_icon', bot_name: botName, filename: iconImageName, source: 'Images' })
				})
					.then(r => r.json())
					.then(result => {
						if (!result || !result.success) {
							throw new Error('Setting icon image failed');
						}
					}));
			}
			return Promise.all(postActions).then(() => botName);
		})
		.then(() => {
			clearBotCreationDraft();
			alert('Bot created successfully');
			navItems[1].click();
		})
		.catch(() => {
			alert('Failed to create bot. Ensure the name is unique and try again.');
		});
}

function normalizePromptOrder(promptOrder) {
	const defaults = getPromptOrderDefaults();
	if (!Array.isArray(promptOrder)) {
		return [...defaults];
	}
	const normalized = [];
	promptOrder.forEach(item => {
		if (defaults.includes(item) && !normalized.includes(item)) {
			normalized.push(item);
		}
	});
	defaults.forEach(item => {
		if (!normalized.includes(item)) {
			normalized.push(item);
		}
	});
	return normalized;
}

function normalizePromptOrderEnabled(enabledMap) {
	const defaults = normalizePromptOrder(null);
	const normalized = {};
	defaults.forEach(key => {
		normalized[key] = true;
	});
	if (!enabledMap || typeof enabledMap !== 'object') {
		return normalized;
	}
	defaults.forEach(key => {
		if (Object.prototype.hasOwnProperty.call(enabledMap, key)) {
			normalized[key] = !!enabledMap[key];
		}
	});
	return normalized;
}

function normalizeModuleGroups(rawModules) {
	const defaults = {
		module_group_1: availableModuleNames.map(name => ({ name, enabled: true })),
		module_group_2: [],
		module_group_3: []
	};
	const normalized = { module_group_1: [], module_group_2: [], module_group_3: [] };
	const seen = new Set();
	const available = new Set(availableModuleNames);

	if (rawModules && typeof rawModules === 'object') {
		Object.keys(normalized).forEach((groupKey) => {
			const value = rawModules[groupKey];
			if (!Array.isArray(value)) {
				return;
			}
			value.forEach((item) => {
				let moduleName = '';
				let enabled = true;
				if (item && typeof item === 'object') {
					moduleName = `${item.name || ''}`.trim();
					enabled = item.enabled !== false;
				} else {
					moduleName = `${item || ''}`.trim();
				}
				if (!moduleName || seen.has(moduleName) || !available.has(moduleName)) {
					return;
				}
				normalized[groupKey].push({ name: moduleName, enabled: !!enabled });
				seen.add(moduleName);
			});
		});
	}

	availableModuleNames.forEach((moduleName) => {
		if (seen.has(moduleName)) {
			return;
		}
		normalized.module_group_1.push({ name: moduleName, enabled: true });
		seen.add(moduleName);
	});

	return normalized;
}

function getPromptOrderLabel(key) {
	if (key === 'scenario') {
		return 'Rules / Scenario';
	}
	if (key === 'core') {
		return 'Definition / Core';
	}
	if (key === 'user_persona') {
		return 'User / Persona';
	}
	if (key === 'example_messages') {
		return 'Example Messages';
	}
	if (key === 'dataset') {
		return 'Dataset';
	}
	const moduleName = parseModulePromptKey(key);
	if (moduleName) {
		return moduleName;
	}
	if (key === 'user_input') {
		return 'User Input / Message';
	}
	return 'Chat History / IAM\'s';
}

function filterPromptOrderKeys(order, fallbackToDefaults = false) {
	const allowed = new Set(getPromptOrderDefaults());
	if (!Array.isArray(order)) {
		return fallbackToDefaults ? getPromptOrderDefaults().slice() : [];
	}
	const filtered = order
		.map(item => `${item || ''}`.trim())
		.filter(item => allowed.has(item));
	if (!filtered.length && fallbackToDefaults) {
		return getPromptOrderDefaults().slice();
	}
	return filtered;
}

function renderPromptOrderItems(container, promptOrder, enabledMap = null) {
	if (!container) {
		return;
	}
	container.innerHTML = '';
	const normalizedEnabled = normalizePromptOrderEnabled(enabledMap);
	const orderToRender = Array.isArray(promptOrder) ? filterPromptOrderKeys(promptOrder, false) : filterPromptOrderKeys(null, true);
	orderToRender.forEach((key, index) => {
		const isEnabled = normalizedEnabled[key] !== false;
		const item = document.createElement('div');
		item.className = 'prompt-order-item';
		if (!isEnabled) {
			item.classList.add('prompt-order-item-disabled');
		}
		item.draggable = true;
		item.dataset.sectionKey = key;
		item.dataset.enabled = isEnabled ? '1' : '0';
		item.innerHTML = `<span class="prompt-order-index">${index + 1}.</span><span class="prompt-order-label">${getPromptOrderLabel(key)}</span><button type="button" class="prompt-order-remove" title="Remove tab" aria-label="Remove tab" draggable="false">×</button><label class="prompt-order-toggle"><input type="checkbox" class="prompt-order-toggle-input" ${isEnabled ? 'checked' : ''}></label>`;
		container.appendChild(item);
	});
}

function renderPromptTabPickerItems(container) {
	if (!container) {
		return;
	}
	container.innerHTML = '';
	const allTabs = getPromptOrderDefaults();
	allTabs.forEach((key) => {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'prompt-tab-picker-item';
		item.dataset.sectionKey = key;
		item.textContent = getPromptOrderLabel(key);
		container.appendChild(item);
	});
}

function initPromptOrderEditor(initialOrder, containerId = 'prompt-order-list', onOrderChange = null, initialEnabledMap = null, tabsContainerId = null) {
	const container = document.getElementById(containerId);
	if (!container) {
		return;
	}
	const resolvedTabsContainerId = tabsContainerId || (containerId === 'create-prompt-order-list' ? 'create-prompt-tabs-list' : 'prompt-tabs-list');
	const tabsContainer = document.getElementById(resolvedTabsContainerId);

	const getContainerState = () => {
		const items = Array.from(container.querySelectorAll('.prompt-order-item'));
		const orderedKeys = items.map(el => el.dataset.sectionKey);
		const enabledMap = {};
		items.forEach(el => {
			enabledMap[el.dataset.sectionKey] = el.dataset.enabled !== '0';
		});
		return {
			order: filterPromptOrderKeys(orderedKeys, false),
			enabled: normalizePromptOrderEnabled(enabledMap)
		};
	};

	const applyState = (state) => {
		renderPromptOrderItems(container, state.order, state.enabled);
		renderPromptTabPickerItems(tabsContainer);
	};

	const notifyState = () => {
		if (typeof onOrderChange === 'function') {
			onOrderChange(getContainerState());
		}
	};

	applyState({
		order: filterPromptOrderKeys(initialOrder, true),
		enabled: normalizePromptOrderEnabled(initialEnabledMap)
	});

	let dragKey = null;
	container.addEventListener('dragstart', (event) => {
		if (event.target.closest('.prompt-order-toggle') || event.target.closest('.prompt-order-remove')) {
			event.preventDefault();
			return;
		}
		const item = event.target.closest('.prompt-order-item');
		if (!item) {
			return;
		}
		dragKey = item.dataset.sectionKey;
		item.classList.add('dragging');
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', dragKey);
		}
	});

	container.addEventListener('dragend', (event) => {
		const item = event.target.closest('.prompt-order-item');
		if (item) {
			item.classList.remove('dragging');
		}
		dragKey = null;
	});

	container.addEventListener('dragover', (event) => {
		event.preventDefault();
		const target = event.target.closest('.prompt-order-item');
		const dragging = container.querySelector('.prompt-order-item.dragging');
		if (!target || !dragging || target === dragging) {
			return;
		}
		const rect = target.getBoundingClientRect();
		const after = event.clientX > rect.left + rect.width / 2;
		if (after) {
			target.after(dragging);
		} else {
			target.before(dragging);
		}
	});

	container.addEventListener('drop', (event) => {
		event.preventDefault();
		applyState(getContainerState());
		notifyState();
	});

	container.addEventListener('click', (event) => {
		const removeBtn = event.target.closest('.prompt-order-remove');
		if (!removeBtn) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const item = removeBtn.closest('.prompt-order-item');
		if (!item) {
			return;
		}
		item.remove();
		applyState(getContainerState());
		notifyState();
	});

	container.addEventListener('mousedown', (event) => {
		if (event.target.closest('.prompt-order-remove')) {
			event.preventDefault();
		}
	});

	container.addEventListener('change', (event) => {
		const toggle = event.target.closest('.prompt-order-toggle-input');
		if (!toggle) {
			return;
		}
		const item = toggle.closest('.prompt-order-item');
		if (!item) {
			return;
		}
		const isEnabled = !!toggle.checked;
		item.dataset.enabled = isEnabled ? '1' : '0';
		item.classList.toggle('prompt-order-item-disabled', !isEnabled);
		notifyState();
	});

	if (tabsContainer) {
		tabsContainer.addEventListener('click', (event) => {
			const tabButton = event.target.closest('.prompt-tab-picker-item');
			if (!tabButton) {
				return;
			}
			event.preventDefault();
			const key = `${tabButton.dataset.sectionKey || ''}`.trim();
			if (!key) {
				return;
			}
			const state = getContainerState();
			state.order.push(key);
			if (!Object.prototype.hasOwnProperty.call(state.enabled, key)) {
				state.enabled[key] = true;
			}
			applyState(state);
			notifyState();
		});
	}
}

function readPromptOrderEditorState(containerId = 'prompt-order-list') {
	const container = document.getElementById(containerId);
	if (!container) {
		return {
			order: filterPromptOrderKeys(null, true),
			enabled: normalizePromptOrderEnabled(null)
		};
	}
	const items = Array.from(container.querySelectorAll('.prompt-order-item'));
	const order = items.map(item => item.dataset.sectionKey);
	const enabled = {};
	items.forEach(item => {
		enabled[item.dataset.sectionKey] = item.dataset.enabled !== '0';
	});
	return {
		order: filterPromptOrderKeys(order, false),
		enabled: normalizePromptOrderEnabled(enabled)
	};
}
