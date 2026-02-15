# Chat Manager: Responsible for managing chat conversations and persistence
# Chats are stored in Bots/{BotName}/Chat{ChatName}/ with IAM/ folder for messages
# Chats folder only holds metadata references for the Chats tab

import os
import json
from pathlib import Path
from datetime import datetime


class ChatManager:
    def __init__(self, bots_folder="../Bots", chats_folder="../Chats"):
        """Initialize the chat manager"""
        self.bots_folder = Path(__file__).parent / bots_folder
        self.chats_folder = Path(__file__).parent / chats_folder
        self.current_chat_id = None
        self.current_chat_messages = []
        self.current_bot_name = None
        self.chats_list_file = self.chats_folder / "list.txt"
        
    def _ensure_chats_folder(self):
        """Ensure the chats metadata folder exists"""
        self.chats_folder.mkdir(parents=True, exist_ok=True)
        
    def _ensure_chat_folder_structure(self, bot_name, chat_name):
        """Create the chat folder structure in Bots/{BotName}/Chat{ChatName}/"""
        chat_folder = self.bots_folder / bot_name / f"Chat{chat_name}"
        chat_folder.mkdir(parents=True, exist_ok=True)
        
        # Create memory folders (ignore current txt files)
        (chat_folder / "IAM").mkdir(exist_ok=True)  # Chat history with timestamps
        (chat_folder / "STM").mkdir(exist_ok=True)  # Short-term memory
        (chat_folder / "MTM").mkdir(exist_ok=True)  # Medium-term memory
        (chat_folder / "LTM").mkdir(exist_ok=True)  # Long-term memory
        
        return chat_folder
        
    def _load_chats_list(self):
        """Load the list of all chats"""
        if not self.chats_list_file.exists():
            return []
            
        try:
            with open(self.chats_list_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if not content:
                    return []
                return json.loads(content)
        except Exception as e:
            print(f"[ChatManager] Error loading chats list: {e}")
            return []
            
    def _save_chats_list(self, chats_list):
        """Save the list of all chats"""
        if not self.chats_folder.exists() and not self.chats_list_file.exists():
            return
        self._ensure_chats_folder()
        try:
            with open(self.chats_list_file, 'w', encoding='utf-8') as f:
                json.dump(chats_list, f, indent=2)
        except Exception as e:
            print(f"[ChatManager] Error saving chats list: {e}")

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
            last_message_time = None
            if iam_folder.exists():
                iam_files = list(iam_folder.glob("*.txt"))
                message_count = len(iam_files)
                if iam_files:
                    last_message_time = max(f.stat().st_mtime for f in iam_files)

            title, timestamp = self._parse_chat_folder_name(chat_dir.name)
            if timestamp is None:
                timestamp = datetime.fromtimestamp(chat_dir.stat().st_mtime).strftime("%Y%m%d_%H%M%S")

            if last_message_time is None:
                last_updated = datetime.fromtimestamp(chat_dir.stat().st_mtime).strftime("%Y%m%d_%H%M%S")
            else:
                last_updated = datetime.fromtimestamp(last_message_time).strftime("%Y%m%d_%H%M%S")

            chats.append({
                "id": chat_dir.name,
                "bot": bot_name,
                "title": title,
                "created": timestamp,
                "last_updated": last_updated,
                "message_count": message_count,
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

        chats.sort(key=lambda x: x.get("last_updated", ""), reverse=True)
        return chats
            
    def create_chat(self, bot_name, title=None):
        """Create a new chat conversation in Bots/{BotName}/Chat{ChatName}/"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
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
            "created": timestamp,
            "last_updated": timestamp,
            "message_count": 0,
            "chat_folder": str(chat_folder)
        }
        
        # Add to chats list metadata if it exists
        if self.chats_list_file.exists():
            chats_list = self._load_chats_list()
            chats_list.append(chat_info)
            self._save_chats_list(chats_list)
        
        iam_messages = self._load_bot_iam_messages(bot_name)
        self.current_chat_id = chat_id
        self.current_chat_messages = iam_messages
        self.current_bot_name = bot_name

        if iam_messages:
            self._save_chat_messages(chat_id, iam_messages, bot_name)
            chat_info["message_count"] = len(iam_messages)
        
        print(f"[ChatManager] Created chat '{chat_id}' at {chat_folder}")
        return chat_info

    def _load_bot_iam_messages(self, bot_name):
        """Load bot-level IAM messages and return as chat messages"""
        if not bot_name:
            return []

        iam_folder = self.bots_folder / bot_name / "IAM"
        if not iam_folder.exists():
            return []

        messages = []
        for iam_file in sorted(iam_folder.glob("*.txt")):
            try:
                content = iam_file.read_text(encoding='utf-8')
            except Exception:
                content = ""
            if content.strip():
                messages.append({
                    "role": "assistant",
                    "content": content,
                    "timestamp": datetime.now().isoformat()
                })
        return messages

    def rename_bot(self, bot_name, new_name):
        """Update bot name references in chat metadata"""
        if not bot_name or not new_name or bot_name == new_name:
            return False

        chats_list = self._load_chats_list()
        changed = False
        for chat in chats_list:
            if chat.get("bot") != bot_name:
                continue
            chat["bot"] = new_name
            folder = chat.get("chat_folder")
            if folder:
                try:
                    folder_path = Path(folder)
                    parts = list(folder_path.parts)
                    for idx, part in enumerate(parts):
                        if part == bot_name:
                            parts[idx] = new_name
                            break
                    chat["chat_folder"] = str(Path(*parts))
                except Exception:
                    pass
            changed = True

        if changed:
            self._save_chats_list(chats_list)

        if self.current_bot_name == bot_name:
            self.current_bot_name = new_name

        return changed
        
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
        if chat_info:
            chat_folder = Path(chat_info.get("chat_folder", ""))
        else:
            bot_folder = self.bots_folder / bot_name
            candidate = bot_folder / chat_id
            if candidate.exists():
                chat_folder = candidate
            else:
                for scanned in self._scan_bot_chats(bot_name):
                    if scanned.get("id") == chat_id:
                        chat_folder = Path(scanned.get("chat_folder", ""))
                        break

        if not chat_folder.exists():
            print(f"[ChatManager] Chat folder '{chat_folder}' not found")
            return None
            
        # Load all IAM.txt files and sort by timestamp
        iam_folder = chat_folder / "IAM"
        messages = []
        
        if iam_folder.exists():
            iam_files = sorted(iam_folder.glob("*.txt"))
            for iam_file in iam_files:
                try:
                    with open(iam_file, 'r', encoding='utf-8') as f:
                        payload = json.load(f)

                    if isinstance(payload, dict) and "role" in payload and "content" in payload:
                        # Legacy single-message format
                        messages.append(payload)
                        continue

                    if isinstance(payload, dict) and ("user" in payload or "assistant" in payload):
                        user_msg = payload.get("user")
                        assistant_msg = payload.get("assistant")
                        if user_msg:
                            messages.append({
                                "role": "user",
                                "content": user_msg.get("content", ""),
                                "timestamp": user_msg.get("timestamp")
                            })
                        if assistant_msg:
                            messages.append({
                                "role": "assistant",
                                "content": assistant_msg.get("content", ""),
                                "timestamp": assistant_msg.get("timestamp")
                            })
                        continue
                except Exception as e:
                    print(f"[ChatManager] Error loading message from {iam_file}: {e}")
        
        self.current_chat_id = chat_id
        self.current_chat_messages = messages
        self.current_bot_name = bot_name
        
        print(f"[ChatManager] Loaded chat '{chat_id}' with {len(messages)} messages")
        return messages
            
    def _get_chat_folder(self, chat_id, bot_name=None):
        """Get the chat folder path from chat metadata or scan results"""
        chats_list = self._load_chats_list()
        for chat in chats_list:
            if chat["id"] == chat_id:
                return Path(chat.get("chat_folder", ""))

        if bot_name:
            candidate = self.bots_folder / bot_name / chat_id
            if candidate.exists():
                return candidate

        for chat in self._scan_all_chats():
            if chat["id"] == chat_id:
                return Path(chat.get("chat_folder", ""))

        return None
    
    def _save_chat_messages(self, chat_id, messages, bot_name=None):
        """Save messages as individual IAM.txt files with timestamps"""
        chat_folder = self._get_chat_folder(chat_id, bot_name)
        if not chat_folder or not chat_folder.exists():
            print(f"[ChatManager] Chat folder for '{chat_id}' not found")
            return
        
        iam_folder = chat_folder / "IAM"
        iam_folder.mkdir(exist_ok=True)
        
        # Delete old message files
        for iam_file in iam_folder.glob("*.txt"):
            try:
                iam_file.unlink()
            except:
                pass
        
        # Save each user + assistant turn as a paired file
        try:
            pairs = []
            pending_user = None

            for message in messages:
                if message.get("role") == "user":
                    if pending_user is not None:
                        pairs.append({"user": pending_user, "assistant": None})
                    pending_user = message
                elif message.get("role") == "assistant":
                    if pending_user is None:
                        pairs.append({"user": None, "assistant": message})
                    else:
                        pairs.append({"user": pending_user, "assistant": message})
                        pending_user = None

            if pending_user is not None:
                pairs.append({"user": pending_user, "assistant": None})

            for idx, pair in enumerate(pairs):
                base = pair.get("user") or pair.get("assistant") or {}
                timestamp = base.get("timestamp", datetime.now().isoformat())
                # Convert ISO format to filename: 2024-01-15T10:30:45.123456 -> 2024_01_15_10_30_45
                timestamp_safe = timestamp.replace(":", "_").replace("-", "_").split(".")[0]
                filename = f"message_{idx:03d}_{timestamp_safe}.txt"

                iam_file = iam_folder / filename
                with open(iam_file, 'w', encoding='utf-8') as f:
                    json.dump(pair, f, indent=2)
            
            print(f"[ChatManager] Saved {len(messages)} messages to IAM/")
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
            "timestamp": datetime.now().isoformat()
        }
        
        # Load chat if not current
        if chat_id != self.current_chat_id:
            self.load_chat(chat_id, bot_name)
            
        self.current_chat_messages.append(message)
        self._save_chat_messages(chat_id, self.current_chat_messages, bot_name)
        
        # Update chat info in list
        if self.chats_list_file.exists():
            chats_list = self._load_chats_list()
            for chat_info in chats_list:
                if chat_info["id"] == chat_id:
                    chat_info["last_updated"] = datetime.now().strftime("%Y%m%d_%H%M%S")
                    chat_info["message_count"] = len(self.current_chat_messages)
                    break
            self._save_chats_list(chats_list)
        
        return True
        
    def get_all_chats(self):
        """Get a list of all chats"""
        chats = self._scan_all_chats()
        if chats:
            return chats
        return self._load_chats_list()
        
    def get_last_chat_for_bot(self, bot_name):
        """Get the most recent chat for a specific bot"""
        bot_chats = self._scan_bot_chats(bot_name)
        if not bot_chats:
            chats = self._load_chats_list()
            bot_chats = [c for c in chats if c["bot"] == bot_name]
        
        if not bot_chats:
            return None
            
        # Sort by last_updated descending to get the most recent
        bot_chats.sort(key=lambda x: x.get("last_updated", ""), reverse=True)
        return bot_chats[0]

    def get_last_chat_any_bot(self):
        """Get the most recent chat from any bot"""
        all_chats = self.get_all_chats()
        if not all_chats:
            return None
        # Sort by last_updated descending to get the most recent
        all_chats.sort(key=lambda x: x.get("last_updated", ""), reverse=True)
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
        chat_folder = self._get_chat_folder(chat_id, self.current_bot_name)
        
        if chat_folder and chat_folder.exists():
            try:
                # Delete the entire chat folder
                import shutil
                shutil.rmtree(chat_folder)
                print(f"[ChatManager] Deleted chat folder: {chat_folder}")
            except Exception as e:
                print(f"[ChatManager] Error deleting chat folder: {e}")
        
        # Remove from chats list metadata
        chats_list = self._load_chats_list()
        chats_list = [c for c in chats_list if c["id"] != chat_id]
        self._save_chats_list(chats_list)
        
        if self.current_chat_id == chat_id:
            self.current_chat_id = None
            self.current_chat_messages = []
            self.current_bot_name = None
            
        print(f"[ChatManager] Deleted chat metadata '{chat_id}'")
        return True
