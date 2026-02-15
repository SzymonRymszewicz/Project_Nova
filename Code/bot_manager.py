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
                    bot_config = {"description": "", "cover_art": "", "icon_art": "", "cover_art_fit": {}, "icon_fit": {}}
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
                        "short_description": bot_config.get("short_description", bot_config.get("description", "")[:100])
                    })
                    
        return bots
    
    def load_bot(self, bot_name):
        """Load a specific bot by name"""
        bot_path = self.bots_folder / bot_name
        core_file = bot_path / "core.txt"
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
            
        # Try to load config for additional metadata
        bot_config = {"description": "", "cover_art": "", "icon_art": "", "short_description": "", "cover_art_fit": {}, "icon_fit": {}}
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
            
        bot_info = {
            "name": bot_name,
            "path": str(bot_path),
            "core_file": str(core_file),
            "core_data": core_data,
            "description": bot_config.get("description", ""),
            "cover_art": cover_art or "",
            "icon_art": icon_art or "",
            "cover_art_fit": cover_fit,
            "icon_fit": icon_fit,
            "short_description": bot_config.get("short_description", bot_config.get("description", "")[:100]),
            "iam_folder": str(bot_path / "IAM"),
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
        bot_path = self.bots_folder / bot_name
        
        if bot_path.exists():
            print(f"[BotManager] Bot '{bot_name}' already exists")
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
                bot_info["stm_folder"] = str(target_path / "STM")
                bot_info["mtm_folder"] = str(target_path / "MTM")
                bot_info["ltm_folder"] = str(target_path / "LTM")
                self.bots_cache[new_name] = bot_info
            if self.current_bot and self.current_bot.get("name") == bot_name:
                self.current_bot["name"] = new_name
                self.current_bot["path"] = str(target_path)
                self.current_bot["core_file"] = str(target_path / "core.txt")
                self.current_bot["iam_folder"] = str(target_path / "IAM")
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

    def _get_iam_folder(self, bot_name):
        bot_path = self.bots_folder / bot_name
        iam_folder = bot_path / "IAM"
        iam_folder.mkdir(parents=True, exist_ok=True)
        return iam_folder

    def list_iam(self, bot_name):
        if not bot_name:
            return []
        iam_folder = self._get_iam_folder(bot_name)
        items = []
        for iam_file in sorted(iam_folder.glob("*.txt")):
            try:
                content = iam_file.read_text(encoding='utf-8')
            except Exception:
                content = ""
            items.append({"id": iam_file.name, "content": content})
        return items

    def add_iam(self, bot_name, content):
        if not bot_name:
            return None
        iam_folder = self._get_iam_folder(bot_name)
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"iam_{timestamp}.txt"
        iam_file = iam_folder / filename
        try:
            iam_file.write_text(content or "", encoding='utf-8')
            return {"id": iam_file.name, "content": content or ""}
        except Exception as e:
            print(f"[BotManager] Error writing IAM for '{bot_name}': {e}")
            return None

    def update_iam(self, bot_name, iam_id, content):
        if not bot_name or not iam_id:
            return False
        iam_folder = self._get_iam_folder(bot_name)
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

    def delete_iam(self, bot_name, iam_id):
        if not bot_name or not iam_id:
            return False
        iam_folder = self._get_iam_folder(bot_name)
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
