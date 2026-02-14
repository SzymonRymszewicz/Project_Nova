# Settings Manager: Responsible for managing application settings

import json
from pathlib import Path


class SettingsManager:
    def __init__(self, settings_folder="../Settings"):
        """Initialize the settings manager with the path to the Settings folder"""
        self.settings_folder = Path(__file__).parent / settings_folder
        self.settings_file = self.settings_folder / "settings.txt"
        self.settings = {}
        self.default_settings = {
            # Style Settings
            "theme": "cyberpunk",
            "enable_animations": True,
            "font_size": 12,
            "console_width": 980,
            "console_height": 620,
            
            # Generation Settings
            "max_context_messages": 20,
            "temperature": 0.7,
            "max_tokens": 2048,
            
            # API Client Settings
            "api_provider": "openai",
            "api_key": "",
            "api_base_url": "https://api.openai.com/v1",
            "model": "gpt-3.5-turbo",
            
            # Other Settings
            "auto_save_chats": True,
            "default_bot": "Nova",
            "gui_port": 5067,
            "auto_load_last_chat": True
        }
        self.load_settings()
        
    def _ensure_settings_folder(self):
        """Ensure the settings folder exists"""
        self.settings_folder.mkdir(parents=True, exist_ok=True)
        
    def load_settings(self):
        """Load settings from file or create default settings"""
        if not self.settings_file.exists():
            self.settings = self.default_settings.copy()
            self.save_settings()
            print("[SettingsManager] Created default settings")
            return self.settings
            
        try:
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if not content:
                    self.settings = self.default_settings.copy()
                else:
                    loaded_settings = json.loads(content)
                    # Merge with defaults to ensure all keys exist
                    self.settings = self.default_settings.copy()
                    self.settings.update(loaded_settings)
                    
            print("[SettingsManager] Loaded settings")
            return self.settings
            
        except Exception as e:
            print(f"[SettingsManager] Error loading settings: {e}")
            self.settings = self.default_settings.copy()
            return self.settings
            
    def save_settings(self):
        """Save settings to file"""
        self._ensure_settings_folder()
        try:
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(self.settings, f, indent=2)
            print("[SettingsManager] Settings saved")
            return True
        except Exception as e:
            print(f"[SettingsManager] Error saving settings: {e}")
            return False
            
    def get(self, key, default=None):
        """Get a setting value"""
        return self.settings.get(key, default)
        
    def set(self, key, value):
        """Set a setting value and save"""
        self.settings[key] = value
        return self.save_settings()
        
    def get_all(self):
        """Get all settings"""
        return self.settings.copy()
        
    def reset_to_defaults(self):
        """Reset all settings to defaults"""
        self.settings = self.default_settings.copy()
        return self.save_settings()
        
    def update_multiple(self, settings_dict):
        """Update multiple settings at once"""
        self.settings.update(settings_dict)
        return self.save_settings()
