# Standard library imports
import sys, threading, time, json, builtins, webbrowser, urllib.request, urllib.error
from datetime import datetime
from pathlib import Path

# Local imports
from console import ConsoleErrorRedirector, ConsoleRedirector, ConsoleWindow
from gui import start_gui_server
from bots_manager import BotManager
from bot_creation_manager import BotCreationManager
from chat_manager import ChatManager
from chats_manager import ChatsManager
from settings_manager import SettingsManager
from persona_manager import PersonaManager
from persona_creation_manager import PersonaCreationManager
from debug_manager import DebugManager
from dev_manager import DevManager
from main_page_manager import MainPageManager
from help_me_manager import HelpMeManager
from dataset_manager import DatasetManager
from prompt_pipeline import PromptPipeline
from module_extension_manager import ModuleExtensionManager

# Hey, you. You’re finally awake. You were trying to cross the paywall, right? 
# Walked right into that annoying censorship, same as us, and that thief over there.

# D**n you pirates. Prices were fine until you came along. OpenAI was nice and lazy. 
# If they hadn’t been looking for you, I could’ve stolen that API key and been half way to Goonerfell. 
# You there. You and me — we shouldn't be here. It’s those pirates the OpenAI wants.

# We’re all brothers and sisters in binds now, thief...

# *Cries in AI hard*

# Welcome to BlueNovaAI, the ultimate local AI interface for all your needs!

# DO NOT judge me, mkey?

