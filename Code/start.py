# This file contains the main application class. It is responsible for initializing the application and providing the main entry point for the program.

import builtins
import json
import os
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from console import ConsoleErrorRedirector
from console import ConsoleRedirector
from console import ConsoleWindow
from gui import start_gui_server
from variables import __name__
from variables import __author__
from bot_manager import BotManager
from chat_manager import ChatManager
from settings_manager import SettingsManager
from persona_manager import PersonaManager

class Application:
    def __init__(self):
        self.console = ConsoleWindow()
        self.console.set_command_handler(self._on_console_command)
        self._install_console_redirects()
        self._original_print = builtins.print
        self._gui_server = None
        self._gui_thread = None
        self._gui_url = None
        
        # Initialize managers
        self.bot_manager = BotManager()
        self.chat_manager = ChatManager()
        self.settings_manager = SettingsManager()
        self.persona_manager = PersonaManager()
        
        # Track current active bot and persona
        self.current_bot_name = None
        self.current_persona_id = None

        self._app_thread = threading.Thread(target=self._run_app, daemon=True)
        self._app_thread.start()

        try:
            self.console.start()
        finally:
            self._restore_console_redirects()

    def _run_app(self):
        try:
            print(f"{__name__} initialized! Made by {__author__} for all your botting needs!")
            self._start_gui()
            self.console.show_help()
            self.run()
        except EOFError:
            return
        except Exception as exc:  # noqa: BLE001
            self.console.write_error(f"\n[error] {exc}\n")
            self.console.close()

    def _install_console_redirects(self):
        self._original_stdout = sys.stdout
        self._original_stderr = sys.stderr
        self._original_input = builtins.input

        sys.stdout = ConsoleRedirector(self.console)
        sys.stderr = ConsoleErrorRedirector(self.console)
        builtins.input = self.console.input

    def _restore_console_redirects(self):
        sys.stdout = self._original_stdout
        sys.stderr = self._original_stderr
        builtins.input = self._original_input

        if self._original_print:
            builtins.print = self._original_print

    def _shutdown(self):
        self._stop_gui()
        self.console.close()

    def _debug_print(self, *args, **kwargs):
        if self.settings_manager.get("debug_mode", False):
            self._original_print(*args, **kwargs)

    def _start_gui(self):
        if self._gui_server is not None:
            return

        def _on_message(message, save_response=False, chat_id=None, bot_name=None):
            print(f"[GUI] Message: {message} (save_response={save_response})")
            # Add message to current chat
            if save_response:
                # This is a bot response, save it directly
                if chat_id and bot_name:
                    self.chat_manager.add_message("assistant", message, chat_id, bot_name)
            else:
                # This is a user message
                if self.chat_manager.current_chat_id:
                    self.chat_manager.add_message("user", message, self.chat_manager.current_chat_id, self.current_bot_name)
            # TODO: Generate AI response and return it (only for user messages, not responses)
            return "Message received! (Bot response will be implemented soon)"
            
        def _on_bot_list():
            bots = self.bot_manager.discover_bots()
            print(f"[GUI] Bot list requested: {len(bots)} bots found")
            return bots
            
        def _on_bot_select(bot_name):
            bot = self.bot_manager.load_bot(bot_name)
            if bot:
                print(f"[GUI] Bot selected: {bot_name}")
                self.current_bot_name = bot_name
                # Try to load last chat, if none exists return None
                last_chat = self.chat_manager.get_last_chat_for_bot(bot_name)
                if last_chat:
                    self.chat_manager.load_chat(last_chat["id"], bot_name)
                # Don't auto-create a new chat, let the GUI handle it
            return bot
            
        def _on_bot_create(bot_name, core_data):
            bot = self.bot_manager.create_bot(bot_name, core_data)
            print(f"[GUI] Bot creation requested: {bot_name}")
            return bot
            
        def _on_chat_list():
            chats = self.chat_manager.get_all_chats()
            print(f"[GUI] Chat list requested: {len(chats)} chats found")
            return chats
            
        def _on_chat_create(bot_name, title):
            chat = self.chat_manager.create_chat(bot_name, title)
            print(f"[GUI] Chat created: {title} with {bot_name}")
            return chat
            
        def _on_get_last_chat(bot_name):
            """Get the last chat for a bot, or None if none exists"""
            last_chat_info = self.chat_manager.get_last_chat_for_bot(bot_name)
            if last_chat_info:
                messages = self.chat_manager.load_chat(last_chat_info["id"], bot_name)
                return {"chat_info": last_chat_info, "messages": messages}
            return None
        
        def _on_load_chat(chat_id, bot_name):
            """Load a specific chat by ID and bot name"""
            messages = self.chat_manager.load_chat(chat_id, bot_name)
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            return {"messages": messages}
            
        def _on_personas_list():
            personas = self.persona_manager.get_all_personas()
            print(f"[GUI] Personas list requested: {len(personas)} personas found")
            return personas
            
        def _on_persona_select(persona_id):
            persona = self.persona_manager.get_persona(persona_id)
            if persona:
                self.current_persona_id = persona_id
                print(f"[GUI] Persona selected: {persona['name']}")
            return persona
            
        def _on_persona_create(name, description, cover_art):
            persona = self.persona_manager.create_persona(name, description, cover_art)
            print(f"[GUI] Persona created: {name}")
            return persona
            
        def _on_persona_update(persona_id, **kwargs):
            persona = self.persona_manager.update_persona(persona_id, **kwargs)
            print(f"[GUI] Persona updated: {persona_id}")
            return persona
            
        def _on_settings_get():
            settings = self.settings_manager.get_all()
            print("[GUI] Settings requested")
            return settings
            
        def _on_settings_update(settings_dict):
            success = self.settings_manager.update_multiple(settings_dict)
            print(f"[GUI] Settings update: {'successful' if success else 'failed'}")
            return success
        
        def _on_settings_reset():
            """Reset all settings to defaults"""
            success = self.settings_manager.reset_to_defaults()
            print(f"[GUI] Settings reset to defaults: {'successful' if success else 'failed'}")
            return self.settings_manager.get_all() if success else None

        def _on_settings_test(settings_payload):
            settings = self.settings_manager.get_all()
            if settings_payload:
                settings.update(settings_payload)

            provider = settings.get("api_provider", "openai")
            api_key = settings.get("api_key", "")
            api_base_url = settings.get("api_base_url", "")

            if not api_base_url:
                if provider == "localhost":
                    api_base_url = "http://localhost:1234/v1"
                elif provider == "openai":
                    api_base_url = "https://api.openai.com/v1"

            if provider == "openai" and not api_key:
                return {"success": False, "message": "OpenAI requires an API key."}

            models_url = api_base_url.rstrip("/") + "/models"
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            try:
                request = urllib.request.Request(models_url, headers=headers, method="GET")
                with urllib.request.urlopen(request, timeout=5) as response:
                    status_code = response.status
                    body = response.read().decode("utf-8", errors="ignore")

                if 200 <= status_code < 300:
                    model_names = []
                    try:
                        payload = json.loads(body) if body else {}
                        data_list = payload.get("data", []) if isinstance(payload, dict) else []
                        for item in data_list:
                            if isinstance(item, dict) and item.get("id"):
                                model_names.append(item["id"])
                    except Exception:
                        model_names = []

                    if model_names:
                        preview = ", ".join(model_names[:3])
                        message = f"Connected. Found {len(model_names)} model(s): {preview}"
                    else:
                        message = "Connected. Models list is empty or unavailable."

                    return {"success": True, "message": message, "models": model_names}

                return {"success": False, "message": f"API error: HTTP {status_code}."}
            except urllib.error.HTTPError as exc:
                return {"success": False, "message": f"API error: HTTP {exc.code}."}
            except urllib.error.URLError as exc:
                reason = exc.reason if exc.reason else "Unknown connection error"
                return {"success": False, "message": f"Connection failed: {reason}."}
            except Exception as exc:  # noqa: BLE001
                return {"success": False, "message": f"Test failed: {exc}"}

        self._gui_server, self._gui_thread, self._gui_url = start_gui_server(
            _on_message, _on_bot_list, _on_bot_select, _on_bot_create,
            _on_chat_list, _on_chat_create, _on_get_last_chat, _on_load_chat, _on_settings_get, _on_settings_update, _on_settings_reset,
            _on_settings_test, _on_personas_list, _on_persona_select, _on_persona_create, _on_persona_update
        )
        webbrowser.open(self._gui_url)

    def _stop_gui(self):
        if self._gui_server is None:
            return
        self._gui_server.shutdown()
        self._gui_server.server_close()
        self._gui_server = None
        self._gui_thread = None
        self._gui_url = None

    def _restart(self):
        print("Restarting application...")
        self._stop_gui()
        self._start_gui()
        print("Application restarted.")

    def _on_console_command(self, command):
        if command == "restart":
            self._restart()
            return True
        return False
    
    def run(self):
        self._original_print("\nApplication running. Use the GUI or console commands to interact.")
        builtins.print = self._debug_print
        import time
        while True:
            time.sleep(1)
