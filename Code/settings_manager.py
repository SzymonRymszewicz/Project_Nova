# Settings Manager: Responsible for managing application settings

import json
from pathlib import Path
from gui import WEB_PORT


class SettingsManager:
    def __init__(self, settings_folder="../"):
        self.settings_folder = Path(__file__).parent / settings_folder
        self.settings_file = self.settings_folder / "settings.txt"
        self.settings = {}
        self.default_settings = {
            # Style Settings
            "theme": "default",
            "enable_animations": True,
            "ui_font_size": 14,
            "chat_font_size": 20,
            "chat_text_color_main": "#d5e2ff",
            "chat_text_color_italic": "#aeb6cb",
            "chat_text_color_bold": "#f2f4ff",
            "chat_text_color_underlined": "#bdeed5",
            "chat_text_color_quote": "#e39a35",
            "console_width": 980,
            "console_height": 620,
            
            # Generation Settings
            "max_context_messages": 10,
            "temperature": 0.8,
            "max_tokens": 10000,
            "max_response_length": 400,
            "stop_strings": [],
            "top_k": 40,
            "enable_repeat_penalty": True,
            "repeat_penalty": 1.0,
            "enable_top_p_max": True,
            "top_p_max": 0.95,
            "enable_top_p_min": True,
            "top_p_min": 0.05,
            
            # API Client Settings
            "api_provider": "localhost",
            "api_key": "",
            "api_base_url": "http://localhost:1234/v1",
            "model": "Localhost",
            "max_parallel_api_requests": 2,
            
            # Other Settings
            "auto_save_chats": True,
            "default_bot": "Nova",
            "gui_port": WEB_PORT,
            "auto_load_last_chat": False,
            "show_message_timestamps": True,
            "enable_text_streaming": True,
            "enable_controlled_streaming": True,
            "controlled_streaming_tps": 15,
            "debug_mode": False
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
                    legacy_font = loaded_settings.get("font_size")
                    if legacy_font is not None:
                        if "ui_font_size" not in loaded_settings:
                            self.settings["ui_font_size"] = legacy_font
                        if "chat_font_size" not in loaded_settings:
                            self.settings["chat_font_size"] = legacy_font
                    if "chat_font_size" not in self.settings and "ui_font_size" in self.settings:
                        self.settings["chat_font_size"] = self.settings["ui_font_size"]

                    provider = str(self.settings.get("api_provider", "localhost")).strip().lower()
                    model = str(self.settings.get("model", "")).strip()
                    if provider == "localmodel":
                        self.settings["api_provider"] = "localhost"
                        provider = "localhost"
                    if provider == "localhost" and not model:
                        self.settings["model"] = "Localhost"
                    
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