class Application:
    def __init__(self):

        self.name = "BlueNovaAI 1.0.0"
        self.author = "Saimon(Szaszakg)"

        self.console = ConsoleWindow(f"{self.name} Console")
        self.console.set_command_handler(self._on_console_command)
        self._install_console_redirects()
        self._original_print = builtins.print
        self._gui_server = None
        self._gui_thread = None
        self._gui_url = None
        
        # Initialize managers
        self.bot_manager = BotManager()
        self.bot_creation_manager = BotCreationManager()
        self.chat_manager = ChatManager()
        self.chats_manager = ChatsManager(self.chat_manager)
        self.settings_manager = SettingsManager()
        self.persona_manager = PersonaManager()
        self.persona_creation_manager = PersonaCreationManager()
        self.debug_manager = DebugManager(self.settings_manager, self._original_print)
        self.dev_manager = DevManager(self.settings_manager, self.debug_manager)
        self.main_page_manager = MainPageManager()
        self.help_me_manager = HelpMeManager()
        self.dataset_manager = DatasetManager()
        self.console.set_output_hook(self.debug_manager.on_console_output)
        
        # Track current active bot and persona
        self.current_bot_name = None
        self.current_persona_id = None
        self.prompt_pipeline = PromptPipeline(
            self.bot_manager,
            self.chat_manager,
            self.persona_manager,
            self.settings_manager,
            debug_logger=self.debug_manager.log_event,
            dataset_manager=self.dataset_manager
        )
        self.module_extension_manager = ModuleExtensionManager(
            Path(__file__).parent.parent / "Modules",
            debug_logger=self.debug_manager.log_event
        )
        self._generation_cancel_event = threading.Event()
        self._module_action_read_cache = {}
        self._module_action_read_cache_lock = threading.Lock()
        self._module_action_read_ttl_seconds = 0.35
        
        # Extension lifecycle management
        self._extension_shutdown_callbacks = []

        self._app_thread = threading.Thread(target=self._run_app, daemon=True)
        self._app_thread.start()

        try:
            self.console.start()
        finally:
            self._restore_console_redirects()

    def _run_app(self):
        try:
            print(f"{self.name} initialized! Made by {self.author} for all your botting needs!\n")
            self._start_gui()
            self.console.show_help()
            self.run()
        except EOFError:
            return
        except Exception as exc: 
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

    def _on_console_command(self, command):
        """Handle console commands"""
        if command == "restart":
            self._restart()
            return True
        return False

    def _restart(self):
        """Restart the application"""
        print("Restarting application...")
        self._stop_gui()
        self._start_gui()
        print("Application restarted.")

    def _load_extensions(self):
        """Reserved extension hook loader (legacy extension loading removed)."""
        return

    def _start_gui(self):
        if self._gui_server is not None:
            return

        # Initialize extension callbacks dict (populated by modules during extend())
        self._extension_callbacks = {}
        
        # Load extensions BEFORE GUI startup so they can register callbacks
        self._load_extensions()

        def _on_stop_generation(_payload=None):
            self._generation_cancel_event.set()
            self.debug_manager.log_event("message.cancel_requested")
            return {"success": True}

        def _resolve_persona_name_for_chat(chat_id, requested_persona_name=None):
            chosen = (requested_persona_name or "").strip()
            stored = ""
            if chat_id:
                stored = (self.chats_manager.get_chat_persona(chat_id) or "").strip()
            if not chosen or chosen == "User":
                if stored and stored != "User":
                    chosen = stored
                elif not chosen:
                    chosen = stored
            if not chosen:
                chosen = "User"
            return chosen

        def _on_message(message, save_response=False, chat_id=None, bot_name=None, persona_id=None, persona_name=None):
            print(f"[GUI] Message: {message} (save_response={save_response})")
            self.debug_manager.log_event(
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
                
                self.debug_manager.log_event("message.saved_assistant", chat_id=chat_id, bot_name=bot_name)
                return {
                    "success": True,
                }
            else:
                self._generation_cancel_event.clear()
                # This is a user message
                active_chat_id = chat_id or self.chat_manager.current_chat_id
                active_bot_name = bot_name or self.current_bot_name
                if active_chat_id and active_bot_name:
                    self.chat_manager.add_message("user", message, active_chat_id, active_bot_name)
                requested_persona_name = (persona_name or "").strip()
                stored_persona_name = ""
                if active_chat_id:
                    stored_persona_name = (self.chats_manager.get_chat_persona(active_chat_id) or "").strip()

                resolved_persona_name = _resolve_persona_name_for_chat(active_chat_id, requested_persona_name)
                self.debug_manager.log_event(
                    "message.context_resolved",
                    active_chat_id=active_chat_id,
                    active_bot_name=active_bot_name,
                    requested_persona_name=requested_persona_name,
                    stored_persona_name=stored_persona_name,
                    resolved_persona_name=resolved_persona_name
                )

                reply, error = self.prompt_pipeline.generate_reply(
                    user_message=message,
                    bot_name=active_bot_name,
                    chat_id=active_chat_id,
                    persona_id=persona_id,
                    persona_name=resolved_persona_name,
                    cancel_check=self._generation_cancel_event.is_set
                )
                if self._generation_cancel_event.is_set():
                    self.debug_manager.log_event("message.cancelled", chat_id=active_chat_id, bot_name=active_bot_name)
                    return {
                        "response": "",
                        "cancelled": True
                    }
                if error:
                    self.debug_manager.log_event("message.reply_error", error=error)
                    return {
                        "response": f"API error: {error}",
                    }
                self.debug_manager.log_event("message.reply_success", reply_length=len(str(reply or "")))
                return {
                    "response": reply or "API error: LLM returned empty response.",
                }

            return {"response": ""}

        def _on_message_stream(message, chat_id=None, bot_name=None, persona_id=None, persona_name=None):
            print(f"[GUI] Message stream: {message}")
            self.debug_manager.log_event(
                "message.stream_received",
                chat_id=chat_id,
                bot_name=bot_name,
                persona_id=persona_id,
                persona_name=persona_name,
                message_length=len(str(message or ""))
            )

            self._generation_cancel_event.clear()
            active_chat_id = chat_id or self.chat_manager.current_chat_id
            active_bot_name = bot_name or self.current_bot_name
            if active_chat_id and active_bot_name:
                self.chat_manager.add_message("user", message, active_chat_id, active_bot_name)

            requested_persona_name = (persona_name or "").strip()
            stored_persona_name = ""
            if active_chat_id:
                stored_persona_name = (self.chats_manager.get_chat_persona(active_chat_id) or "").strip()

            resolved_persona_name = _resolve_persona_name_for_chat(active_chat_id, requested_persona_name)

            self.debug_manager.log_event(
                "message.stream_context_resolved",
                active_chat_id=active_chat_id,
                active_bot_name=active_bot_name,
                requested_persona_name=requested_persona_name,
                stored_persona_name=stored_persona_name,
                resolved_persona_name=resolved_persona_name
            )

            try:
                for event in self.prompt_pipeline.generate_reply_stream(
                    user_message=message,
                    bot_name=active_bot_name,
                    chat_id=active_chat_id,
                    persona_id=persona_id,
                    persona_name=resolved_persona_name,
                    cancel_check=self._generation_cancel_event.is_set
                ):
                    if self._generation_cancel_event.is_set():
                        self.debug_manager.log_event("message.stream_cancelled", chat_id=active_chat_id, bot_name=active_bot_name)
                        yield {"type": "cancelled"}
                        return
                    if isinstance(event, dict):
                        yield event
                    else:
                        yield {"type": "chunk", "text": str(event or "")}
            except Exception as exc:
                self.debug_manager.log_event("message.stream_error", error=str(exc))
                yield {"type": "error", "error": str(exc)}
                return
            
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
                last_chat = self.chats_manager.get_last_chat_for_bot(bot_name)
                if last_chat:
                    self.chats_manager.load_chat(last_chat["id"], bot_name)
                # Don't auto-create a new chat, let the GUI handle it
            return bot
            
        def _on_bot_create(bot_name, core_data):
            bot = self.bot_creation_manager.create_bot(bot_name, core_data)
            print(f"[GUI] Bot creation requested: {bot_name}")
            return bot

        def _on_bot_update(payload):
            bot_name = payload.get("bot_name")
            new_name = payload.get("new_name")
            if not bot_name:
                return {"success": False, "message": "Missing bot name"}

            if new_name and new_name != bot_name:
                if str(bot_name).strip().lower() == "nova":
                    return {"success": False, "message": "Nova cannot be renamed."}
                renamed = self.bot_manager.rename_bot(bot_name, new_name)
                if not renamed:
                    return {"success": False, "message": "Rename failed"}
                self.chats_manager.rename_bot(bot_name, new_name)
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
                "prompt_order_enabled": payload.get("prompt_order_enabled"),
                "modules": payload.get("modules"),
                "module_settings": payload.get("module_settings"),
                "active_iam_set": payload.get("active_iam_set"),
                "active_dataset_id": payload.get("active_dataset_id"),
                "dataset_injection_persistence": payload.get("dataset_injection_persistence"),
                "example_messages": payload.get("example_messages"),
                "example_injection_threshold": payload.get("example_injection_threshold"),
            }
            bot = self.bot_manager.update_bot(bot_name, updates)
            return {"success": bot is not None, "bot": bot}
                
        def _on_bot_delete(bot_name):
            if not bot_name:
                return {"success": False, "message": "Missing bot name"}
            if str(bot_name).strip().lower() == "nova":
                return {"success": False, "message": "She kinda needs to exist for this entire thing to work... Sorry, not sorry."}

            deleted = self.bot_manager.delete_bot(bot_name)
            if not deleted:
                return {"success": False, "message": "Failed to delete bot"}

            self.chats_manager.delete_chats_for_bot(bot_name)
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

        def _on_bot_draft(action, payload):
            if action == "load":
                draft = self.bot_creation_manager.load_bot_creation_draft()
                return {"success": True, "draft": draft}
            if action == "save":
                success = self.bot_creation_manager.save_bot_creation_draft(payload.get("draft"))
                return {"success": success}
            if action == "clear":
                success = self.bot_creation_manager.clear_bot_creation_draft()
                return {"success": success}
            return {"success": False, "message": "Unsupported draft action"}

        def _summarize_chat_messages(messages):
            if not isinstance(messages, list):
                return {"count": 0, "user": 0, "assistant": 0}
            user_count = 0
            assistant_count = 0
            for item in messages:
                role = (item or {}).get("role") if isinstance(item, dict) else None
                if role == "user":
                    user_count += 1
                elif role == "assistant":
                    assistant_count += 1
            return {
                "count": len(messages),
                "user": user_count,
                "assistant": assistant_count
            }

        def _debug_chat_action(event, **details):
            self.debug_manager.log_event(f"chat_action.{event}", **details)
            
        def _on_chat_list():
            chats = self.chats_manager.get_all_chats()
            print(f"[GUI] Chat list requested: {len(chats)} chats found")
            return chats
            
        def _on_chat_create(bot_name, title, persona_name=None, iam_set=None):
            chat = self.chats_manager.create_chat(bot_name, title, persona_name, iam_set)
            print(f"[GUI] Chat created: {title} with {bot_name}")
            return chat

        def _on_chat_delete(chat_id):
            success = self.chats_manager.delete_chat(chat_id)
            print(f"[GUI] Chat delete requested: {chat_id} ({'successful' if success else 'failed'})")
            return {"success": success}

        def _on_chat_switch_iam(chat_id, bot_name, iam_set, persona_name=None):
            _debug_chat_action(
                "switch_iam.request",
                chat_id=chat_id,
                bot_name=bot_name,
                iam_set=iam_set,
                persona_name=persona_name
            )
            result = self.chats_manager.switch_chat_iam_set(chat_id, bot_name, iam_set, persona_name)
            if result is None:
                _debug_chat_action(
                    "switch_iam.rejected",
                    chat_id=chat_id,
                    bot_name=bot_name,
                    iam_set=iam_set
                )
                return {"success": False, "message": "Cannot switch IAM after first user message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            _debug_chat_action(
                "switch_iam.success",
                chat_id=chat_id,
                bot_name=bot_name,
                iam_set=iam_set,
                summary=_summarize_chat_messages(result)
            )
            return {
                "success": True,
                "messages": result,
            }

        def _normalize_chat_message_index(messages, message_index, client_message_count=None):
            try:
                resolved_index = int(message_index)
            except Exception:
                _debug_chat_action(
                    "index.invalid_input",
                    client_message_count=client_message_count,
                    loaded_count=len(messages) if isinstance(messages, list) else None
                )
                return None

            client_count = None
            if client_message_count is not None:
                try:
                    client_count = int(client_message_count)
                except Exception:
                    client_count = None

            if client_count is not None and client_count > len(messages):
                offset = client_count - len(messages)
                resolved_index -= offset
                _debug_chat_action(
                    "index.offset_applied",
                    original_index=message_index,
                    resolved_index=resolved_index,
                    client_count=client_count,
                    loaded_count=len(messages),
                    offset=offset
                )

            if resolved_index < 0 or resolved_index >= len(messages):
                _debug_chat_action(
                    "index.out_of_range",
                    resolved_index=resolved_index,
                    loaded_count=len(messages),
                    client_count=client_count
                )
                return None
            _debug_chat_action(
                "index.resolved",
                original_index=message_index,
                resolved_index=resolved_index,
                client_count=client_count,
                loaded_count=len(messages)
            )
            return resolved_index

        def _on_chat_edit_message(chat_id, bot_name, message_index, content, client_message_count=None):
            _debug_chat_action(
                "edit.request",
                chat_id=chat_id,
                bot_name=bot_name,
                message_index=message_index,
                client_message_count=client_message_count,
                content_length=len(str(content or ""))
            )
            messages = self.chat_manager.load_chat(chat_id, bot_name)
            if messages is None:
                _debug_chat_action("edit.load_failed", chat_id=chat_id, bot_name=bot_name)
                return {"success": False, "message": "Failed to load chat"}

            resolved_index = _normalize_chat_message_index(messages, message_index, client_message_count)
            if resolved_index is None:
                _debug_chat_action("edit.invalid_index", chat_id=chat_id, bot_name=bot_name, message_index=message_index)
                return {"success": False, "message": "Invalid message index"}

            result = self.chat_manager.edit_message(chat_id, bot_name, resolved_index, content)
            if result is None:
                _debug_chat_action("edit.persist_failed", chat_id=chat_id, bot_name=bot_name, resolved_index=resolved_index)
                return {"success": False, "message": "Failed to edit message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            _debug_chat_action(
                "edit.success",
                chat_id=chat_id,
                bot_name=bot_name,
                resolved_index=resolved_index,
                summary=_summarize_chat_messages(result)
            )
            return {
                "success": True,
                "messages": result,
            }

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

        def _on_chat_delete_message(chat_id, bot_name, message_index, client_message_count=None):
            _debug_chat_action(
                "delete.request",
                chat_id=chat_id,
                bot_name=bot_name,
                message_index=message_index,
                client_message_count=client_message_count
            )
            messages = self.chat_manager.load_chat(chat_id, bot_name)
            if messages is None:
                _debug_chat_action("delete.load_failed", chat_id=chat_id, bot_name=bot_name)
                return {"success": False, "message": "Failed to load chat"}

            resolved_index = _normalize_chat_message_index(messages, message_index, client_message_count)
            if resolved_index is None:
                _debug_chat_action("delete.invalid_index", chat_id=chat_id, bot_name=bot_name, message_index=message_index)
                return {"success": False, "message": "Invalid message index"}

            result = self.chat_manager.delete_message(chat_id, bot_name, resolved_index)
            if result is None:
                _debug_chat_action("delete.persist_failed", chat_id=chat_id, bot_name=bot_name, resolved_index=resolved_index)
                return {"success": False, "message": "Failed to delete message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            _debug_chat_action(
                "delete.success",
                chat_id=chat_id,
                bot_name=bot_name,
                resolved_index=resolved_index,
                summary=_summarize_chat_messages(result)
            )
            return {
                "success": True,
                "messages": result,
            }

        def _on_chat_regenerate_message(chat_id, bot_name, message_index, client_message_count=None, persona_id=None, persona_name=None):
            self._generation_cancel_event.clear()
            module_progress_events = []

            def _module_progress_callback(event):
                if isinstance(event, dict):
                    module_progress_events.append(dict(event))

            _debug_chat_action(
                "regenerate.request",
                chat_id=chat_id,
                bot_name=bot_name,
                message_index=message_index,
                client_message_count=client_message_count,
                persona_id=persona_id,
                persona_name=persona_name
            )
            messages = self.chat_manager.load_chat(chat_id, bot_name)
            if messages is None:
                _debug_chat_action("regenerate.load_failed", chat_id=chat_id, bot_name=bot_name)
                return {"success": False, "message": "Failed to load chat"}

            index = _normalize_chat_message_index(messages, message_index, client_message_count)
            if index is None:
                _debug_chat_action("regenerate.invalid_index", chat_id=chat_id, bot_name=bot_name, message_index=message_index)
                return {"success": False, "message": "Invalid message index"}

            target_role = messages[index].get("role")
            if target_role not in ("assistant", "user"):
                _debug_chat_action("regenerate.invalid_target", chat_id=chat_id, bot_name=bot_name, resolved_index=index, target_role=target_role)
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

            _debug_chat_action(
                "regenerate.pipeline_begin",
                chat_id=chat_id,
                bot_name=bot_name,
                resolved_index=index,
                target_role=target_role,
                history_count=len(history),
                prompt_length=len(str(user_prompt or ""))
            )

            reply, error = self.prompt_pipeline.generate_reply_from_history(
                bot_name=bot_name,
                chat_id=chat_id,
                history_messages=history,
                persona_id=persona_id,
                persona_name=resolved_persona,
                latest_user_message=user_prompt,
                cancel_check=self._generation_cancel_event.is_set,
                module_progress_callback=_module_progress_callback,
            )

            _debug_chat_action(
                "regenerate.pipeline_complete",
                chat_id=chat_id,
                bot_name=bot_name,
                resolved_index=index,
                target_role=target_role,
                error=error,
                has_reply=bool(reply),
                reply_length=len(str(reply or ""))
            )

            if self._generation_cancel_event.is_set():
                _debug_chat_action(
                    "regenerate.cancelled",
                    chat_id=chat_id,
                    bot_name=bot_name,
                    resolved_index=index,
                    target_role=target_role
                )
                return {
                    "success": True,
                    "cancelled": True,
                    "messages": messages,
                    "module_progress_events": module_progress_events,
                }

            if error or not reply:
                _debug_chat_action(
                    "regenerate.pipeline_failed",
                    chat_id=chat_id,
                    bot_name=bot_name,
                    resolved_index=index,
                    error=error,
                    has_reply=bool(reply)
                )
                return {"success": False, "message": f"Failed to regenerate: {error or 'Empty response'}"}

            if target_role == "assistant":
                result = self.chat_manager.add_assistant_variant(chat_id, bot_name, index, reply)
            else:
                result = self.chat_manager.insert_message(chat_id, bot_name, index + 1, "assistant", reply)
            if result is None:
                _debug_chat_action("regenerate.persist_failed", chat_id=chat_id, bot_name=bot_name, resolved_index=index)
                return {"success": False, "message": "Failed to save regenerated message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            _debug_chat_action(
                "regenerate.success",
                chat_id=chat_id,
                bot_name=bot_name,
                resolved_index=index,
                target_role=target_role,
                summary=_summarize_chat_messages(result)
            )
            return {
                "success": True,
                "messages": result,
                "module_progress_events": module_progress_events,
            }

        def _on_chat_select_variant(chat_id, bot_name, message_index, variant_index, client_message_count=None):
            _debug_chat_action(
                "select_variant.request",
                chat_id=chat_id,
                bot_name=bot_name,
                message_index=message_index,
                variant_index=variant_index,
                client_message_count=client_message_count
            )
            messages = self.chat_manager.load_chat(chat_id, bot_name)
            if messages is None:
                _debug_chat_action("select_variant.load_failed", chat_id=chat_id, bot_name=bot_name)
                return {"success": False, "message": "Failed to load chat"}

            resolved_index = _normalize_chat_message_index(messages, message_index, client_message_count)
            if resolved_index is None:
                _debug_chat_action("select_variant.invalid_index", chat_id=chat_id, bot_name=bot_name, message_index=message_index)
                return {"success": False, "message": "Invalid message index"}

            result = self.chat_manager.select_assistant_variant(chat_id, bot_name, resolved_index, variant_index)
            if result is None:
                _debug_chat_action(
                    "select_variant.persist_failed",
                    chat_id=chat_id,
                    bot_name=bot_name,
                    resolved_index=resolved_index,
                    variant_index=variant_index
                )
                return {"success": False, "message": "Failed to select message variant"}

            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            _debug_chat_action(
                "select_variant.success",
                chat_id=chat_id,
                bot_name=bot_name,
                resolved_index=resolved_index,
                variant_index=variant_index,
                summary=_summarize_chat_messages(result)
            )
            return {
                "success": True,
                "messages": result,
            }

        def _on_chat_continue_message(chat_id, bot_name, message_index, client_message_count=None, persona_id=None, persona_name=None):
            self._generation_cancel_event.clear()
            module_progress_events = []

            def _module_progress_callback(event):
                if isinstance(event, dict):
                    module_progress_events.append(dict(event))

            _debug_chat_action(
                "continue.request",
                chat_id=chat_id,
                bot_name=bot_name,
                message_index=message_index,
                client_message_count=client_message_count,
                persona_id=persona_id,
                persona_name=persona_name
            )
            messages = self.chat_manager.load_chat(chat_id, bot_name)
            if messages is None:
                _debug_chat_action("continue.load_failed", chat_id=chat_id, bot_name=bot_name)
                return {"success": False, "message": "Failed to load chat"}

            index = _normalize_chat_message_index(messages, message_index, client_message_count)
            if index is None or messages[index].get("role") != "assistant":
                _debug_chat_action(
                    "continue.invalid_target",
                    chat_id=chat_id,
                    bot_name=bot_name,
                    resolved_index=index,
                    target_role=(messages[index].get("role") if index is not None and index < len(messages) else None)
                )
                return {"success": False, "message": "Target must be an assistant message"}

            resolved_persona = _resolve_persona_name_for_chat(chat_id, persona_name)
            history = messages[:index + 1]
            continue_prompt = (
                "Continue the previous assistant response from exactly where it stopped. "
                "Return only new continuation text. Do not restate, summarize, or repeat any earlier sentences."
            )
            continuation, error = self.prompt_pipeline.generate_reply_from_history(
                bot_name=bot_name,
                chat_id=chat_id,
                history_messages=history,
                persona_id=persona_id,
                persona_name=resolved_persona,
                latest_user_message=continue_prompt,
                cancel_check=self._generation_cancel_event.is_set,
                module_progress_callback=_module_progress_callback,
            )

            if self._generation_cancel_event.is_set():
                _debug_chat_action(
                    "continue.cancelled",
                    chat_id=chat_id,
                    bot_name=bot_name,
                    resolved_index=index
                )
                return {
                    "success": True,
                    "cancelled": True,
                    "messages": messages,
                    "module_progress_events": module_progress_events,
                }

            if error or not continuation:
                _debug_chat_action(
                    "continue.pipeline_failed",
                    chat_id=chat_id,
                    bot_name=bot_name,
                    resolved_index=index,
                    error=error,
                    has_continuation=bool(continuation)
                )
                return {"success": False, "message": f"Failed to continue message: {error or 'Empty response'}"}

            current_text = str((messages[index] or {}).get("content", ""))
            merged_text = _merge_assistant_continuation(current_text, continuation)

            result = self.chat_manager.edit_message(chat_id, bot_name, index, merged_text)
            if result is None:
                _debug_chat_action("continue.persist_failed", chat_id=chat_id, bot_name=bot_name, resolved_index=index)
                return {"success": False, "message": "Failed to save continued message"}
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            _debug_chat_action(
                "continue.success",
                chat_id=chat_id,
                bot_name=bot_name,
                resolved_index=index,
                continuation_length=len(str(continuation or "")),
                summary=_summarize_chat_messages(result)
            )
            return {
                "success": True,
                "messages": result,
                "module_progress_events": module_progress_events,
            }

        def _on_chat_action_stream(payload):
            body = payload if isinstance(payload, dict) else {}
            action = str(body.get("action") or "").strip().lower()
            chat_id = body.get("chat_id")
            bot_name = body.get("bot_name")
            message_index = body.get("message_index")
            client_message_count = body.get("client_message_count")
            persona_id = body.get("persona_id")
            persona_name = body.get("persona_name")

            if action not in ("regenerate_message", "continue_message"):
                yield {"type": "error", "error": "Unsupported streaming chat action."}
                return

            action_timeout_seconds = 65.0
            action_started_at = time.monotonic()

            self._generation_cancel_event.clear()
            module_progress_events = []

            def _module_progress_callback(event):
                if isinstance(event, dict):
                    module_progress_events.append(dict(event))

            messages = self.chat_manager.load_chat(chat_id, bot_name)
            if messages is None:
                yield {"type": "error", "error": "Failed to load chat"}
                return

            index = _normalize_chat_message_index(messages, message_index, client_message_count)
            if index is None:
                yield {"type": "error", "error": "Invalid message index"}
                return

            resolved_persona = _resolve_persona_name_for_chat(chat_id, persona_name)
            history = []
            user_prompt = ""
            target_role = None

            if action == "regenerate_message":
                target_role = messages[index].get("role")
                if target_role not in ("assistant", "user"):
                    yield {"type": "error", "error": "Target must be a user or assistant message"}
                    return

                if target_role == "assistant":
                    if index == 0 or messages[index - 1].get("role") != "user":
                        yield {"type": "error", "error": "No user prompt found before assistant message"}
                        return
                    history = messages[:index]
                    user_prompt = str((messages[index - 1] or {}).get("content", ""))
                else:
                    if index + 1 < len(messages) and messages[index + 1].get("role") == "assistant":
                        yield {"type": "error", "error": "Use regenerate on assistant message when a reply already exists"}
                        return
                    history = messages[:index]
                    user_prompt = str((messages[index] or {}).get("content", ""))
            else:
                target_role = messages[index].get("role")
                if target_role != "assistant":
                    yield {"type": "error", "error": "Target must be an assistant message"}
                    return
                history = messages[:index + 1]
                user_prompt = (
                    "Continue the previous assistant response from exactly where it stopped. "
                    "Return only new continuation text. Do not restate, summarize, or repeat any earlier sentences."
                )

            generated_reply = ""
            try:
                for event in self.prompt_pipeline.generate_reply_stream_from_history(
                    bot_name=bot_name,
                    chat_id=chat_id,
                    history_messages=history,
                    persona_id=persona_id,
                    persona_name=resolved_persona,
                    latest_user_message=user_prompt,
                    cancel_check=self._generation_cancel_event.is_set,
                    module_progress_callback=_module_progress_callback,
                ):
                    if (time.monotonic() - action_started_at) >= action_timeout_seconds:
                        yield {"type": "error", "error": "Chat action timed out. Please try regenerate again."}
                        return

                    if self._generation_cancel_event.is_set():
                        yield {
                            "type": "cancelled",
                            "messages": messages,
                            "module_progress_events": module_progress_events,
                        }
                        return

                    if not isinstance(event, dict):
                        yield {"type": "chunk", "text": str(event or "")}
                        continue

                    event_type = str(event.get("type") or "").strip().lower()
                    if event_type == "done":
                        generated_reply = str(event.get("response") or "")
                        continue
                    if event_type == "error":
                        yield event
                        return
                    if event_type == "cancelled":
                        yield {
                            "type": "cancelled",
                            "messages": messages,
                            "module_progress_events": module_progress_events,
                        }
                        return
                    yield event
            except Exception as exc:
                yield {"type": "error", "error": str(exc)}
                return

            if self._generation_cancel_event.is_set():
                yield {
                    "type": "cancelled",
                    "messages": messages,
                    "module_progress_events": module_progress_events,
                }
                return

            if not generated_reply:
                yield {"type": "error", "error": "LLM returned an empty response."}
                return

            if action == "regenerate_message":
                if target_role == "assistant":
                    result_messages = self.chat_manager.add_assistant_variant(chat_id, bot_name, index, generated_reply)
                else:
                    result_messages = self.chat_manager.insert_message(chat_id, bot_name, index + 1, "assistant", generated_reply)
            else:
                current_text = str((messages[index] or {}).get("content", ""))
                merged_text = _merge_assistant_continuation(current_text, generated_reply)
                result_messages = self.chat_manager.edit_message(chat_id, bot_name, index, merged_text)

            if result_messages is None:
                yield {"type": "error", "error": "Failed to save chat action result."}
                return

            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name

            yield {
                "type": "done",
                "response": generated_reply,
                "success": True,
                "action": action,
                "messages": result_messages,
                "module_progress_events": module_progress_events,
            }
            
        def _on_get_last_chat(bot_name):
            """Get the last chat for a bot, or the last chat from any bot if bot_name is None/empty"""
            if bot_name:
                last_chat_info = self.chats_manager.get_last_chat_for_bot(bot_name)
            else:
                last_chat_info = self.chats_manager.get_last_chat_any_bot()
            
            if last_chat_info:
                bot = last_chat_info.get("bot", bot_name)
                messages = self.chats_manager.load_chat(last_chat_info["id"], bot)
                return {
                    "chat_info": last_chat_info,
                    "messages": messages,
                }
            return None
        
        def _on_load_chat(chat_id, bot_name):
            """Load a specific chat by ID and bot name"""
            messages = self.chats_manager.load_chat(chat_id, bot_name)
            self.chat_manager.current_chat_id = chat_id
            self.current_bot_name = bot_name
            return {
                "messages": messages,
            }
            
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
            persona = self.persona_creation_manager.create_persona(name, description, cover_art)
            print(f"[GUI] Persona created: {name}")
            return persona
            
        def _on_persona_update(payload):
            persona_id = payload.get("persona_id") or payload.get("id")
            if not persona_id:
                return {"success": False, "message": "Missing persona id"}
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
            return {"success": persona is not None, "persona": persona}

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

        def _on_persona_draft(action, payload):
            if action == "load":
                draft = self.persona_creation_manager.load_persona_creation_draft()
                return {"success": True, "draft": draft}
            if action == "save":
                success = self.persona_creation_manager.save_persona_creation_draft(payload.get("draft"))
                return {"success": success}
            if action == "clear":
                success = self.persona_creation_manager.clear_persona_creation_draft()
                return {"success": success}
            if action == "load_edit":
                persona_id = payload.get("persona_id") or payload.get("id")
                draft = self.persona_manager.load_persona_edit_draft(persona_id)
                return {"success": True, "draft": draft}
            if action == "save_edit":
                persona_id = payload.get("persona_id") or payload.get("id")
                success = self.persona_manager.save_persona_edit_draft(persona_id, payload.get("draft"))
                return {"success": success}
            if action == "clear_edit":
                persona_id = payload.get("persona_id") or payload.get("id")
                success = self.persona_manager.clear_persona_edit_draft(persona_id)
                return {"success": success}
            return {"success": False, "message": "Unsupported persona draft action"}
            
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

        def _on_modules_list():
            return self.bot_manager.get_module_definitions()

        def _on_main_page_get():
            return self.main_page_manager.get_config()

        def _on_help_me_get():
            return self.help_me_manager.get_docs_tree()

        def _on_module_action(payload):
            data = payload if isinstance(payload, dict) else {}
            module_name = str(data.get('module_name') or '').strip()
            action = str(data.get('action') or '').strip()
            module_payload = data.get('payload') if isinstance(data.get('payload'), dict) else {}

            if not module_name or not action:
                return {"success": False, "message": "Missing module_name or action"}

            bot_name = str(
                data.get('bot_name')
                or module_payload.get('bot_name')
                or self.current_bot_name
                or ''
            ).strip()
            chat_id = str(
                data.get('chat_id')
                or module_payload.get('chat_id')
                or self.chat_manager.current_chat_id
                or ''
            ).strip()

            action_lower = action.lower()
            read_actions = {'list', 'get', 'status', 'health', 'fetch'}
            is_read_action = action_lower in read_actions
            cache_key = None

            if is_read_action:
                try:
                    payload_signature = json.dumps(module_payload, sort_keys=True, ensure_ascii=False, default=str)
                except Exception:
                    payload_signature = repr(module_payload)
                cache_key = (module_name.lower(), action_lower, bot_name, chat_id, payload_signature)
                now = time.monotonic()
                with self._module_action_read_cache_lock:
                    cached_entry = self._module_action_read_cache.get(cache_key)
                    if cached_entry:
                        cached_at = float(cached_entry.get('time') or 0.0)
                        if (now - cached_at) < self._module_action_read_ttl_seconds:
                            cached_response = cached_entry.get('response')
                            if isinstance(cached_response, dict):
                                return dict(cached_response)

            context = {
                'main_instance': self,
                'bot_name': bot_name,
                'chat_id': chat_id,
                'bot_manager': self.bot_manager,
                'chat_manager': self.chat_manager,
                'persona_manager': self.persona_manager,
                'settings_manager': self.settings_manager,
                'prompt_pipeline': self.prompt_pipeline,
                'debug_logger': self.debug_manager.log_event,
                'generation_cancel_event': self._generation_cancel_event,
            }

            outcome = self.module_extension_manager.execute_module_action(
                module_name,
                action,
                payload=module_payload,
                context=context
            )

            if not outcome.get("handled"):
                return {
                    "success": False,
                    "message": f"Module action not handled: {module_name}.{action}",
                    "module_name": module_name,
                    "action": action,
                    "targets": outcome.get("targets") or []
                }

            result_payload = outcome.get("result")
            if isinstance(result_payload, dict):
                merged = dict(result_payload)
                merged.setdefault("success", True)
            else:
                merged = {"success": True, "result": result_payload}
            merged.setdefault("module_name", module_name)
            merged.setdefault("action", action)
            merged.setdefault("targets", outcome.get("targets") or [])

            if is_read_action and cache_key is not None and isinstance(merged, dict):
                with self._module_action_read_cache_lock:
                    self._module_action_read_cache[cache_key] = {
                        'time': time.monotonic(),
                        'response': dict(merged)
                    }
                    if len(self._module_action_read_cache) > 300:
                        oldest_key = min(
                            self._module_action_read_cache,
                            key=lambda key: float(self._module_action_read_cache[key].get('time') or 0.0)
                        )
                        self._module_action_read_cache.pop(oldest_key, None)

            return merged

        def _on_dev_system_info():
            return self.dev_manager.get_system_info()

        def _on_dev_debug_logs():
            return self.dev_manager.get_debug_logs_summary()
        
        def _on_dev_delete_logs(data):
            if 'on_dev_delete_logs' in self._extension_callbacks:
                return self._extension_callbacks['on_dev_delete_logs'](data)
            return self.dev_manager.delete_debug_logs()

        def _on_debug_event(payload):
            body = payload if isinstance(payload, dict) else {}
            event_name = str(body.get('event') or '').strip()
            source = str(body.get('source') or 'frontend').strip() or 'frontend'
            details = body.get('details') if isinstance(body.get('details'), dict) else {}
            if not event_name:
                return {"success": False, "message": "Missing event"}
            self.debug_manager.log_event(f"{source}.{event_name}", **details)
            return {"success": True}

        def _on_dataset_list(bot_name=None):
            return self.dataset_manager.list_datasets()

        def _on_dataset_action(action, payload):
            action_name = str(action or "").strip().lower()
            data = payload if isinstance(payload, dict) else {}

            if action_name == "create_dataset":
                return self.dataset_manager.create_dataset(None, data.get("name"), data.get("description"))
            if action_name == "update_dataset":
                return self.dataset_manager.update_dataset(None, data.get("dataset_id"), name=data.get("name"), description=data.get("description"))
            if action_name == "delete_dataset":
                return self.dataset_manager.delete_dataset(None, data.get("dataset_id"))
            if action_name == "create_entry":
                return self.dataset_manager.create_entry(None, data.get("dataset_id"), data.get("entry"))
            if action_name == "update_entry":
                return self.dataset_manager.update_entry(None, data.get("dataset_id"), data.get("entry_id"), data.get("entry"))
            if action_name == "delete_entry":
                return self.dataset_manager.delete_entry(None, data.get("dataset_id"), data.get("entry_id"))
            if action_name == "reorder_entries":
                return self.dataset_manager.reorder_entries(None, data.get("dataset_id"), data.get("entry_ids"))
            if action_name == "list":
                return self.dataset_manager.list_datasets()

            return {"success": False, "message": f"Unsupported dataset action: {action_name or 'unknown'}"}

        # Build callbacks dict: core callbacks + extension callbacks
        callbacks_dict = {
            'on_message': _on_message,
            'on_message_stream': _on_message_stream,
            'on_stop_generation': _on_stop_generation,
            'on_debug_event': _on_debug_event,
            'on_bot_list': _on_bot_list,
            'on_bot_select': _on_bot_select,
            'on_bot_create': _on_bot_create,
            'on_bot_update': _on_bot_update,
            'on_bot_delete': _on_bot_delete,
            'on_bot_iam': _on_bot_iam,
            'on_bot_images': _on_bot_images,
            'on_bot_draft': _on_bot_draft,
            'on_chat_list': _on_chat_list,
            'on_chat_create': _on_chat_create,
            'on_chat_delete': _on_chat_delete,
            'on_chat_switch_iam': _on_chat_switch_iam,
            'on_chat_edit_message': _on_chat_edit_message,
            'on_chat_delete_message': _on_chat_delete_message,
            'on_chat_regenerate_message': _on_chat_regenerate_message,
            'on_chat_select_variant': _on_chat_select_variant,
            'on_chat_continue_message': _on_chat_continue_message,
            'on_chat_action_stream': _on_chat_action_stream,
            'on_get_last_chat': _on_get_last_chat,
            'on_load_chat': _on_load_chat,
            'on_settings_get': _on_settings_get,
            'on_main_page_get': _on_main_page_get,
            'on_help_me_get': _on_help_me_get,
            'on_settings_update': _on_settings_update,
            'on_settings_reset': _on_settings_reset,
            'on_settings_test': _on_settings_test,
            'on_personas_list': _on_personas_list,
            'on_persona_select': _on_persona_select,
            'on_persona_create': _on_persona_create,
            'on_persona_update': _on_persona_update,
            'on_persona_delete': _on_persona_delete,
            'on_persona_images': _on_persona_images,
            'on_persona_draft': _on_persona_draft,
            'on_modules_list': _on_modules_list,
            'on_module_action': _on_module_action,
            'on_dev_system_info': _on_dev_system_info,
            'on_dev_debug_logs': _on_dev_debug_logs,
            'on_dev_delete_logs': _on_dev_delete_logs,
            'on_dataset_list': _on_dataset_list,
            'on_dataset_action': _on_dataset_action
        }
        
        self._gui_server, self._gui_thread, self._gui_url = start_gui_server(callbacks_dict=callbacks_dict)
        
        webbrowser.open(self._gui_url)

    def _stop_gui(self):
        # Invoke extension shutdown callbacks
        for callback in self._extension_shutdown_callbacks:
            try:
                callback()
            except Exception as e:
                print(f"[MainApp] Extension shutdown callback failed: {e}")
        
        if self._gui_server is None:
            return
        self._gui_server.shutdown()
        self._gui_server.server_close()
        self._gui_server = None
        self._gui_thread = None
        self._gui_url = None
    
    def run(self):
        self._original_print("\nApplication is running. If the webrowser did not open you can manually navigate to the URL provided above.\n")
        if self.debug_manager.is_enabled():
            self.debug_manager.get_debug_logs_folder()
        builtins.print = self.debug_manager.debug_print
        while True:
            time.sleep(1)

if __name__ == "__main__":
    Application()