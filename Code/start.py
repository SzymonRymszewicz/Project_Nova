# This file contains the main application class. It is responsible for initializing the application and providing the main entry point for the program.

import builtins
from datetime import datetime
import json
import os
from pathlib import Path
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
from pipeline import PromptPipeline

class Application:
    def __init__(self):
        self.console = ConsoleWindow()
        self.console.set_command_handler(self._on_console_command)
        self.console.set_output_hook(self._on_console_output)
        self._install_console_redirects()
        self._original_print = builtins.print
        self._gui_server = None
        self._gui_thread = None
        self._gui_url = None
        self._debug_session_log_path = None
        
        # Initialize managers
        self.bot_manager = BotManager()
        self.chat_manager = ChatManager()
        self.settings_manager = SettingsManager()
        self.persona_manager = PersonaManager()
        
        # Track current active bot and persona
        self.current_bot_name = None
        self.current_persona_id = None
        self.prompt_pipeline = PromptPipeline(
            self.bot_manager,
            self.chat_manager,
            self.persona_manager,
            self.settings_manager,
            debug_logger=self._debug_log
        )

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

    def _get_debug_logs_folder(self):
        nova_root = Path(__file__).resolve().parent.parent
        candidates = [
            nova_root / "Debug_logs",
            nova_root / "Debug_Logs"
        ]
        for folder in candidates:
            if folder.exists() and folder.is_dir():
                return folder
        fallback = candidates[0]
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback

    def _get_debug_session_log_path(self):
        if self._debug_session_log_path is not None:
            return self._debug_session_log_path
        folder = self._get_debug_logs_folder()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        self._debug_session_log_path = folder / f"debug_session_{timestamp}.txt"
        return self._debug_session_log_path

    def _write_console_session_log(self, text, tag):
        if not self._is_debug_enabled():
            return
        if text is None:
            return
        path = self._get_debug_session_log_path()
        try:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            with open(path, "a", encoding="utf-8") as file:
                file.write(f"[{timestamp}] [{tag}] {text}")
        except Exception:
            return

    def _on_console_output(self, text, tag="stdout"):
        self._write_console_session_log(text, tag)

    def _is_debug_enabled(self):
        return bool(self.settings_manager.get("debug_mode", False))

    def _mask_sensitive(self, value):
        text = str(value or "")
        if not text:
            return ""
        if len(text) <= 8:
            return "*" * len(text)
        return f"{text[:4]}...{text[-4:]}"

    def _safe_debug_data(self, value):
        if isinstance(value, dict):
            safe = {}
            for key, item in value.items():
                key_name = str(key).lower()
                if key_name in ("api_key", "authorization", "token", "password"):
                    safe[key] = self._mask_sensitive(item)
                else:
                    safe[key] = self._safe_debug_data(item)
            return safe
        if isinstance(value, list):
            return [self._safe_debug_data(item) for item in value]
        return value

    def _debug_log(self, event, **details):
        if not self._is_debug_enabled():
            return
        timestamp = datetime.now().strftime("%H:%M:%S")
        safe_details = self._safe_debug_data(details)
        payload = ""
        if safe_details:
            try:
                payload = " " + json.dumps(safe_details, ensure_ascii=False)
            except Exception:
                payload = f" {safe_details}"
        self._original_print(f"[DEBUG {timestamp}] {event}{payload}")

    def _start_gui(self):
        if self._gui_server is not None:
            return

        def _on_message(message, save_response=False, chat_id=None, bot_name=None, persona_id=None, persona_name=None):
            print(f"[GUI] Message: {message} (save_response={save_response})")
            self._debug_log(
                "message.received",
                save_response=save_response,
                chat_id=chat_id,
                bot_name=bot_name,
                persona_id=persona_id,
                persona_name=persona_name,
                message_length=len(str(message or ""))
            )
            # Add message to current chat
            if save_response:
                # This is a bot response, save it directly
                if chat_id and bot_name:
                    self.chat_manager.add_message("assistant", message, chat_id, bot_name)
                self._debug_log("message.saved_assistant", chat_id=chat_id, bot_name=bot_name)
            else:
                # This is a user message
                active_chat_id = chat_id or self.chat_manager.current_chat_id
                active_bot_name = bot_name or self.current_bot_name
                requested_persona_name = (persona_name or "").strip()
                stored_persona_name = ""
                if active_chat_id:
                    stored_persona_name = (self.chat_manager.get_chat_persona(active_chat_id) or "").strip()

                resolved_persona_name = requested_persona_name
                if not resolved_persona_name or resolved_persona_name == "User":
                    if stored_persona_name and stored_persona_name != "User":
                        resolved_persona_name = stored_persona_name
                    elif not resolved_persona_name:
                        resolved_persona_name = stored_persona_name
                if not resolved_persona_name:
                    resolved_persona_name = "User"
                self._debug_log(
                    "message.context_resolved",
                    active_chat_id=active_chat_id,
                    active_bot_name=active_bot_name,
                    requested_persona_name=requested_persona_name,
                    stored_persona_name=stored_persona_name,
                    resolved_persona_name=resolved_persona_name
                )
                if active_chat_id and active_bot_name:
                    self.chat_manager.add_message("user", message, active_chat_id, active_bot_name)
                    self.chat_manager.set_chat_persona(active_chat_id, resolved_persona_name)
                    self._debug_log(
                        "message.saved_user",
                        chat_id=active_chat_id,
                        bot_name=active_bot_name,
                        resolved_persona_name=resolved_persona_name
                    )

                reply, error = self.prompt_pipeline.generate_reply(
                    user_message=message,
                    bot_name=active_bot_name,
                    chat_id=active_chat_id,
                    persona_id=persona_id,
                    persona_name=resolved_persona_name
                )
                if error:
                    self._debug_log("message.reply_error", error=error)
                    return f"API error: {error}"
                self._debug_log("message.reply_success", reply_length=len(str(reply or "")))
                return reply or "API error: LLM returned empty response."

            return ""
            
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

        def _on_bot_update(payload):
            bot_name = payload.get("bot_name")
            new_name = payload.get("new_name")
            if not bot_name:
                return {"success": False, "message": "Missing bot name"}

            if new_name and new_name != bot_name:
                renamed = self.bot_manager.rename_bot(bot_name, new_name)
                if not renamed:
                    return {"success": False, "message": "Rename failed"}
                self.chat_manager.rename_bot(bot_name, new_name)
                if self.current_bot_name == bot_name:
                    self.current_bot_name = new_name
                bot_name = new_name

            updates = {
                "description": payload.get("description"),
                "cover_art": payload.get("cover_art"),
                "icon_art": payload.get("icon_art"),
                "cover_art_fit": payload.get("cover_art_fit"),
                "icon_fit": payload.get("icon_fit"),
                "short_description": payload.get("short_description"),
                "core_data": payload.get("core_data"),
                "scenario_data": payload.get("scenario_data"),
                "prompt_order": payload.get("prompt_order"),
                "active_iam_set": payload.get("active_iam_set")
            }
            bot = self.bot_manager.update_bot(bot_name, updates)
            return {"success": bot is not None, "bot": bot}

        def _on_bot_delete(bot_name):
            if not bot_name:
                return {"success": False, "message": "Missing bot name"}

            deleted = self.bot_manager.delete_bot(bot_name)
            if not deleted:
                return {"success": False, "message": "Failed to delete bot"}

            self.chat_manager.delete_chats_for_bot(bot_name)
            if self.current_bot_name == bot_name:
                self.current_bot_name = None

            print(f"[GUI] Bot deleted: {bot_name}")
            return {"success": True}

        def _on_bot_iam(action, payload):
            bot_name = payload.get("bot_name")
            iam_set = payload.get("iam_set")
            if action == "list":
                return {"items": self.bot_manager.list_iam(bot_name, iam_set)}
            if action == "list_sets":
                sets = self.bot_manager.list_iam_sets(bot_name)
                bot = self.bot_manager.load_bot(bot_name) if bot_name else None
                active_set = bot.get("active_iam_set") if bot else None
                current_set = iam_set or active_set or (sets[0] if sets else self.bot_manager._default_iam_set())
                return {"sets": sets, "current_set": current_set}
            if action == "list_all":
                sets = self.bot_manager.list_iam_sets(bot_name)
                payload_sets = [{"name": set_name, "items": self.bot_manager.list_iam(bot_name, set_name)} for set_name in sets]
                bot = self.bot_manager.load_bot(bot_name) if bot_name else None
                active_set = bot.get("active_iam_set") if bot else None
                current_set = iam_set or active_set or (sets[0] if sets else self.bot_manager._default_iam_set())
                return {"sets": payload_sets, "current_set": current_set}
            if action == "create_set":
                set_name = self.bot_manager.create_iam_set(bot_name, iam_set)
                return {"success": set_name is not None, "iam_set": set_name}
            if action == "delete_set":
                success = self.bot_manager.delete_iam_set(bot_name, iam_set)
                return {"success": success}
            if action == "replace":
                success = self.bot_manager.replace_iam(bot_name, payload.get("items", []), iam_set)
                return {"success": success}
            if action == "add":
                item = self.bot_manager.add_iam(bot_name, payload.get("content", ""), iam_set)
                return {"success": item is not None, "item": item}
            if action == "update":
                success = self.bot_manager.update_iam(bot_name, payload.get("iam_id"), payload.get("content", ""), iam_set)
                return {"success": success}
            if action == "delete":
                success = self.bot_manager.delete_iam(bot_name, payload.get("iam_id"), iam_set)
                return {"success": success}
            return {"success": False}

        def _on_bot_images(action, payload):
            bot_name = payload.get("bot_name")
            if action == "list":
                return {"items": self.bot_manager.list_images(bot_name)}
            if action == "upload":
                item = self.bot_manager.add_image(bot_name, payload.get("filename"), payload.get("data_url"))
                return {"success": item is not None, "item": item}
            if action == "delete":
                success = self.bot_manager.delete_image(bot_name, payload.get("filename"))
                return {"success": success}
            if action == "set_coverart":
                bot = self.bot_manager.set_cover_art_from_image(bot_name, payload.get("filename"))
                return {"success": bot is not None, "bot": bot}
            if action == "set_icon":
                bot = self.bot_manager.set_icon_from_image(bot_name, payload.get("filename"), payload.get("source", "Images"))
                return {"success": bot is not None, "bot": bot}
            return {"success": False}
            
        def _on_chat_list():
            chats = self.chat_manager.get_all_chats()
            print(f"[GUI] Chat list requested: {len(chats)} chats found")
            return chats
            
        def _on_chat_create(bot_name, title, persona_name=None, iam_set=None):
            chat = self.chat_manager.create_chat(bot_name, title, persona_name, iam_set)
            print(f"[GUI] Chat created: {title} with {bot_name}")
            return chat

        def _on_chat_delete(chat_id):
            success = self.chat_manager.delete_chat(chat_id)
            print(f"[GUI] Chat delete requested: {chat_id} ({'successful' if success else 'failed'})")
            return {"success": success}

        def _on_chat_switch_iam(chat_id, bot_name, iam_set, persona_name=None):
            result = self.chat_manager.switch_chat_iam_set(chat_id, bot_name, iam_set, persona_name)
            if result is None:
                return {"success": False, "message": "Cannot switch IAM after first user message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            return {"success": True, "messages": result}

        def _on_chat_edit_message(chat_id, bot_name, message_index, content):
            result = self.chat_manager.edit_message(chat_id, bot_name, message_index, content)
            if result is None:
                return {"success": False, "message": "Failed to edit message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            return {"success": True, "messages": result}

        def _resolve_persona_name_for_chat(chat_id, requested_persona_name=None):
            chosen = (requested_persona_name or "").strip()
            stored = ""
            if chat_id:
                stored = (self.chat_manager.get_chat_persona(chat_id) or "").strip()
            if not chosen or chosen == "User":
                if stored and stored != "User":
                    chosen = stored
                elif not chosen:
                    chosen = stored
            if not chosen:
                chosen = "User"
            return chosen

        def _merge_assistant_continuation(current_text, continuation_text):
            base = str(current_text or "")
            addition = str(continuation_text or "")
            if not addition.strip():
                return base

            base_trimmed = base.rstrip()
            addition_trimmed = addition.strip()
            if not base_trimmed:
                return addition_trimmed

            base_lower = base_trimmed.lower()
            addition_lower = addition_trimmed.lower()

            if addition_lower in base_lower:
                return base

            max_overlap = min(len(base_trimmed), len(addition_trimmed))
            overlap_size = 0
            for size in range(max_overlap, 0, -1):
                if base_lower.endswith(addition_lower[:size]):
                    overlap_size = size
                    break
            if overlap_size > 0:
                addition_trimmed = addition_trimmed[overlap_size:].lstrip()

            if not addition_trimmed:
                return base

            separator = "" if base.endswith((" ", "\n", "\t")) else " "
            return f"{base}{separator}{addition_trimmed}"

        def _on_chat_delete_message(chat_id, bot_name, message_index):
            result = self.chat_manager.delete_message(chat_id, bot_name, message_index)
            if result is None:
                return {"success": False, "message": "Failed to delete message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            return {"success": True, "messages": result}

        def _on_chat_regenerate_message(chat_id, bot_name, message_index, persona_id=None, persona_name=None):
            messages = self.chat_manager.load_chat(chat_id, bot_name)
            if messages is None:
                return {"success": False, "message": "Failed to load chat"}

            try:
                index = int(message_index)
            except Exception:
                return {"success": False, "message": "Invalid message index"}

            if index < 0 or index >= len(messages):
                return {"success": False, "message": "Invalid message index"}

            target_role = messages[index].get("role")
            if target_role not in ("assistant", "user"):
                return {"success": False, "message": "Target must be a user or assistant message"}

            resolved_persona = _resolve_persona_name_for_chat(chat_id, persona_name)
            history = []
            user_prompt = ""

            if target_role == "assistant":
                if index == 0 or messages[index - 1].get("role") != "user":
                    return {"success": False, "message": "No user prompt found before assistant message"}
                history = messages[:index]
                user_prompt = str((messages[index - 1] or {}).get("content", ""))
            else:
                if index + 1 < len(messages) and messages[index + 1].get("role") == "assistant":
                    return {"success": False, "message": "Use regenerate on assistant message when a reply already exists"}
                history = messages[:index]
                user_prompt = str((messages[index] or {}).get("content", ""))

            reply, error = self.prompt_pipeline.generate_reply_from_history(
                bot_name=bot_name,
                history_messages=history,
                persona_id=persona_id,
                persona_name=resolved_persona,
                latest_user_message=user_prompt
            )
            if error or not reply:
                return {"success": False, "message": f"Failed to regenerate: {error or 'Empty response'}"}

            if target_role == "assistant":
                result = self.chat_manager.edit_message(chat_id, bot_name, index, reply)
            else:
                result = self.chat_manager.insert_message(chat_id, bot_name, index + 1, "assistant", reply)
            if result is None:
                return {"success": False, "message": "Failed to save regenerated message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            return {"success": True, "messages": result}

        def _on_chat_continue_message(chat_id, bot_name, message_index, persona_id=None, persona_name=None):
            messages = self.chat_manager.load_chat(chat_id, bot_name)
            if messages is None:
                return {"success": False, "message": "Failed to load chat"}

            try:
                index = int(message_index)
            except Exception:
                return {"success": False, "message": "Invalid message index"}

            if index < 0 or index >= len(messages) or messages[index].get("role") != "assistant":
                return {"success": False, "message": "Target must be an assistant message"}

            resolved_persona = _resolve_persona_name_for_chat(chat_id, persona_name)
            history = messages[:index + 1]
            continue_prompt = (
                "Continue the previous assistant response from exactly where it stopped. "
                "Return only new continuation text. Do not restate, summarize, or repeat any earlier sentences."
            )
            continuation, error = self.prompt_pipeline.generate_reply_from_history(
                bot_name=bot_name,
                history_messages=history,
                persona_id=persona_id,
                persona_name=resolved_persona,
                latest_user_message=continue_prompt
            )
            if error or not continuation:
                return {"success": False, "message": f"Failed to continue message: {error or 'Empty response'}"}

            current_text = str((messages[index] or {}).get("content", ""))
            merged_text = _merge_assistant_continuation(current_text, continuation)

            result = self.chat_manager.edit_message(chat_id, bot_name, index, merged_text)
            if result is None:
                return {"success": False, "message": "Failed to save continued message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            return {"success": True, "messages": result}
            
        def _on_get_last_chat(bot_name):
            """Get the last chat for a bot, or the last chat from any bot if bot_name is None/empty"""
            if bot_name:
                last_chat_info = self.chat_manager.get_last_chat_for_bot(bot_name)
            else:
                last_chat_info = self.chat_manager.get_last_chat_any_bot()
            
            if last_chat_info:
                bot = last_chat_info.get("bot", bot_name)
                messages = self.chat_manager.load_chat(last_chat_info["id"], bot)
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
            
        def _on_persona_update(payload):
            persona_id = payload.get("persona_id") or payload.get("id")
            if not persona_id:
                return None
            updates = {
                "name": payload.get("name"),
                "description": payload.get("description"),
                "cover_art": payload.get("cover_art"),
                "icon_art": payload.get("icon_art"),
                "cover_art_fit": payload.get("cover_art_fit"),
                "icon_fit": payload.get("icon_fit")
            }
            persona = self.persona_manager.update_persona(persona_id, **updates)
            print(f"[GUI] Persona updated: {persona_id}")
            return persona

        def _on_persona_delete(persona_id):
            if not persona_id:
                return {"success": False, "message": "Missing persona id"}
            if persona_id == "User":
                return {"success": False, "message": "Cannot delete default User persona"}
            deleted = self.persona_manager.delete_persona(persona_id)
            if not deleted:
                return {"success": False, "message": "Failed to delete persona"}
            if self.current_persona_id == persona_id:
                self.current_persona_id = None
            print(f"[GUI] Persona deleted: {persona_id}")
            return {"success": True}

        def _on_persona_images(action, payload):
            persona_id = payload.get("persona_id") or payload.get("id") or payload.get("persona")
            if action == "list":
                return {"items": self.persona_manager.list_images(persona_id)}
            if action == "upload":
                item = self.persona_manager.add_image(persona_id, payload.get("filename"), payload.get("data_url"))
                return {"success": item is not None, "item": item}
            if action == "delete":
                success = self.persona_manager.delete_image(persona_id, payload.get("filename"))
                return {"success": success}
            if action == "set_coverart":
                persona = self.persona_manager.set_cover_art_from_image(persona_id, payload.get("filename"))
                return {"success": persona is not None, "persona": persona}
            if action == "set_icon":
                persona = self.persona_manager.set_icon_from_image(persona_id, payload.get("filename"), payload.get("source", "Images"))
                return {"success": persona is not None, "persona": persona}
            return {"success": False}
            
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

            provider = str(settings.get("api_provider", "openai")).strip().lower()
            api_key = settings.get("api_key", "")
            api_base_url = settings.get("api_base_url", "")
            selected_model = str(settings.get("model", "")).strip()

            if provider == "localmodel":
                models_root = Path(__file__).parent.parent / "Models" / "ChatModels"
                if not models_root.exists() or not models_root.is_dir():
                    return {"success": False, "message": f"Local model folder not found: {models_root}"}
                if not selected_model:
                    return {"success": False, "message": "Select a local model file first."}

                model_path = Path(selected_model)
                if not model_path.is_absolute():
                    model_path = models_root / selected_model
                if not model_path.exists() or not model_path.is_file():
                    return {"success": False, "message": f"Model file not found: {model_path}"}

                try:
                    from llama_cpp import Llama  # noqa: F401
                except Exception:
                    return {
                        "success": False,
                        "message": "LocalModel requires llama-cpp-python. Install it in your environment to use direct local model loading."
                    }

                return {"success": True, "message": f"Local model is available: {model_path.name}"}

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

        def _on_settings_list_local_models():
            models_root = Path(__file__).parent.parent / "Models" / "ChatModels"
            if not models_root.exists() or not models_root.is_dir():
                return {
                    "success": False,
                    "models": [],
                    "message": f"Folder not found: {models_root}"
                }

            allowed_extensions = {
                ".gguf",
                ".bin",
                ".safetensors",
                ".pt",
                ".pth"
            }

            model_items = []
            for file_path in models_root.rglob("*"):
                if not file_path.is_file():
                    continue
                if file_path.suffix.lower() not in allowed_extensions:
                    continue
                relative_path = str(file_path.relative_to(models_root)).replace("\\", "/")
                model_items.append(relative_path)

            model_items.sort(key=lambda value: value.lower())
            return {
                "success": True,
                "models": model_items,
                "message": f"Found {len(model_items)} local model file(s)."
            }

        self._gui_server, self._gui_thread, self._gui_url = start_gui_server(
            _on_message, _on_bot_list, _on_bot_select, _on_bot_create, _on_bot_update, _on_bot_delete, _on_bot_iam, _on_bot_images,
            _on_chat_list, _on_chat_create, _on_chat_delete, _on_chat_switch_iam, _on_chat_edit_message, _on_chat_delete_message,
            _on_chat_regenerate_message, _on_chat_continue_message, _on_get_last_chat, _on_load_chat, _on_settings_get, _on_settings_update, _on_settings_reset,
            _on_settings_test, _on_settings_list_local_models, _on_personas_list, _on_persona_select, _on_persona_create, _on_persona_update, _on_persona_delete, _on_persona_images
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
