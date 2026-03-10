# Chat Manager: Responsible for managing chat conversations and persistence
# Chats are stored in Bots/{BotName}/Chat{ChatName}/ with IAM/ folder for messages
# Chat metadata stored per-chat in chat_meta.json

import json
import shutil
from pathlib import Path
from datetime import datetime


class ChatManager:
    DEFAULT_IAM_SET = "IAM_1"
    MAX_ASSISTANT_VARIANTS = 6

    def __init__(self, bots_folder="../Bots"):
        """Initialize the chat manager"""
        self.bots_folder = (Path(__file__).parent / bots_folder).resolve()
        self.current_chat_id = None
        self.current_chat_messages = []
        self.current_bot_name = None
        

    def _ensure_chat_folder_structure(self, bot_name, chat_name):
        """Create the chat folder structure in Bots/{BotName}/Chat{ChatName}/"""
        chat_folder = self.bots_folder / bot_name / f"Chat{chat_name}"
        chat_folder.mkdir(parents=True, exist_ok=True)
        
        (chat_folder / "IAM").mkdir(exist_ok=True)  # Chat history with timestamps
        
        return chat_folder

    def _chat_meta_file(self, chat_folder):
        if not chat_folder:
            return None
        return Path(chat_folder) / "chat_meta.json"

    def _read_chat_meta(self, chat_folder):
        meta_file = self._chat_meta_file(chat_folder)
        if not meta_file or not meta_file.exists():
            return {}
        try:
            payload = json.loads(meta_file.read_text(encoding='utf-8').strip() or "{}")
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}

    def _write_chat_meta(self, chat_folder, meta_patch):
        if not chat_folder:
            return False
        chat_folder = Path(chat_folder)
        if not chat_folder.exists() or not chat_folder.is_dir():
            return False
        existing = self._read_chat_meta(chat_folder)
        next_meta = existing.copy()
        for key, value in (meta_patch or {}).items():
            if value is None:
                continue
            next_meta[key] = value
        try:
            meta_file = self._chat_meta_file(chat_folder)
            meta_file.write_text(json.dumps(next_meta, indent=2), encoding='utf-8')
            return True
        except Exception as e:
            print(f"[ChatManager] Error saving chat metadata in '{chat_folder}': {e}")
            return False

    def _now_iso(self):
        return datetime.now().isoformat()

    def _now_stamp(self):
        return datetime.now().strftime("%Y%m%d_%H%M%S")

    def _now_opened_stamp(self):
        return datetime.now().strftime("%Y%m%d_%H%M%S_%f")

    # Backward-compatible aliases kept for existing call sites.
    def _now_compact(self):
        return self._now_stamp()

    def _now_opened(self):
        return self._now_opened_stamp()

    def _touch_chat_meta(self, chat_folder, include_opened=False, persona_name=None):
        patch = {"last_updated": self._now_stamp()}
        if include_opened:
            patch["last_opened"] = self._now_opened_stamp()
        if persona_name is not None:
            patch["persona_name"] = str(persona_name or "User")
        return self._write_chat_meta(chat_folder, patch)
        
    def _load_chats_list(self):
        """Legacy compatibility shim: return chats discovered dynamically from bot folders."""
        return self._scan_all_chats()
            
    def _save_chats_list(self, chats_list):
        """Legacy compatibility shim: persist metadata into each chat folder's chat_meta.json."""
        for chat in (chats_list or []):
            if not isinstance(chat, dict):
                continue
            chat_id = chat.get("id")
            bot_name = chat.get("bot")
            chat_folder = None
            chat_folder_raw = str(chat.get("chat_folder", "") or "").strip()
            if chat_folder_raw:
                candidate = Path(chat_folder_raw)
                if candidate.exists() and candidate.is_dir():
                    chat_folder = candidate
            if chat_folder is None:
                chat_folder = self._get_chat_folder(chat_id, bot_name)
            if not chat_folder:
                continue
            self._write_chat_meta(chat_folder, {
                "title": chat.get("title"),
                "persona_name": chat.get("persona_name"),
                "created": chat.get("created"),
                "last_updated": chat.get("last_updated"),
                "last_opened": chat.get("last_opened")
            })

    def _parse_chat_folder_name(self, folder_name):
        name = folder_name
        if name.startswith("Chat"):
            name = name[len("Chat"):]

        parts = [part for part in name.split("_") if part]
        if len(parts) >= 2 and parts[-2].isdigit() and parts[-1].isdigit():
            timestamp = f"{parts[-2]}_{parts[-1]}"
            title = " ".join(parts[:-2]).strip() or name
            return title, timestamp

        return name or folder_name, None

    def _count_user_messages(self, messages):
        if not isinstance(messages, list):
            return 0
        return sum(1 for msg in messages if isinstance(msg, dict) and msg.get("role") == "user")

    def _count_total_messages(self, messages):
        if not isinstance(messages, list):
            return 0
        return sum(1 for msg in messages if isinstance(msg, dict) and msg.get("role") in ("user", "assistant"))

    def count_user_messages(self, messages):
        return self._count_user_messages(messages)

    def count_total_messages(self, messages):
        return self._count_total_messages(messages)

    def _count_messages_in_iam_files(self, iam_folder):
        if not iam_folder or not iam_folder.exists():
            return {"user": 0, "total": 0}

        user_count = 0
        total_count = 0
        for iam_file in sorted(iam_folder.glob("*.txt")):
            try:
                with open(iam_file, 'r', encoding='utf-8') as f:
                    payload = json.load(f)

                if isinstance(payload, dict) and payload.get("role") in ("user", "assistant"):
                    total_count += 1
                    if payload.get("role") == "user":
                        user_count += 1
                    continue

                if isinstance(payload, dict) and ("user" in payload or "assistant" in payload):
                    if payload.get("user"):
                        user_count += 1
                        total_count += 1
                    if payload.get("assistant"):
                        total_count += 1
            except Exception:
                continue

        return {"user": user_count, "total": total_count}

    def _count_user_messages_in_iam_files(self, iam_folder):
        return self._count_messages_in_iam_files(iam_folder).get("user", 0)

    def get_chat_total_message_count(self, chat_id, bot_name=None):
        if not chat_id:
            return 0

        for chat in self._load_chats_list():
            if chat.get("id") != chat_id:
                continue
            stored = chat.get("total_message_count")
            if isinstance(stored, int):
                return stored
            stored_legacy = chat.get("message_count")
            if isinstance(stored_legacy, int):
                return stored_legacy
            break

        chat_folder = self._get_chat_folder(chat_id, bot_name)
        if not chat_folder:
            return 0
        return self._count_messages_in_iam_files(Path(chat_folder) / "IAM").get("total", 0)

    def get_chat_user_message_count(self, chat_id, bot_name=None):
        if not chat_id:
            return 0

        for chat in self._load_chats_list():
            if chat.get("id") != chat_id:
                continue
            stored = chat.get("user_message_count")
            if isinstance(stored, int):
                return stored
            break

        chat_folder = self._get_chat_folder(chat_id, bot_name)
        if not chat_folder:
            return 0
        return self._count_user_messages_in_iam_files(Path(chat_folder) / "IAM")

    def _scan_bot_chats(self, bot_name):
        bot_dir = self.bots_folder / bot_name
        if not bot_dir.exists():
            return []

        chats = []
        for chat_dir in bot_dir.iterdir():
            if not chat_dir.is_dir() or not chat_dir.name.startswith("Chat"):
                continue

            iam_folder = chat_dir / "IAM"
            message_count = 0
            user_message_count = 0
            last_message_time = None
            if iam_folder.exists():
                iam_files = list(iam_folder.glob("*.txt"))
                counts = self._count_messages_in_iam_files(iam_folder)
                user_message_count = int(counts.get("user", 0))
                message_count = int(counts.get("total", 0))
                if iam_files:
                    last_message_time = max(f.stat().st_mtime for f in iam_files)

            title, timestamp = self._parse_chat_folder_name(chat_dir.name)
            if timestamp is None:
                timestamp = datetime.fromtimestamp(chat_dir.stat().st_mtime).strftime("%Y%m%d_%H%M%S")

            if last_message_time is None:
                last_updated = datetime.fromtimestamp(chat_dir.stat().st_mtime).strftime("%Y%m%d_%H%M%S")
            else:
                last_updated = datetime.fromtimestamp(last_message_time).strftime("%Y%m%d_%H%M%S")

            meta = self._read_chat_meta(chat_dir)
            title = str(meta.get("title") or title)
            created = str(meta.get("created") or timestamp)
            updated = str(meta.get("last_updated") or last_updated)
            last_opened = str(meta.get("last_opened") or updated)
            persona_name = str(meta.get("persona_name") or "User")

            chats.append({
                "id": chat_dir.name,
                "bot": bot_name,
                "title": title,
                "created": created,
                "last_updated": updated,
                "last_opened": last_opened,
                "persona_name": persona_name,
                "message_count": message_count,
                "user_message_count": user_message_count,
                "total_message_count": message_count,
                "chat_folder": str(chat_dir)
            })

        return chats

    def _scan_all_chats(self):
        if not self.bots_folder.exists():
            return []

        chats = []
        for bot_dir in self.bots_folder.iterdir():
            if not bot_dir.is_dir():
                continue
            chats.extend(self._scan_bot_chats(bot_dir.name))

        chats.sort(key=lambda x: x.get("last_opened") or x.get("last_updated", ""), reverse=True)
        return chats
            
    def create_chat(self, bot_name, title=None, persona_name=None, iam_set=None):
        """Create a new chat conversation in Bots/{BotName}/Chat{ChatName}/"""
        timestamp = self._now_compact()
        
        if title is None:
            title = f"Chat {timestamp}"
        
        # Create sanitized chat name from title
        chat_name = title.replace(" ", "_").replace("/", "_")[:50]
        # Create folder structure
        chat_folder = self._ensure_chat_folder_structure(bot_name, f"{chat_name}_{timestamp}")
        chat_id = chat_folder.name
        
        chat_info = {
            "id": chat_id,
            "bot": bot_name,
            "title": title,
            "persona_name": (persona_name or "User"),
            "created": timestamp,
            "last_updated": timestamp,
            "last_opened": self._now_opened(),
            "message_count": 0,
            "user_message_count": 0,
            "total_message_count": 0,
            "chat_folder": str(chat_folder)
        }

        self._write_chat_meta(chat_folder, {
            "title": title,
            "persona_name": (persona_name or "User"),
            "created": timestamp,
            "last_updated": timestamp,
            "last_opened": self._now_opened()
        })
        
        iam_messages = self._load_bot_iam_messages(bot_name, persona_name, iam_set)
        self.current_chat_id = chat_id
        self.current_chat_messages = iam_messages
        self.current_bot_name = bot_name

        if iam_messages:
            self._save_chat_messages(chat_id, iam_messages, bot_name)
            total_count = self._count_total_messages(iam_messages)
            user_count = self._count_user_messages(iam_messages)
            chat_info["message_count"] = total_count
            chat_info["user_message_count"] = user_count
            chat_info["total_message_count"] = total_count
        
        print(f"[ChatManager] Created chat '{chat_id}' at {chat_folder}")
        return chat_info

    def get_chat_info(self, chat_id):
        if not chat_id:
            return None
        for chat in self._load_chats_list():
            if chat.get("id") == chat_id:
                return chat
        return None

    def get_chat_persona(self, chat_id):
        chat_info = self.get_chat_info(chat_id)
        if not chat_info:
            return None
        persona_name = (chat_info.get("persona_name") or "").strip()
        return persona_name or None

    def set_chat_persona(self, chat_id, persona_name):
        if not chat_id:
            return False
        resolved = (persona_name or "").strip() or "User"
        chats_list = self._load_chats_list()
        changed = False
        for chat in chats_list:
            if chat.get("id") != chat_id:
                continue
            if chat.get("persona_name") != resolved:
                chat["persona_name"] = resolved
                changed = True
            break
        if changed:
            self._save_chats_list(chats_list)
        return changed

    def _expand_macros(self, text, bot_name, persona_name=None):
        if text is None:
            return ""
        resolved_persona = (persona_name or "User").strip() or "User"
        resolved_bot = (bot_name or "Bot").strip() or "Bot"
        return (
            str(text)
            .replace("{{user}}", resolved_persona)
            .replace("{{char}}", resolved_bot)
        )

    def _resolve_bot_iam_folder(self, bot_name, iam_set=None):
        if not bot_name:
            return None

        bot_folder = self.bots_folder / bot_name
        iams_root = bot_folder / "IAMs"
        target_set = (iam_set or "").strip()
        if not target_set:
            config_file = bot_folder / "config.json"
            if config_file.exists():
                try:
                    with open(config_file, 'r', encoding='utf-8') as f:
                        config = json.load(f)
                    target_set = (config.get("active_iam_set") or "").strip()
                except Exception:
                    target_set = ""
        if not target_set:
            target_set = self.DEFAULT_IAM_SET

        if iams_root.exists():
            candidate = iams_root / target_set
            if candidate.exists() and candidate.is_dir():
                return candidate

        if iams_root.exists():
            set_dirs = [folder for folder in iams_root.iterdir() if folder.is_dir()]
            if set_dirs:
                return sorted(set_dirs)[0]

        return None

    def _load_bot_iam_messages(self, bot_name, persona_name=None, iam_set=None):
        """Load bot-level IAM messages and return as chat messages"""
        if not bot_name:
            return []

        iam_folder = self._resolve_bot_iam_folder(bot_name, iam_set)
        if iam_folder is None or not iam_folder.exists():
            return []

        messages = []
        for iam_file in sorted(iam_folder.glob("*.txt")):
            try:
                raw = iam_file.read_text(encoding='utf-8')
            except Exception:
                raw = ""

            content = ""
            stripped = str(raw or "").strip()
            if stripped:
                try:
                    payload = json.loads(stripped)
                    if isinstance(payload, dict):
                        content = str(payload.get("content") or "")
                    else:
                        content = str(raw or "")
                except Exception:
                    content = str(raw or "")

            if content.strip():
                messages.append({
                    "role": "assistant",
                    "content": self._expand_macros(content, bot_name, persona_name),
                    "timestamp": self._now_iso()
                })
        return messages

    def rename_bot(self, bot_name, new_name):
        """Update bot name references in memory after bot folder rename."""
        if not bot_name or not new_name or bot_name == new_name:
            return False

        if self.current_bot_name == bot_name:
            self.current_bot_name = new_name

        return True
        
    def load_chat(self, chat_id, bot_name):
        """Load a specific chat by ID from Bots/{BotName}/Chat{ChatName}/IAM/"""
        # Find chat info to get exact folder
        chats_list = self._load_chats_list()
        chat_info = None
        for chat in chats_list:
            if chat["id"] == chat_id:
                chat_info = chat
                break

        chat_folder = None
        preferred_bot = bot_name or (chat_info.get("bot") if chat_info else None)

        # 1) Try metadata-backed resolver first (handles current and scanned metadata)
        resolved = self._get_chat_folder(chat_id, preferred_bot)
        if resolved and resolved.exists() and resolved.is_dir():
            chat_folder = resolved

        # 2) Fallback to stored metadata path only if it is valid and exists
        if chat_folder is None and chat_info:
            stored_folder = str(chat_info.get("chat_folder", "") or "").strip()
            if stored_folder:
                candidate = Path(stored_folder)
                if candidate.exists() and candidate.is_dir():
                    chat_folder = candidate

        # 3) Final fallback to direct bot folder probe + bot chat scan
        if chat_folder is None and preferred_bot:
            bot_folder = self.bots_folder / preferred_bot
            candidate = bot_folder / chat_id
            if candidate.exists() and candidate.is_dir():
                chat_folder = candidate
            else:
                for scanned in self._scan_bot_chats(preferred_bot):
                    if scanned.get("id") == chat_id:
                        scanned_folder = Path(scanned.get("chat_folder", ""))
                        if scanned_folder.exists() and scanned_folder.is_dir():
                            chat_folder = scanned_folder
                            break

        if chat_folder is None or not chat_folder.exists():
            print(f"[ChatManager] Chat folder '{chat_folder}' not found")
            return None
            
        # Load all IAM.txt files and sort by persisted order/timestamp
        iam_folder = chat_folder / "IAM"
        messages = []
        
        if iam_folder.exists():
            iam_files = sorted(iam_folder.glob("*.txt"))
            for iam_file in iam_files:
                try:
                    with open(iam_file, 'r', encoding='utf-8') as f:
                        payload = json.load(f)

                    if isinstance(payload, dict) and "role" in payload and "content" in payload:
                        timestamp = payload.get("timestamp") or self._now_iso()
                        order = payload.get("order")
                        try:
                            order = int(order)
                        except Exception:
                            order = len(messages)

                        loaded_message = {
                            "role": str(payload.get("role", "")).strip().lower(),
                            "content": payload.get("content", ""),
                            "timestamp": timestamp,
                            "__order": order,
                            "__iam_file": iam_file.name
                        }
                        if loaded_message.get("role") == "assistant":
                            loaded_message["variants"] = payload.get("variants")
                            loaded_message["selected_variant_index"] = payload.get("selected_variant_index")
                            self._normalize_assistant_variants(loaded_message)

                        messages.append(loaded_message)
                        continue

                    if isinstance(payload, dict) and ("user" in payload or "assistant" in payload):
                        user_msg = payload.get("user")
                        assistant_msg = payload.get("assistant")
                        if user_msg:
                            messages.append({
                                "role": "user",
                                "content": user_msg.get("content", ""),
                                "timestamp": user_msg.get("timestamp") or self._now_iso(),
                                "__order": len(messages)
                            })
                        if assistant_msg:
                            messages.append({
                                "role": "assistant",
                                "content": assistant_msg.get("content", ""),
                                "timestamp": assistant_msg.get("timestamp") or self._now_iso(),
                                "__order": len(messages)
                            })
                        continue
                except Exception as e:
                    print(f"[ChatManager] Error loading message from {iam_file}: {e}")

        messages.sort(key=lambda msg: (
            int(msg.get("__order", 0)),
            str(msg.get("timestamp") or ""),
            str(msg.get("__iam_file") or "")
        ))
        
        self.current_chat_id = chat_id
        self.current_chat_messages = messages
        self.current_bot_name = preferred_bot

        self._touch_chat_meta(chat_folder, include_opened=True)
        
        print(f"[ChatManager] Loaded chat '{chat_id}' with {len(messages)} messages")
        return self._public_chat_messages(messages)
            
    def _get_chat_folder(self, chat_id, bot_name=None):
        """Get the chat folder path from chat metadata or scan results"""
        chats_list = self._load_chats_list()
        for chat in chats_list:
            if chat["id"] == chat_id:
                if bot_name and chat.get("bot") != bot_name:
                    continue
                stored_folder = str(chat.get("chat_folder", "") or "").strip()
                if stored_folder:
                    candidate = Path(stored_folder)
                    if candidate.exists() and candidate.is_dir():
                        return candidate

        if bot_name:
            candidate = self.bots_folder / bot_name / chat_id
            if candidate.exists():
                return candidate

        for chat in self._scan_all_chats():
            if chat["id"] == chat_id:
                return Path(chat.get("chat_folder", ""))

        return None

    def _public_chat_messages(self, messages):
        public = []
        for message in (messages or []):
            if not isinstance(message, dict):
                continue
            role = str(message.get("role", "")).strip().lower()
            if role not in ("user", "assistant"):
                continue
            public_message = {
                "role": role,
                "content": message.get("content", ""),
                "timestamp": message.get("timestamp")
            }
            if role == "assistant":
                variants = message.get("variants")
                if isinstance(variants, list) and variants:
                    public_variants = []
                    for item in variants:
                        if not isinstance(item, dict):
                            continue
                        variant_content = str(item.get("content", ""))
                        if not variant_content.strip():
                            continue
                        public_variants.append({
                            "content": variant_content,
                            "timestamp": item.get("timestamp")
                        })
                    if public_variants:
                        selected_idx = message.get("selected_variant_index")
                        try:
                            selected_idx = int(selected_idx)
                        except Exception:
                            selected_idx = len(public_variants) - 1
                        selected_idx = max(0, min(selected_idx, len(public_variants) - 1))
                        public_message["variants"] = public_variants
                        public_message["selected_variant_index"] = selected_idx
            public.append(public_message)
        return public

    def _normalize_assistant_variants(self, message):
        if not isinstance(message, dict):
            return
        role = str(message.get("role", "")).strip().lower()
        if role != "assistant":
            message.pop("variants", None)
            message.pop("selected_variant_index", None)
            return

        raw_variants = message.get("variants")
        normalized_variants = []
        if isinstance(raw_variants, list):
            for item in raw_variants:
                if isinstance(item, dict):
                    variant_content = str(item.get("content", ""))
                    variant_timestamp = item.get("timestamp") or message.get("timestamp") or self._now_iso()
                else:
                    variant_content = str(item or "")
                    variant_timestamp = message.get("timestamp") or self._now_iso()
                if not variant_content.strip():
                    continue
                normalized_variants.append({
                    "content": variant_content,
                    "timestamp": variant_timestamp
                })

        if not normalized_variants:
            base_content = str(message.get("content", ""))
            if base_content.strip():
                normalized_variants.append({
                    "content": base_content,
                    "timestamp": message.get("timestamp") or self._now_iso()
                })

        selected_idx = message.get("selected_variant_index")
        try:
            selected_idx = int(selected_idx)
        except Exception:
            selected_idx = len(normalized_variants) - 1 if normalized_variants else 0

        normalized_variants, selected_idx = self._trim_assistant_variants(normalized_variants, selected_idx)

        if normalized_variants:
            selected_idx = max(0, min(selected_idx, len(normalized_variants) - 1))
            message["variants"] = normalized_variants
            message["selected_variant_index"] = selected_idx
            message["content"] = normalized_variants[selected_idx].get("content", "")
        else:
            message.pop("variants", None)
            message.pop("selected_variant_index", None)

    def _trim_assistant_variants(self, variants, selected_idx):
        if not isinstance(variants, list) or not variants:
            return [], 0

        try:
            selected_idx = int(selected_idx)
        except Exception:
            selected_idx = len(variants) - 1

        max_variants = int(getattr(self, "MAX_ASSISTANT_VARIANTS", 0) or 0)
        if max_variants > 0 and len(variants) > max_variants:
            removed = len(variants) - max_variants
            variants = variants[removed:]
            selected_idx -= removed

        selected_idx = max(0, min(selected_idx, len(variants) - 1))
        return variants, selected_idx

    def _safe_timestamp_for_filename(self, timestamp):
        raw = str(timestamp or self._now_iso())
        return raw.replace(":", "_").replace("-", "_").split(".")[0]

    def _next_message_filename(self, iam_folder, timestamp, reserved_names):
        base = f"message_{self._safe_timestamp_for_filename(timestamp)}"
        candidate = f"{base}.txt"
        if candidate not in reserved_names:
            return candidate

        suffix = 1
        while True:
            candidate = f"{base}_{suffix:03d}.txt"
            if candidate not in reserved_names:
                return candidate
            suffix += 1
    
    def _save_chat_messages(self, chat_id, messages, bot_name=None):
        """Save messages as individual IAM.txt files with timestamps"""
        chat_folder = self._get_chat_folder(chat_id, bot_name)
        if not chat_folder or not chat_folder.exists():
            print(f"[ChatManager] Chat folder for '{chat_id}' not found")
            return
        
        iam_folder = chat_folder / "IAM"
        iam_folder.mkdir(exist_ok=True)

        existing_files = {path.name: path for path in iam_folder.glob("*.txt") if path.is_file()}
        reserved_names = set(existing_files.keys())
        kept_names = set()

        # Save each message in its own file (role/content/timestamp/order)
        try:
            for idx, message in enumerate(messages):
                if not isinstance(message, dict):
                    continue

                role = str(message.get("role", "")).strip().lower()
                if role not in ("user", "assistant"):
                    continue

                if role == "assistant":
                    self._normalize_assistant_variants(message)

                timestamp = message.get("timestamp") or self._now_iso()
                message["timestamp"] = timestamp

                existing_name = str(message.get("__iam_file") or "").strip()
                existing_name = Path(existing_name).name if existing_name else ""

                filename = ""
                if existing_name and existing_name not in kept_names:
                    filename = existing_name
                else:
                    filename = self._next_message_filename(iam_folder, timestamp, reserved_names | kept_names)
                    message["__iam_file"] = filename

                kept_names.add(filename)

                iam_file = iam_folder / filename
                with open(iam_file, 'w', encoding='utf-8') as f:
                    payload = {
                        "role": role,
                        "content": message.get("content", ""),
                        "timestamp": timestamp,
                        "order": idx
                    }
                    if role == "assistant":
                        variants = message.get("variants")
                        if isinstance(variants, list) and variants:
                            payload["variants"] = variants
                            payload["selected_variant_index"] = int(message.get("selected_variant_index", len(variants) - 1))
                    json.dump(payload, f, indent=2)

            # Remove stale files that are no longer part of this chat message list
            for old_name, old_file in existing_files.items():
                if old_name in kept_names:
                    continue
                try:
                    old_file.unlink()
                except Exception:
                    pass

            print(
                f"[ChatManager] Saved {len(messages)} messages "
                f"to {iam_folder}"
            )
        except Exception as e:
            print(f"[ChatManager] Error saving messages: {e}")
            
    def add_message(self, role, content, chat_id=None, bot_name=None):
        """Add a message to the current or specified chat"""
        if chat_id is None:
            chat_id = self.current_chat_id
        if bot_name is None:
            bot_name = self.current_bot_name
            
        if chat_id is None or bot_name is None:
            print("[ChatManager] No active chat or bot specified")
            return False
            
        message = {
            "role": role,  # 'user' or 'assistant'
            "content": content,
            "timestamp": self._now_iso()
        }
        if str(role or "").strip().lower() == "assistant":
            message["variants"] = [{
                "content": message["content"],
                "timestamp": message["timestamp"]
            }]
            message["selected_variant_index"] = 0
        
        # Load chat if not current
        if chat_id != self.current_chat_id:
            self.load_chat(chat_id, bot_name)
            
        self.current_chat_messages.append(message)
        self._save_chat_messages(chat_id, self.current_chat_messages, bot_name)
        
        chat_folder = self._get_chat_folder(chat_id, bot_name)
        self._touch_chat_meta(chat_folder)
        
        return True

    def switch_chat_iam_set(self, chat_id, bot_name, iam_set, persona_name=None):
        """Switch initial IAM set for a chat before the first user message."""
        if not chat_id or not bot_name:
            return None

        messages = self.load_chat(chat_id, bot_name)
        if messages is None:
            return None

        if any((msg or {}).get("role") == "user" for msg in messages):
            return None

        iam_messages = self._load_bot_iam_messages(bot_name, persona_name, iam_set)
        self.current_chat_id = chat_id
        self.current_bot_name = bot_name
        self.current_chat_messages = iam_messages
        self._save_chat_messages(chat_id, iam_messages, bot_name)

        chat_folder = self._get_chat_folder(chat_id, bot_name)
        self._touch_chat_meta(chat_folder, persona_name=(persona_name or "User"))

        return self._public_chat_messages(iam_messages)

    def edit_message(self, chat_id, bot_name, message_index, content):
        if not chat_id or not bot_name:
            return None

        try:
            index = int(message_index)
        except Exception:
            return None

        new_content = str(content or "")
        new_content = new_content.replace("\r\n", "\n").replace("\r", "\n")
        if not new_content.strip():
            return None

        if chat_id != self.current_chat_id or bot_name != self.current_bot_name:
            messages = self.load_chat(chat_id, bot_name)
            if messages is None:
                return None

        if index < 0 or index >= len(self.current_chat_messages):
            return None

        message = self.current_chat_messages[index] or {}
        role = message.get("role")
        if role not in ("user", "assistant"):
            return None

        self.current_chat_messages[index]["content"] = new_content
        if role == "assistant":
            self._normalize_assistant_variants(self.current_chat_messages[index])
            variants = self.current_chat_messages[index].get("variants") or []
            selected_idx = self.current_chat_messages[index].get("selected_variant_index", len(variants) - 1 if variants else 0)
            try:
                selected_idx = int(selected_idx)
            except Exception:
                selected_idx = len(variants) - 1 if variants else 0
            if variants:
                selected_idx = max(0, min(selected_idx, len(variants) - 1))
                variants[selected_idx]["content"] = new_content
                variants[selected_idx]["timestamp"] = self.current_chat_messages[index].get("timestamp") or self._now_iso()
                self.current_chat_messages[index]["variants"] = variants
                self.current_chat_messages[index]["selected_variant_index"] = selected_idx
        self._save_chat_messages(chat_id, self.current_chat_messages, bot_name)

        chat_folder = self._get_chat_folder(chat_id, bot_name)
        self._touch_chat_meta(chat_folder)

        return self._public_chat_messages(self.current_chat_messages)

    def delete_message(self, chat_id, bot_name, message_index):
        if not chat_id or not bot_name:
            return None

        try:
            index = int(message_index)
        except Exception:
            return None

        if chat_id != self.current_chat_id or bot_name != self.current_bot_name:
            messages = self.load_chat(chat_id, bot_name)
            if messages is None:
                return None

        if index < 0 or index >= len(self.current_chat_messages):
            return None

        del self.current_chat_messages[index]
        self._save_chat_messages(chat_id, self.current_chat_messages, bot_name)

        chat_folder = self._get_chat_folder(chat_id, bot_name)
        self._touch_chat_meta(chat_folder)

        return self._public_chat_messages(self.current_chat_messages)

    def insert_message(self, chat_id, bot_name, message_index, role, content):
        if not chat_id or not bot_name:
            return None

        try:
            index = int(message_index)
        except Exception:
            return None

        message_role = str(role or "").strip().lower()
        if message_role not in ("user", "assistant"):
            return None

        message_content = str(content or "").strip()
        if not message_content:
            return None

        if chat_id != self.current_chat_id or bot_name != self.current_bot_name:
            messages = self.load_chat(chat_id, bot_name)
            if messages is None:
                return None

        if index < 0:
            index = 0
        if index > len(self.current_chat_messages):
            index = len(self.current_chat_messages)

        self.current_chat_messages.insert(index, {
            "role": message_role,
            "content": message_content,
            "timestamp": self._now_iso()
        })
        if message_role == "assistant":
            inserted = self.current_chat_messages[index]
            inserted["variants"] = [{
                "content": inserted["content"],
                "timestamp": inserted["timestamp"]
            }]
            inserted["selected_variant_index"] = 0
        self._save_chat_messages(chat_id, self.current_chat_messages, bot_name)

        chat_folder = self._get_chat_folder(chat_id, bot_name)
        self._touch_chat_meta(chat_folder)

        return self._public_chat_messages(self.current_chat_messages)

    def add_assistant_variant(self, chat_id, bot_name, message_index, content):
        if not chat_id or not bot_name:
            return None

        try:
            index = int(message_index)
        except Exception:
            return None

        variant_content = str(content or "").replace("\r\n", "\n").replace("\r", "\n")
        if not variant_content.strip():
            return None

        if chat_id != self.current_chat_id or bot_name != self.current_bot_name:
            messages = self.load_chat(chat_id, bot_name)
            if messages is None:
                return None

        if index < 0 or index >= len(self.current_chat_messages):
            return None

        target = self.current_chat_messages[index] or {}
        if str(target.get("role", "")).strip().lower() != "assistant":
            return None

        self._normalize_assistant_variants(target)
        variants = target.get("variants") or []
        now_iso = self._now_iso()
        variants.append({
            "content": variant_content,
            "timestamp": now_iso
        })
        variants, selected_idx = self._trim_assistant_variants(variants, len(variants) - 1)
        target["variants"] = variants
        target["selected_variant_index"] = selected_idx
        target["content"] = str((variants[selected_idx] or {}).get("content", variant_content))
        target["timestamp"] = now_iso

        self._save_chat_messages(chat_id, self.current_chat_messages, bot_name)
        chat_folder = self._get_chat_folder(chat_id, bot_name)
        self._touch_chat_meta(chat_folder)

        return self._public_chat_messages(self.current_chat_messages)

    def select_assistant_variant(self, chat_id, bot_name, message_index, variant_index):
        if not chat_id or not bot_name:
            return None

        try:
            index = int(message_index)
            requested_variant = int(variant_index)
        except Exception:
            return None

        if chat_id != self.current_chat_id or bot_name != self.current_bot_name:
            messages = self.load_chat(chat_id, bot_name)
            if messages is None:
                return None

        if index < 0 or index >= len(self.current_chat_messages):
            return None

        target = self.current_chat_messages[index] or {}
        if str(target.get("role", "")).strip().lower() != "assistant":
            return None

        self._normalize_assistant_variants(target)
        variants = target.get("variants") or []
        if not variants:
            return None

        selected_variant = max(0, min(requested_variant, len(variants) - 1))
        target["selected_variant_index"] = selected_variant
        target["content"] = str((variants[selected_variant] or {}).get("content", ""))

        self._save_chat_messages(chat_id, self.current_chat_messages, bot_name)
        chat_folder = self._get_chat_folder(chat_id, bot_name)
        self._touch_chat_meta(chat_folder)

        return self._public_chat_messages(self.current_chat_messages)
        
    def get_all_chats(self):
        """Get a list of all chats"""
        return self._scan_all_chats()
        
    def get_last_chat_for_bot(self, bot_name):
        """Get the most recent chat for a specific bot"""
        bot_chats = self._scan_bot_chats(bot_name)
        if not bot_chats:
            return None
            
        # Sort by last_opened first, then last_updated
        bot_chats.sort(key=lambda x: x.get("last_opened") or x.get("last_updated", ""), reverse=True)
        return bot_chats[0]

    def get_last_chat_any_bot(self):
        """Get the most recent chat from any bot"""
        all_chats = self.get_all_chats()
        if not all_chats:
            return None
        # Sort by last_opened first, then last_updated
        all_chats.sort(key=lambda x: x.get("last_opened") or x.get("last_updated", ""), reverse=True)
        return all_chats[0]
        
    def load_last_chat_for_bot(self, bot_name):
        """Load the most recent chat for a bot"""
        chat_info = self.get_last_chat_for_bot(bot_name)
        if chat_info:
            return self.load_chat(chat_info["id"], bot_name)
        return None
        
    def get_current_messages(self):
        """Get messages from the current chat"""
        return self.current_chat_messages

    def delete_chat(self, chat_id):
        """Delete a chat (remove folder and metadata)"""
        chat_info = self.get_chat_info(chat_id)
        bot_name = (chat_info or {}).get("bot")
        chat_folder = self._get_chat_folder(chat_id, bot_name)
        
        if chat_folder and chat_folder.exists():
            try:
                # Delete the entire chat folder
                shutil.rmtree(chat_folder)
                print(f"[ChatManager] Deleted chat folder: {chat_folder}")
            except Exception as e:
                print(f"[ChatManager] Error deleting chat folder: {e}")

        if self.current_chat_id == chat_id:
            self.current_chat_id = None
            self.current_chat_messages = []
            self.current_bot_name = None
            
        print(f"[ChatManager] Deleted chat '{chat_id}'")
        return True

    def delete_chats_for_bot(self, bot_name):
        """Remove all chat metadata/state for a deleted bot."""
        if not bot_name:
            return False

        bot_chats = self._scan_bot_chats(bot_name)
        removed_chat_ids = [chat.get("id") for chat in bot_chats if chat.get("id")]
        changed = bool(removed_chat_ids)

        if self.current_bot_name == bot_name:
            self.current_bot_name = None
            self.current_chat_id = None
            self.current_chat_messages = []

        return changed
