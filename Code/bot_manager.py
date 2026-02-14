# Bot Manager: Responsible for discovering, loading, and managing bots from the Bots/ folder

import os
import json
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
                    bot_config = {"description": "", "cover_art": ""}
                    if config_file.exists():
                        try:
                            with open(config_file, 'r', encoding='utf-8') as f:
                                bot_config = json.load(f)
                        except:
                            pass
                    
                    bots.append({
                        "name": bot_name,
                        "path": str(bot_dir),
                        "core_file": str(core_file),
                        "description": bot_config.get("description", ""),
                        "cover_art": bot_config.get("cover_art", ""),
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
        bot_config = {"description": "", "cover_art": "", "short_description": ""}
        if config_file.exists():
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    bot_config = json.load(f)
            except:
                pass
            
        bot_info = {
            "name": bot_name,
            "path": str(bot_path),
            "core_file": str(core_file),
            "core_data": core_data,
            "description": bot_config.get("description", ""),
            "cover_art": bot_config.get("cover_art", ""),
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
