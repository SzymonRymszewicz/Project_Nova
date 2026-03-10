# Bot Manager: Responsible for discovering, loading, and managing bots from the Bots/ folder

import json
import ast
import datetime
import base64
import shutil
import re
from copy import deepcopy
from pathlib import Path


class BotManager:
    PROTECTED_BOT_NAME = "Nova"
    DEFAULT_IAM_SET = "IAM_1"

    def __init__(self, bots_folder="../Bots"):
        """Initialize the bot manager with the path to the Bots folder"""
        self.bots_folder = (Path(__file__).parent / bots_folder).resolve()
        self.current_bot = None
        self.bots_cache = {}
        self._sync_module_settings_for_all_bots()

    def _iter_bot_names(self):
        if not self.bots_folder.exists() or not self.bots_folder.is_dir():
            return []

        names = [
            bot_dir.name
            for bot_dir in self.bots_folder.iterdir()
            if bot_dir.is_dir() and not bot_dir.name.startswith('.') and bot_dir.name != '__pycache__'
        ]
        return names

    def _sync_module_settings_for_bot(self, bot_name):
        if not bot_name:
            return

        folder = self._module_settings_folder(bot_name)
        available_modules = self._list_available_modules()
        expected_files = {
            self._module_settings_filename(module_name): module_name
            for module_name in available_modules
        }

        for file_path in sorted(folder.glob("settings_*.txt"), key=lambda item: item.name.lower()):
            if file_path.name in expected_files:
                continue
            try:
                file_path.unlink()
            except Exception as e:
                print(f"[BotManager] Error removing stale module settings for '{bot_name}': {e}")

        for module_name in available_modules:
            file_path = folder / self._module_settings_filename(module_name)
            if file_path.exists() and file_path.is_file():
                continue
            try:
                defaults = self._read_module_default_settings(module_name)
                file_path.write_text(self._serialize_module_settings_text(defaults), encoding='utf-8')
            except Exception as e:
                print(f"[BotManager] Error creating module settings for '{bot_name}'/{module_name}: {e}")

    def _sync_module_settings_for_all_bots(self):
        try:
            for bot_name in self._iter_bot_names():
                self._sync_module_settings_for_bot(bot_name)
        except Exception as e:
            print(f"[BotManager] Error syncing module settings for all bots: {e}")

    def _default_prompt_order(self):
        return [
            "scenario",
            "core",
            "user_persona",
            *self._get_module_prompt_keys(),
            "dataset",
            "example_messages",
            "iam",
            "user_input"
        ]

    def _default_prompt_order_enabled(self):
        return {key: True for key in self._default_prompt_order()}

    def _default_modules(self):
        available_modules = self._list_available_modules()
        return {
            "module_group_1": [{"name": name, "enabled": True} for name in available_modules],
            "module_group_2": [],
            "module_group_3": []
        }

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
        safe = re.sub(r"[^a-zA-Z0-9._-]", "_", str(module_name or "").strip().lower())
        if not safe:
            safe = "module"
        return f"settings_{safe}.txt"

    def _pick_module_settings_file(self, module_dir, module_name):
        candidates = [
            module_dir / self._module_settings_filename(module_name),
            module_dir / f"settings_{module_name}.txt",
        ]
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                return candidate

        fallback = sorted([path for path in module_dir.glob("settings_*.txt") if path.is_file()], key=lambda item: item.name.lower())
        if fallback:
            return fallback[0]
        return None

    def _parse_module_settings_text(self, text):
        settings = {}
        if not isinstance(text, str):
            return settings

        for raw_line in text.splitlines():
            line = str(raw_line or "").strip()
            if not line or line.startswith("#") or line.startswith(";"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
            elif ":" in line:
                key, value = line.split(":", 1)
            else:
                continue

            key = key.strip()
            value = value.strip()
            if not key:
                continue
            settings[key] = value

        return settings

    def _serialize_module_settings_text(self, settings):
        if not isinstance(settings, dict) or not settings:
            return ""

        lines = []
        for key in sorted(settings.keys(), key=lambda value: str(value).lower()):
            key_text = str(key or "").strip()
            if not key_text:
                continue
            value_text = str(settings.get(key, ""))
            lines.append(f"{key_text}={value_text}")

        return "\n".join(lines) + ("\n" if lines else "")

    def _read_module_default_settings(self, module_name):
        module_dir = self._modules_root() / module_name
        settings_file = self._pick_module_settings_file(module_dir, module_name)
        if not settings_file or not settings_file.exists() or not settings_file.is_file():
            return {}

        try:
            content = settings_file.read_text(encoding='utf-8')
        except Exception:
            return {}

        return self._parse_module_settings_text(content)

    def _module_settings_folder(self, bot_name):
        bot_path = self.bots_folder / bot_name
        folder = bot_path / "ModuleSettings"
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def _load_module_settings_for_bot(self, bot_name):
        result = {}
        folder = self._module_settings_folder(bot_name)

        for module_name in self._list_available_modules():
            defaults = self._read_module_default_settings(module_name)
            merged = dict(defaults)
            file_path = folder / self._module_settings_filename(module_name)
            if file_path.exists() and file_path.is_file():
                try:
                    content = file_path.read_text(encoding='utf-8')
                    overrides = self._parse_module_settings_text(content)
                    merged.update(overrides)
                except Exception:
                    pass
            result[module_name] = merged

        return result

    def _save_module_settings_for_bot(self, bot_name, module_settings):
        if not isinstance(module_settings, dict):
            return

        folder = self._module_settings_folder(bot_name)
        available = self._list_available_modules()
        for module_name in available:
            defaults = self._read_module_default_settings(module_name)
            incoming = module_settings.get(module_name)
            if not isinstance(incoming, dict):
                incoming = {}

            merged = dict(defaults)
            for key, value in incoming.items():
                key_text = str(key or "").strip()
                if not key_text:
                    continue
                merged[key_text] = str(value if value is not None else "")

            file_path = folder / self._module_settings_filename(module_name)
            try:
                file_path.write_text(self._serialize_module_settings_text(merged), encoding='utf-8')
            except Exception as e:
                print(f"[BotManager] Error writing module settings for '{bot_name}'/{module_name}: {e}")

    def _get_module_prompt_keys(self):
        return [self._module_prompt_key(name) for name in self._list_available_modules()]

    def _pick_module_file(self, module_dir, suffix):
        module_name = module_dir.name
        preferred = module_dir / f"{module_name}{suffix}"
        if preferred.exists() and preferred.is_file():
            return preferred

        candidates = sorted([path for path in module_dir.glob(f"*{suffix}") if path.is_file()], key=lambda item: item.name.lower())
        if candidates:
            return candidates[0]
        return None

    def _extract_module_prompt(self, python_file, module_name):
        if not python_file or not python_file.exists() or not python_file.is_file():
            return ""

        try:
            source = python_file.read_text(encoding='utf-8').strip()
        except Exception:
            return ""

        if not source:
            return ""

        try:
            tree = ast.parse(source)
        except Exception:
            return ""

        docstring = ast.get_docstring(tree)
        if docstring and docstring.strip():
            return docstring.strip()

        prompt_variable_names = {"MODULE_PROMPT", "PROMPT", "DESCRIPTION"}
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            value_node = node.value
            if not isinstance(value_node, ast.Constant) or not isinstance(value_node.value, str):
                continue
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in prompt_variable_names:
                    text = str(value_node.value or "").strip()
                    if text:
                        return text

        return ""

    def get_module_definitions(self):
        definitions = []
        modules_root = self._modules_root()
        if not modules_root.exists() or not modules_root.is_dir():
            return definitions

        def _asset_url(module_name, file_path):
            if not file_path:
                return ""
            url = f"/Modules/{module_name}/{file_path.name}"
            try:
                version = int(file_path.stat().st_mtime)
                return f"{url}?v={version}"
            except Exception:
                return url

        for module_name in self._list_available_modules():
            module_dir = modules_root / module_name
            python_file = self._pick_module_file(module_dir, ".py")
            script_file = self._pick_module_file(module_dir, ".js")
            style_file = self._pick_module_file(module_dir, ".css")
            settings_file = self._pick_module_settings_file(module_dir, module_name)
            script_files = sorted([path for path in module_dir.glob("*.js") if path.is_file()], key=lambda item: item.name.lower())
            style_files = sorted([path for path in module_dir.glob("*.css") if path.is_file()], key=lambda item: item.name.lower())

            prompt_text = self._extract_module_prompt(python_file, module_name)
            definitions.append({
                "name": module_name,
                "prompt_key": self._module_prompt_key(module_name),
                "prompt": prompt_text,
                "python_file": str(python_file) if python_file else "",
                "script_url": _asset_url(module_name, script_file),
                "style_url": _asset_url(module_name, style_file),
                "script_urls": [_asset_url(module_name, path) for path in script_files],
                "style_urls": [_asset_url(module_name, path) for path in style_files],
                "settings_file": _asset_url(module_name, settings_file),
                "settings_defaults": self._read_module_default_settings(module_name)
            })

        return definitions

    def _default_iam_set(self):
        return self.DEFAULT_IAM_SET

    def _read_json_file(self, file_path, default=None):
        fallback = {} if default is None else default
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                payload = json.load(f)
            return payload if isinstance(payload, dict) else fallback
        except Exception:
            return fallback

    def _write_json_file(self, file_path, payload):
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2)

    def _default_bot_config(self):
        return {
            "description": "",
            "cover_art": "",
            "icon_art": "",
            "short_description": "",
            "cover_art_fit": {},
            "icon_fit": {},
            "prompt_order": self._default_prompt_order(),
            "prompt_order_enabled": self._default_prompt_order_enabled(),
            "modules": self._default_modules(),
            "active_iam_set": self._default_iam_set(),
            "active_dataset_id": "",
            "dataset_injection_persistence": 6,
            "example_messages": "",
            "example_injection_threshold": 0,
        }

    def _normalize_active_dataset_id(self, value):
        safe = str(value or "").strip()
        if safe.lower() in {"none", "null"}:
            return ""
        return safe

    def _resolve_dataset_name(self, bot_name, dataset_id):
        safe_dataset_id = self._normalize_active_dataset_id(dataset_id)
        if not safe_dataset_id:
            return "None"

        datasets_file = Path(__file__).parent.parent / "Datasets" / "datasets.json"
        if not datasets_file.exists() or not datasets_file.is_file():
            return "None"

        try:
            payload = json.loads(datasets_file.read_text(encoding='utf-8'))
        except Exception:
            return "None"

        datasets = payload.get("datasets") if isinstance(payload, dict) else None
        if not isinstance(datasets, list):
            return "None"

        for row in datasets:
            if not isinstance(row, dict):
                continue
            if str(row.get("id") or "").strip() != safe_dataset_id:
                continue
            return str(row.get("name") or "Unnamed Dataset").strip() or "Unnamed Dataset"

        return "None"

    def _normalize_example_messages(self, value):
        if value is None:
            return ""
        return str(value)

    def _normalize_example_injection_threshold(self, value):
        try:
            parsed = int(value)
        except Exception:
            parsed = 0
        return max(0, parsed)

    def _normalize_dataset_injection_persistence(self, value):
        if value is None or value == "":
            return 6
        try:
            parsed = int(value)
        except Exception:
            parsed = 6
        return max(0, parsed)

    def _normalize_prompt_order(self, prompt_order):
        default_order = self._default_prompt_order()
        if not isinstance(prompt_order, list):
            return default_order.copy()

        allowed = set(default_order)
        normalized = []
        for item in prompt_order:
            if item in allowed:
                normalized.append(item)

        return normalized

    def _normalize_prompt_order_enabled(self, enabled_map):
        defaults = self._default_prompt_order_enabled()
        if not isinstance(enabled_map, dict):
            return defaults.copy()

        normalized = defaults.copy()
        for key in defaults.keys():
            if key in enabled_map:
                normalized[key] = bool(enabled_map.get(key))

        return normalized

    def _normalize_modules(self, modules):
        defaults = self._default_modules()
        if not isinstance(modules, dict):
            return {key: value.copy() for key, value in defaults.items()}

        available_modules = self._list_available_modules()
        available = set(available_modules)
        seen = set()
        normalized = {}
        for key, default_items in defaults.items():
            raw_items = modules.get(key)
            if not isinstance(raw_items, list):
                normalized[key] = default_items.copy()
                continue

            cleaned = []
            for item in raw_items:
                if isinstance(item, dict):
                    module_name = str(item.get("name") or "").strip()
                    enabled = bool(item.get("enabled", True))
                else:
                    module_name = str(item or "").strip()
                    enabled = True

                if not module_name or module_name not in available or module_name in seen:
                    continue

                cleaned.append({"name": module_name, "enabled": enabled})
                seen.add(module_name)

            normalized[key] = cleaned

        for module_name in available_modules:
            if module_name in seen:
                continue
            normalized.setdefault("module_group_1", []).append({"name": module_name, "enabled": True})
            seen.add(module_name)

        return normalized
        
    def discover_bots(self):
        """Discover all available bots in the Bots folder"""
        bots = []
        
        if not self.bots_folder.exists():
            print(f"[BotManager] Bots folder not found at {self.bots_folder}")
            return bots
            
        for bot_dir in self.bots_folder.iterdir():
            if bot_dir.is_dir() and bot_dir.name != "__pycache__" and not bot_dir.name.startswith("."):
                bot_name = bot_dir.name
                core_file = bot_dir / "core.txt"
                config_file = bot_dir / "config.json"
                
                # Check if core.txt exists
                if core_file.exists():
                    # Try to load config for additional metadata
                    bot_config = self._default_bot_config()
                    if config_file.exists():
                        loaded = self._read_json_file(config_file, default={})
                        if isinstance(loaded, dict):
                            bot_config.update(loaded)

                    cover_art = bot_config.get("cover_art") or self._get_coverart_url(bot_dir)
                    icon_art = bot_config.get("icon_art") or cover_art
                    cover_fit = self._normalize_fit(bot_config.get("cover_art_fit"))
                    icon_fit = self._normalize_fit(bot_config.get("icon_fit"))
                    
                    bots.append({
                        "name": bot_name,
                        "path": str(bot_dir),
                        "core_file": str(core_file),
                        "description": bot_config.get("description", ""),
                        "cover_art": cover_art or "",
                        "icon_art": icon_art or "",
                        "cover_art_fit": cover_fit,
                        "icon_fit": icon_fit,
                        "active_iam_set": bot_config.get("active_iam_set", self._default_iam_set()),
                        "active_dataset_id": self._normalize_active_dataset_id(bot_config.get("active_dataset_id")),
                        "active_dataset_name": self._resolve_dataset_name(bot_name, bot_config.get("active_dataset_id")),
                        "dataset_injection_persistence": self._normalize_dataset_injection_persistence(bot_config.get("dataset_injection_persistence", 6)),
                        "example_messages": self._normalize_example_messages(bot_config.get("example_messages")),
                        "example_injection_threshold": self._normalize_example_injection_threshold(bot_config.get("example_injection_threshold", 0)),
                        "short_description": bot_config.get("short_description", bot_config.get("description", "")[:100])
                    })
                    
        return bots
    
    def load_bot(self, bot_name):
        """Load a specific bot by name"""
        bot_path = self.bots_folder / bot_name
        core_file = bot_path / "core.txt"
        scenario_file = bot_path / "scenario.txt"
        config_file = bot_path / "config.json"
        
        if not bot_path.exists():
            print(f"[BotManager] Bot '{bot_name}' not found")
            return None
            
        if not core_file.exists():
            print(f"[BotManager] Bot '{bot_name}' missing core.txt")
            return None
            
        # Read the core information
        try:
            with open(core_file, 'r', encoding='utf-8') as f:
                core_data = f.read()
        except Exception as e:
            print(f"[BotManager] Error reading core file for '{bot_name}': {e}")
            return None

        scenario_data = ""
        if scenario_file.exists():
            try:
                with open(scenario_file, 'r', encoding='utf-8') as f:
                    scenario_data = f.read()
            except Exception as e:
                print(f"[BotManager] Error reading scenario file for '{bot_name}': {e}")
            
        # Try to load config for additional metadata
        bot_config = self._default_bot_config()
        if config_file.exists():
            loaded = self._read_json_file(config_file, default={})
            if isinstance(loaded, dict):
                bot_config.update(loaded)

        cover_art = bot_config.get("cover_art") or self._get_coverart_url(bot_path)
        icon_art = bot_config.get("icon_art") or cover_art
        cover_fit = self._normalize_fit(bot_config.get("cover_art_fit"))
        icon_fit = self._normalize_fit(bot_config.get("icon_fit"))
            
        active_iam_set = bot_config.get("active_iam_set", self._default_iam_set())
        module_settings = self._load_module_settings_for_bot(bot_name)

        bot_info = {
            "name": bot_name,
            "path": str(bot_path),
            "core_file": str(core_file),
            "core_data": core_data,
            "scenario_file": str(scenario_file),
            "scenario_data": scenario_data,
            "description": bot_config.get("description", ""),
            "cover_art": cover_art or "",
            "icon_art": icon_art or "",
            "cover_art_fit": cover_fit,
            "icon_fit": icon_fit,
            "prompt_order": self._normalize_prompt_order(bot_config.get("prompt_order")),
            "prompt_order_enabled": self._normalize_prompt_order_enabled(bot_config.get("prompt_order_enabled")),
            "modules": self._normalize_modules(bot_config.get("modules")),
            "module_settings": module_settings,
            "active_iam_set": active_iam_set,
            "active_dataset_id": self._normalize_active_dataset_id(bot_config.get("active_dataset_id")),
            "active_dataset_name": self._resolve_dataset_name(bot_name, bot_config.get("active_dataset_id")),
            "dataset_injection_persistence": self._normalize_dataset_injection_persistence(bot_config.get("dataset_injection_persistence", 6)),
            "example_messages": self._normalize_example_messages(bot_config.get("example_messages")),
            "example_injection_threshold": self._normalize_example_injection_threshold(bot_config.get("example_injection_threshold", 0)),
            "short_description": bot_config.get("short_description", bot_config.get("description", "")[:100]),
            "iam_folder": str(self._resolve_iam_folder(bot_name, active_iam_set)),
            "iams_folder": str(self._get_iams_root(bot_name)),
        }
        
        self.current_bot = bot_info
        self.bots_cache[bot_name] = bot_info
        
        print(f"[BotManager] Loaded bot '{bot_name}'")
        return bot_info
    
    def get_current_bot(self):
        """Get the currently active bot"""
        return self.current_bot

    def _is_protected_bot(self, bot_name):
        return str(bot_name or "").strip().lower() == self.PROTECTED_BOT_NAME.lower()
    
    def rename_bot(self, bot_name, new_name):
        """Rename a bot folder and update cached references"""
        if not bot_name or not new_name or bot_name == new_name:
            return False
        if self._is_protected_bot(bot_name):
            print(f"[BotManager] Cannot rename protected bot '{bot_name}'")
            return False

        source_path = self.bots_folder / bot_name
        target_path = self.bots_folder / new_name

        if not source_path.exists():
            print(f"[BotManager] Bot '{bot_name}' not found")
            return False
        if target_path.exists():
            print(f"[BotManager] Bot '{new_name}' already exists")
            return False

        try:
            source_path.rename(target_path)
            if bot_name in self.bots_cache:
                bot_info = self.bots_cache.pop(bot_name)
                bot_info["name"] = new_name
                bot_info["path"] = str(target_path)
                bot_info["core_file"] = str(target_path / "core.txt")
                bot_info["iam_folder"] = str(target_path / "IAM")
                bot_info["iams_folder"] = str(target_path / "IAMs")
                self.bots_cache[new_name] = bot_info
            if self.current_bot and self.current_bot.get("name") == bot_name:
                self.current_bot["name"] = new_name
                self.current_bot["path"] = str(target_path)
                self.current_bot["core_file"] = str(target_path / "core.txt")
                self.current_bot["iam_folder"] = str(target_path / "IAM")
                self.current_bot["iams_folder"] = str(target_path / "IAMs")
            print(f"[BotManager] Renamed bot '{bot_name}' -> '{new_name}'")
            return True
        except Exception as e:
            print(f"[BotManager] Error renaming bot '{bot_name}': {e}")
            return False

    def update_bot(self, bot_name, updates):
        """Update bot metadata and core definition"""
        if not bot_name:
            return None

        bot_path = self.bots_folder / bot_name
        core_file = bot_path / "core.txt"
        scenario_file = bot_path / "scenario.txt"
        config_file = bot_path / "config.json"

        if not bot_path.exists() or not core_file.exists():
            print(f"[BotManager] Bot '{bot_name}' not found")
            return None

        core_data = updates.get("core_data")
        if core_data is not None:
            try:
                with open(core_file, 'w', encoding='utf-8') as f:
                    f.write(core_data)
            except Exception as e:
                print(f"[BotManager] Error writing core for '{bot_name}': {e}")

        scenario_data = updates.get("scenario_data")
        if scenario_data is not None:
            try:
                with open(scenario_file, 'w', encoding='utf-8') as f:
                    f.write(scenario_data)
            except Exception as e:
                print(f"[BotManager] Error writing scenario for '{bot_name}': {e}")

        config = {}
        if config_file.exists():
            config = self._read_json_file(config_file, default={})

        if updates.get("description") is not None:
            config["description"] = updates.get("description", "")
        if updates.get("cover_art") is not None:
            config["cover_art"] = updates.get("cover_art", "")
        if updates.get("icon_art") is not None:
            config["icon_art"] = updates.get("icon_art", "")
        if updates.get("cover_art_fit") is not None:
            config["cover_art_fit"] = updates.get("cover_art_fit", {})
        if updates.get("icon_fit") is not None:
            config["icon_fit"] = updates.get("icon_fit", {})
        if updates.get("short_description") is not None:
            config["short_description"] = updates.get("short_description", "")
        if updates.get("prompt_order") is not None:
            config["prompt_order"] = self._normalize_prompt_order(updates.get("prompt_order"))
        if updates.get("prompt_order_enabled") is not None:
            config["prompt_order_enabled"] = self._normalize_prompt_order_enabled(updates.get("prompt_order_enabled"))
        if updates.get("modules") is not None:
            config["modules"] = self._normalize_modules(updates.get("modules"))
        if updates.get("module_settings") is not None:
            self._save_module_settings_for_bot(bot_name, updates.get("module_settings"))
        if updates.get("active_iam_set") is not None:
            config["active_iam_set"] = self._sanitize_iam_set_name(updates.get("active_iam_set"))
        if updates.get("active_dataset_id") is not None:
            config["active_dataset_id"] = self._normalize_active_dataset_id(updates.get("active_dataset_id"))
        if updates.get("dataset_injection_persistence") is not None:
            config["dataset_injection_persistence"] = self._normalize_dataset_injection_persistence(updates.get("dataset_injection_persistence"))
        if updates.get("example_messages") is not None:
            config["example_messages"] = self._normalize_example_messages(updates.get("example_messages"))
        if updates.get("example_injection_threshold") is not None:
            config["example_injection_threshold"] = self._normalize_example_injection_threshold(updates.get("example_injection_threshold"))

        try:
            self._write_json_file(config_file, config)
        except Exception as e:
            print(f"[BotManager] Error writing config for '{bot_name}': {e}")

        return self.load_bot(bot_name)

    def _normalize_fit(self, fit):
        if not isinstance(fit, dict):
            return {"size": 100, "x": 50, "y": 50}
        return {
            "size": fit.get("size", 100),
            "x": fit.get("x", 50),
            "y": fit.get("y", 50)
        }

    def _get_coverart_url(self, bot_path):
        cover_folder = bot_path / "Coverart"
        if not cover_folder.exists():
            return ""
        images = sorted([p for p in cover_folder.iterdir() if p.is_file()])
        if not images:
            return ""
        return f"/Bots/{bot_path.name}/Coverart/{images[0].name}"

    def _get_images_folder(self, bot_name):
        bot_path = self.bots_folder / bot_name
        images_folder = bot_path / "Images"
        images_folder.mkdir(parents=True, exist_ok=True)
        return images_folder

    def _get_coverart_folder(self, bot_name):
        bot_path = self.bots_folder / bot_name
        cover_folder = bot_path / "Coverart"
        cover_folder.mkdir(parents=True, exist_ok=True)
        return cover_folder

    def list_images(self, bot_name):
        if not bot_name:
            return []
        images_folder = self._get_images_folder(bot_name)
        items = []
        files = [img for img in images_folder.iterdir() if img.is_file()]
        files.sort(key=lambda item: item.stat().st_mtime, reverse=True)
        for img in files:
            modified_ts = ""
            try:
                modified_ts = datetime.datetime.fromtimestamp(img.stat().st_mtime).isoformat()
            except Exception:
                modified_ts = ""
            items.append({
                "name": img.name,
                "url": f"/Bots/{bot_name}/Images/{img.name}",
                "modified_at": modified_ts
            })
        return items

    def add_image(self, bot_name, filename, data_url):
        if not bot_name:
            return None
        images_folder = self._get_images_folder(bot_name)
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", Path(filename).name or "image.png")

        if data_url and "," in data_url:
            _, encoded = data_url.split(",", 1)
        else:
            encoded = data_url or ""

        try:
            payload = base64.b64decode(encoded)
        except Exception:
            return None

        file_path = images_folder / safe_name
        try:
            file_path.write_bytes(payload)
        except Exception as e:
            print(f"[BotManager] Error writing image for '{bot_name}': {e}")
            return None

        return {"name": safe_name, "url": f"/Bots/{bot_name}/Images/{safe_name}"}

    def delete_image(self, bot_name, filename):
        if not bot_name or not filename:
            return False
        images_folder = self._get_images_folder(bot_name)
        safe_name = Path(filename).name
        target = images_folder / safe_name
        if not target.exists():
            return False
        try:
            target.unlink()
            return True
        except Exception as e:
            print(f"[BotManager] Error deleting image for '{bot_name}': {e}")
            return False

    def set_cover_art_from_image(self, bot_name, image_name):
        if not bot_name or not image_name:
            return None
        images_folder = self._get_images_folder(bot_name)
        cover_folder = self._get_coverart_folder(bot_name)
        safe_name = Path(image_name).name
        source = images_folder / safe_name
        if not source.exists():
            return None
        target = cover_folder / safe_name
        try:
            shutil.copy2(source, target)
        except Exception as e:
            print(f"[BotManager] Error setting coverart for '{bot_name}': {e}")
            return None

        cover_url = f"/Bots/{bot_name}/Coverart/{safe_name}"
        return self.update_bot(bot_name, {"cover_art": cover_url})

    def set_icon_from_image(self, bot_name, image_name, source_folder="Images"):
        if not bot_name or not image_name:
            return None
        safe_name = Path(image_name).name
        if source_folder == "Coverart":
            cover_folder = self._get_coverart_folder(bot_name)
            if not (cover_folder / safe_name).exists():
                return None
            icon_url = f"/Bots/{bot_name}/Coverart/{safe_name}"
        else:
            images_folder = self._get_images_folder(bot_name)
            if not (images_folder / safe_name).exists():
                return None
            icon_url = f"/Bots/{bot_name}/Images/{safe_name}"
        return self.update_bot(bot_name, {"icon_art": icon_url})

    def _get_iams_root(self, bot_name):
        bot_path = self.bots_folder / bot_name
        iams_folder = bot_path / "IAMs"
        iams_folder.mkdir(parents=True, exist_ok=True)
        return iams_folder


    def _sanitize_iam_set_name(self, iam_set):
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", (iam_set or "").strip())
        return safe_name or self._default_iam_set()

    def _extract_iam_index(self, iam_set_name):
        match = re.match(r"^IAM_(\d+)$", iam_set_name)
        if not match:
            return None
        try:
            return int(match.group(1))
        except Exception:
            return None

    def _sort_iam_set_names(self, set_names):
        return sorted(set_names, key=lambda name: ((self._extract_iam_index(name) is None), self._extract_iam_index(name) or 0, name))

    def _resolve_iam_folder(self, bot_name, iam_set=None):
        set_name = self._sanitize_iam_set_name(iam_set or self._default_iam_set())
        iams_root = self._get_iams_root(bot_name)
        candidate = iams_root / set_name
        if candidate.exists() and candidate.is_dir():
            return candidate

        # Legacy folder logic removed

        candidate.mkdir(parents=True, exist_ok=True)
        return candidate

    def list_iam_sets(self, bot_name):
        if not bot_name:
            return []

        iams_root = self._get_iams_root(bot_name)
        set_names = [folder.name for folder in iams_root.iterdir() if folder.is_dir()]

        # Legacy folder logic removed

        if not set_names:
            default_set = self._default_iam_set()
            (iams_root / default_set).mkdir(parents=True, exist_ok=True)
            set_names = [default_set]

        return self._sort_iam_set_names(set_names)

    def create_iam_set(self, bot_name, iam_set=None):
        if not bot_name:
            return None

        iams_root = self._get_iams_root(bot_name)
        existing = self.list_iam_sets(bot_name)
        if iam_set:
            target_name = self._sanitize_iam_set_name(iam_set)
            target = iams_root / target_name
            target.mkdir(parents=True, exist_ok=True)
            return target_name

        numeric_indexes = [self._extract_iam_index(name) for name in existing]
        numeric_indexes = [idx for idx in numeric_indexes if idx is not None]
        next_index = (max(numeric_indexes) + 1) if numeric_indexes else 1
        target_name = f"IAM_{next_index}"
        (iams_root / target_name).mkdir(parents=True, exist_ok=True)
        return target_name

    def delete_iam_set(self, bot_name, iam_set):
        if not bot_name or not iam_set:
            return False

        set_name = self._sanitize_iam_set_name(iam_set)
        if set_name == self._default_iam_set():
            return False

        iams_root = self._get_iams_root(bot_name)
        target = iams_root / set_name
        if not target.exists() or not target.is_dir():
            return False

        try:
            shutil.rmtree(target)
        except Exception as e:
            print(f"[BotManager] Error deleting IAM set '{set_name}' for '{bot_name}': {e}")
            return False

        bot_path = self.bots_folder / bot_name
        config_file = bot_path / "config.json"
        if config_file.exists():
            config = self._read_json_file(config_file, default={})
            if config.get("active_iam_set") == set_name:
                remaining_sets = self.list_iam_sets(bot_name)
                config["active_iam_set"] = remaining_sets[0] if remaining_sets else self._default_iam_set()
                try:
                    self._write_json_file(config_file, config)
                except Exception:
                    pass

        return True

    def _read_iam_entry(self, iam_file):
        try:
            raw = iam_file.read_text(encoding='utf-8')
        except Exception:
            return {"id": iam_file.name, "content": ""}

        text = str(raw or "")
        stripped = text.strip()
        if not stripped:
            return {"id": iam_file.name, "content": ""}

        try:
            payload = json.loads(stripped)
            if isinstance(payload, dict):
                content = payload.get("content")
                if isinstance(content, str):
                    return {"id": iam_file.name, "content": content}
        except Exception:
            pass

        return {"id": iam_file.name, "content": text}

    def _serialize_iam_content(self, content):
        if isinstance(content, dict):
            payload = {
                "role": str(content.get("role") or "assistant").strip().lower() or "assistant",
                "content": str(content.get("content") or ""),
                "timestamp": str(content.get("timestamp") or datetime.datetime.now().isoformat())
            }
            return json.dumps(payload, ensure_ascii=False, indent=2)
        return str(content or "")

    def list_iam(self, bot_name, iam_set=None):
        if not bot_name:
            return []
        iam_folder = self._resolve_iam_folder(bot_name, iam_set)
        items = []
        for iam_file in sorted(iam_folder.glob("*.txt")):
            items.append(self._read_iam_entry(iam_file))
        return items

    def replace_iam(self, bot_name, contents, iam_set=None):
        if not bot_name:
            return False
        iam_folder = self._resolve_iam_folder(bot_name, iam_set)
        items = contents if isinstance(contents, list) else []

        try:
            for iam_file in iam_folder.glob("*.txt"):
                iam_file.unlink()
        except Exception as e:
            print(f"[BotManager] Error clearing IAM set for '{bot_name}': {e}")
            return False

        for index, content in enumerate(items):
            text = self._serialize_iam_content(content)
            if not text.strip():
                continue
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            filename = f"iam_{timestamp}_{index:03d}.txt"
            iam_file = iam_folder / filename
            try:
                iam_file.write_text(text, encoding='utf-8')
            except Exception as e:
                print(f"[BotManager] Error replacing IAM for '{bot_name}': {e}")
                return False

        return True

    def add_iam(self, bot_name, content, iam_set=None):
        if not bot_name:
            return None
        iam_folder = self._resolve_iam_folder(bot_name, iam_set)
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"iam_{timestamp}.txt"
        iam_file = iam_folder / filename
        if iam_file.exists():
            suffix = 1
            while True:
                candidate = iam_folder / f"iam_{timestamp}_{suffix}.txt"
                if not candidate.exists():
                    iam_file = candidate
                    break
                suffix += 1
        try:
            serialized = self._serialize_iam_content(content)
            iam_file.write_text(serialized, encoding='utf-8')
            return self._read_iam_entry(iam_file)
        except Exception as e:
            print(f"[BotManager] Error writing IAM for '{bot_name}': {e}")
            return None

    def update_iam(self, bot_name, iam_id, content, iam_set=None):
        if not bot_name or not iam_id:
            return False
        iam_folder = self._resolve_iam_folder(bot_name, iam_set)
        safe_name = Path(iam_id).name
        iam_file = iam_folder / safe_name
        if not iam_file.exists():
            return False
        try:
            iam_file.write_text(self._serialize_iam_content(content), encoding='utf-8')
            return True
        except Exception as e:
            print(f"[BotManager] Error updating IAM for '{bot_name}': {e}")
            return False

    def delete_iam(self, bot_name, iam_id, iam_set=None):
        if not bot_name or not iam_id:
            return False
        iam_folder = self._resolve_iam_folder(bot_name, iam_set)
        safe_name = Path(iam_id).name
        iam_file = iam_folder / safe_name
        if not iam_file.exists():
            return False
        try:
            iam_file.unlink()
            return True
        except Exception as e:
            print(f"[BotManager] Error deleting IAM for '{bot_name}': {e}")
            return False
    
    def delete_bot(self, bot_name):
        """Delete a bot (use with caution)"""
        if self._is_protected_bot(bot_name):
            print(f"[BotManager] Cannot delete protected bot '{bot_name}'")
            return False
        
        bot_path = self.bots_folder / bot_name
        
        if not bot_path.exists():
            print(f"[BotManager] Bot '{bot_name}' not found")
            return False
            
        try:
            shutil.rmtree(bot_path)
            if bot_name in self.bots_cache:
                del self.bots_cache[bot_name]
            if self.current_bot and self.current_bot["name"] == bot_name:
                self.current_bot = None
            print(f"[BotManager] Deleted bot '{bot_name}'")
            return True
        except Exception as e:
            print(f"[BotManager] Error deleting bot '{bot_name}': {e}")
            return False
