# Bot Manager: Responsible for discovering, loading, and managing bots from the Bots/ folder

import os
import json
import datetime
import base64
import shutil
import re
from pathlib import Path


class BotManager:
    def __init__(self, bots_folder="../Bots"):
        """Initialize the bot manager with the path to the Bots folder"""
        self.bots_folder = Path(__file__).parent / bots_folder
        self.current_bot = None
        self.bots_cache = {}

    def _default_prompt_order(self):
        return ["scenario", "core", "user_persona", "iam"]

    def _default_iam_set(self):
        return "IAM_1"

    def _normalize_prompt_order(self, prompt_order):
        default_order = self._default_prompt_order()
        if not isinstance(prompt_order, list):
            return default_order.copy()

        normalized = []
        for item in prompt_order:
            if item in default_order and item not in normalized:
                normalized.append(item)

        for item in default_order:
            if item not in normalized:
                normalized.append(item)

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
                    bot_config = {"description": "", "cover_art": "", "icon_art": "", "cover_art_fit": {}, "icon_fit": {}, "prompt_order": self._default_prompt_order(), "active_iam_set": self._default_iam_set()}
                    if config_file.exists():
                        try:
                            with open(config_file, 'r', encoding='utf-8') as f:
                                bot_config = json.load(f)
                        except:
                            pass

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
        bot_config = {"description": "", "cover_art": "", "icon_art": "", "short_description": "", "cover_art_fit": {}, "icon_fit": {}, "prompt_order": self._default_prompt_order(), "active_iam_set": self._default_iam_set()}
        if config_file.exists():
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    bot_config = json.load(f)
            except:
                pass

        cover_art = bot_config.get("cover_art") or self._get_coverart_url(bot_path)
        icon_art = bot_config.get("icon_art") or cover_art
        cover_fit = self._normalize_fit(bot_config.get("cover_art_fit"))
        icon_fit = self._normalize_fit(bot_config.get("icon_fit"))
            
        active_iam_set = bot_config.get("active_iam_set", self._default_iam_set())

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
            "active_iam_set": active_iam_set,
            "short_description": bot_config.get("short_description", bot_config.get("description", "")[:100]),
            "iam_folder": str(self._resolve_iam_folder(bot_name, active_iam_set)),
            "iams_folder": str(self._get_iams_root(bot_name)),
            "stm_folder": str(bot_path / "STM"),
            "mtm_folder": str(bot_path / "MTM"),
            "ltm_folder": str(bot_path / "LTM")
        }
        
        self.current_bot = bot_info
        self.bots_cache[bot_name] = bot_info
        
        print(f"[BotManager] Loaded bot '{bot_name}'")
        return bot_info
    
    def get_current_bot(self):
        """Get the currently active bot"""
        return self.current_bot
    
    def create_bot(self, bot_name, core_data=""):
        """Create a new bot with the specified name"""
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", (bot_name or "").strip())
        if not safe_name:
            print("[BotManager] Bot name is required")
            return None

        bot_name = safe_name
        bot_path = self.bots_folder / bot_name
        
        if bot_path.exists():
            print(f"[BotManager] Bot '{bot_name}' already exists")
            return None

        try:
            # Create bot directory structure
            bot_path.mkdir(parents=True, exist_ok=True)
            (bot_path / "IAM").mkdir(exist_ok=True)
            (bot_path / "IAMs").mkdir(exist_ok=True)
            (bot_path / "IAMs" / self._default_iam_set()).mkdir(parents=True, exist_ok=True)
            (bot_path / "STM").mkdir(exist_ok=True)
            (bot_path / "MTM").mkdir(exist_ok=True)
            (bot_path / "LTM").mkdir(exist_ok=True)
            (bot_path / "Images").mkdir(exist_ok=True)
            (bot_path / "Coverart").mkdir(exist_ok=True)

            # Create core and scenario files
            core_file = bot_path / "core.txt"
            scenario_file = bot_path / "scenario.txt"
            core_file.write_text(core_data or "", encoding='utf-8')
            scenario_file.write_text("", encoding='utf-8')

            # Create default config
            config_file = bot_path / "config.json"
            config_payload = {
                "description": "",
                "short_description": "",
                "cover_art": "",
                "icon_art": "",
                "cover_art_fit": {"size": 100, "x": 50, "y": 50},
                "icon_fit": {"size": 100, "x": 50, "y": 50},
                "prompt_order": self._default_prompt_order(),
                "active_iam_set": self._default_iam_set()
            }
            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(config_payload, f, indent=2)

            print(f"[BotManager] Created bot '{bot_name}'")
            return self.load_bot(bot_name)
        except Exception as e:
            print(f"[BotManager] Error creating bot '{bot_name}': {e}")
            return None

    def rename_bot(self, bot_name, new_name):
        """Rename a bot folder and update cached references"""
        if not bot_name or not new_name or bot_name == new_name:
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
                bot_info["stm_folder"] = str(target_path / "STM")
                bot_info["mtm_folder"] = str(target_path / "MTM")
                bot_info["ltm_folder"] = str(target_path / "LTM")
                self.bots_cache[new_name] = bot_info
            if self.current_bot and self.current_bot.get("name") == bot_name:
                self.current_bot["name"] = new_name
                self.current_bot["path"] = str(target_path)
                self.current_bot["core_file"] = str(target_path / "core.txt")
                self.current_bot["iam_folder"] = str(target_path / "IAM")
                self.current_bot["iams_folder"] = str(target_path / "IAMs")
                self.current_bot["stm_folder"] = str(target_path / "STM")
                self.current_bot["mtm_folder"] = str(target_path / "MTM")
                self.current_bot["ltm_folder"] = str(target_path / "LTM")
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
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
            except Exception:
                config = {}

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
        if updates.get("active_iam_set") is not None:
            config["active_iam_set"] = self._sanitize_iam_set_name(updates.get("active_iam_set"))

        try:
            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2)
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
        for img in sorted(images_folder.iterdir()):
            if img.is_file():
                items.append({
                    "name": img.name,
                    "url": f"/Bots/{bot_name}/Images/{img.name}"
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
        return self.update_bot(bot_name, {"cover_art": cover_url, "icon_art": cover_url})

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

    def _get_legacy_iam_folder(self, bot_name):
        bot_path = self.bots_folder / bot_name
        iam_folder = bot_path / "IAM"
        iam_folder.mkdir(parents=True, exist_ok=True)
        return iam_folder

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

        legacy = self._get_legacy_iam_folder(bot_name)
        if set_name == self._default_iam_set() and legacy.exists():
            legacy_files = list(legacy.glob("*.txt"))
            if legacy_files:
                return legacy

        candidate.mkdir(parents=True, exist_ok=True)
        return candidate

    def list_iam_sets(self, bot_name):
        if not bot_name:
            return []

        iams_root = self._get_iams_root(bot_name)
        set_names = [folder.name for folder in iams_root.iterdir() if folder.is_dir()]

        legacy = self._get_legacy_iam_folder(bot_name)
        if list(legacy.glob("*.txt")) and self._default_iam_set() not in set_names:
            set_names.append(self._default_iam_set())

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
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
            except Exception:
                config = {}
            if config.get("active_iam_set") == set_name:
                remaining_sets = self.list_iam_sets(bot_name)
                config["active_iam_set"] = remaining_sets[0] if remaining_sets else self._default_iam_set()
                try:
                    with open(config_file, 'w', encoding='utf-8') as f:
                        json.dump(config, f, indent=2)
                except Exception:
                    pass

        return True

    def list_iam(self, bot_name, iam_set=None):
        if not bot_name:
            return []
        iam_folder = self._resolve_iam_folder(bot_name, iam_set)
        items = []
        for iam_file in sorted(iam_folder.glob("*.txt")):
            try:
                content = iam_file.read_text(encoding='utf-8')
            except Exception:
                content = ""
            items.append({"id": iam_file.name, "content": content})
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
            text = str(content or "")
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
            iam_file.write_text(content or "", encoding='utf-8')
            return {"id": iam_file.name, "content": content or ""}
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
            iam_file.write_text(content or "", encoding='utf-8')
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
            
        try:
            # Create bot directory structure
            bot_path.mkdir(parents=True, exist_ok=True)
            (bot_path / "IAM").mkdir(exist_ok=True)
            (bot_path / "STM").mkdir(exist_ok=True)
            (bot_path / "MTM").mkdir(exist_ok=True)
            (bot_path / "LTM").mkdir(exist_ok=True)
            
            # Create core.txt file
            core_file = bot_path / "core.txt"
            with open(core_file, 'w', encoding='utf-8') as f:
                f.write(core_data)
                
            print(f"[BotManager] Created bot '{bot_name}'")
            return self.load_bot(bot_name)
            
        except Exception as e:
            print(f"[BotManager] Error creating bot '{bot_name}': {e}")
            return None
    
    def delete_bot(self, bot_name):
        """Delete a bot (use with caution)"""
        import shutil
        
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
