import json
import re
from copy import deepcopy
from pathlib import Path


class BotCreationManager:
	def __init__(self, bots_folder="../Bots"):
		self.bots_folder = (Path(__file__).parent / bots_folder).resolve()

	DEFAULT_IAM_SET = "IAM_1"

	def _modules_root(self):
		return Path(__file__).parent.parent / "Modules"

	def _list_available_modules(self):
		modules_root = self._modules_root()
		if not modules_root.exists() or not modules_root.is_dir():
			return []

		names = [
			module_dir.name
			for module_dir in modules_root.iterdir()
			if module_dir.is_dir() and not module_dir.name.startswith(".") and module_dir.name != "__pycache__"
		]
		names.sort(key=lambda value: value.lower())
		return names

	def _module_prompt_key(self, module_name):
		return f"module::{module_name}"

	def _module_settings_filename(self, module_name):
		safe = re.sub(r"[^a-zA-Z0-9._-]", "_", (module_name or "").strip().lower())
		if not safe:
			safe = "module"
		return f"settings_{safe}.txt"

	def _pick_module_settings_file(self, module_dir):
		module_name = (module_dir.name or "").strip()
		candidates = [
			module_dir / self._module_settings_filename(module_name),
			module_dir / f"settings_{module_name}.txt",
		]
		for candidate in candidates:
			if candidate.exists() and candidate.is_file():
				return candidate

		fallback = sorted(
			[path for path in module_dir.glob("settings_*.txt") if path.is_file()],
			key=lambda value: value.name.lower()
		)
		return fallback[0] if fallback else None

	def _initialize_module_settings_files(self, bot_path, available_modules=None):
		module_settings_dir = bot_path / "ModuleSettings"
		module_settings_dir.mkdir(parents=True, exist_ok=True)
		module_names = available_modules if isinstance(available_modules, list) else self._list_available_modules()

		for module_name in module_names:
			module_dir = self._modules_root() / module_name
			default_settings_file = self._pick_module_settings_file(module_dir)
			target_file = module_settings_dir / self._module_settings_filename(module_name)

			if default_settings_file and default_settings_file.exists():
				content = default_settings_file.read_text(encoding='utf-8')
				target_file.write_text(content, encoding='utf-8')
			elif not target_file.exists():
				target_file.write_text("", encoding='utf-8')

	def _get_module_prompt_keys(self, available_modules=None):
		module_names = available_modules if isinstance(available_modules, list) else self._list_available_modules()
		return [self._module_prompt_key(name) for name in module_names]

	def _default_prompt_order(self, available_modules=None):
		return [
			"scenario",
			"core",
			"user_persona",
			*self._get_module_prompt_keys(available_modules=available_modules),
			"dataset",
			"example_messages",
			"iam",
			"user_input"
		]

	def _default_prompt_order_enabled(self, prompt_order=None):
		order = prompt_order if isinstance(prompt_order, list) else self._default_prompt_order()
		return {key: True for key in order}

	def _default_modules(self, available_modules=None):
		module_names = available_modules if isinstance(available_modules, list) else self._list_available_modules()
		return {
			"module_group_1": [{"name": name, "enabled": True} for name in module_names],
			"module_group_2": [],
			"module_group_3": []
		}

	def _default_iam_set(self):
		return self.DEFAULT_IAM_SET

	def _read_json_file(self, file_path):
		with open(file_path, 'r', encoding='utf-8') as f:
			return json.load(f)

	def _write_json_file(self, file_path, payload):
		with open(file_path, 'w', encoding='utf-8') as f:
			json.dump(payload, f, indent=2)

	def _base_bot_payload(self, available_modules=None):
		prompt_order = self._default_prompt_order(available_modules=available_modules)
		return {
			"description": "",
			"short_description": "",
			"cover_art": "",
			"icon_art": "",
			"cover_art_fit": {"size": 100, "x": 50, "y": 50},
			"icon_fit": {"size": 100, "x": 50, "y": 50},
			"prompt_order": prompt_order,
			"prompt_order_enabled": self._default_prompt_order_enabled(prompt_order=prompt_order),
			"modules": self._default_modules(available_modules=available_modules),
			"active_iam_set": self._default_iam_set(),
			"active_dataset_id": "",
			"dataset_injection_persistence": 6,
			"example_messages": "",
			"example_injection_threshold": 0,
		}

	def _get_drafts_folder(self):
		drafts_folder = self.bots_folder / "Drafts"
		drafts_folder.mkdir(parents=True, exist_ok=True)
		return drafts_folder

	def _get_bot_creation_draft_file(self):
		return self._get_drafts_folder() / "bot_creation_draft.json"

	def load_bot_creation_draft(self):
		draft_file = self._get_bot_creation_draft_file()
		if not draft_file.exists():
			return None
		try:
			payload = self._read_json_file(draft_file)
			if isinstance(payload, dict):
				return payload
			return None
		except Exception as e:
			print(f"[BotCreationManager] Error loading bot creation draft: {e}")
			return None

	def save_bot_creation_draft(self, draft_payload):
		if not isinstance(draft_payload, dict):
			return False
		draft_file = self._get_bot_creation_draft_file()
		try:
			self._write_json_file(draft_file, draft_payload)
			return True
		except Exception as e:
			print(f"[BotCreationManager] Error saving bot creation draft: {e}")
			return False

	def clear_bot_creation_draft(self):
		draft_file = self._get_bot_creation_draft_file()
		if not draft_file.exists():
			return True
		try:
			draft_file.unlink()
			return True
		except Exception as e:
			print(f"[BotCreationManager] Error clearing bot creation draft: {e}")
			return False

	def create_bot(self, bot_name, core_data=""):
		"""Create a new bot with the specified name"""
		safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", (bot_name or "").strip())
		if not safe_name:
			print("[BotCreationManager] Bot name is required")
			return None

		bot_name = safe_name
		bot_path = self.bots_folder / bot_name

		if bot_path.exists():
			print(f"[BotCreationManager] Bot '{bot_name}' already exists")
			return None

		try:
			available_modules = self._list_available_modules()
			base_payload = self._base_bot_payload(available_modules=available_modules)

			# Create bot directory structure
			bot_path.mkdir(parents=True, exist_ok=True)
			(bot_path / "IAM").mkdir(exist_ok=True)
			(bot_path / "IAMs").mkdir(exist_ok=True)
			(bot_path / "IAMs" / self._default_iam_set()).mkdir(parents=True, exist_ok=True)
			(bot_path / "Images").mkdir(exist_ok=True)
			(bot_path / "Coverart").mkdir(exist_ok=True)
			self._initialize_module_settings_files(bot_path, available_modules=available_modules)

			# Create core and scenario files
			core_file = bot_path / "core.txt"
			scenario_file = bot_path / "scenario.txt"
			core_file.write_text(core_data or "", encoding='utf-8')
			scenario_file.write_text("", encoding='utf-8')

			# Create default config
			config_file = bot_path / "config.json"
			self._write_json_file(config_file, base_payload)

			print(f"[BotCreationManager] Created bot '{bot_name}'")
			result_payload = deepcopy(base_payload)
			result_payload.update({
				"name": bot_name,
				"path": str(bot_path),
				"core_file": str(core_file),
				"core_data": core_data or "",
				"scenario_file": str(scenario_file),
				"scenario_data": ""
			})
			return result_payload
		except Exception as e:
			print(f"[BotCreationManager] Error creating bot '{bot_name}': {e}")
			return None
