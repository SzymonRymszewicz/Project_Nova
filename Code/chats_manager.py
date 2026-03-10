class ChatsManager:
	def __init__(self, chat_manager):
		self.chat_manager = chat_manager

	def get_all_chats(self):
		return self.chat_manager.get_all_chats()

	def create_chat(self, bot_name, title=None, persona_name=None, iam_set=None):
		return self.chat_manager.create_chat(bot_name, title, persona_name, iam_set)

	def delete_chat(self, chat_id):
		return self.chat_manager.delete_chat(chat_id)

	def load_chat(self, chat_id, bot_name):
		return self.chat_manager.load_chat(chat_id, bot_name)

	def switch_chat_iam_set(self, chat_id, bot_name, iam_set, persona_name=None):
		return self.chat_manager.switch_chat_iam_set(chat_id, bot_name, iam_set, persona_name)

	def get_last_chat_for_bot(self, bot_name):
		return self.chat_manager.get_last_chat_for_bot(bot_name)

	def get_last_chat_any_bot(self):
		return self.chat_manager.get_last_chat_any_bot()

	def rename_bot(self, bot_name, new_name):
		return self.chat_manager.rename_bot(bot_name, new_name)

	def delete_chats_for_bot(self, bot_name):
		return self.chat_manager.delete_chats_for_bot(bot_name)

	def get_chat_persona(self, chat_id):
		return self.chat_manager.get_chat_persona(chat_id)

	def count_user_messages(self, messages):
		return self.chat_manager.count_user_messages(messages)

	def count_total_messages(self, messages):
		return self.chat_manager.count_total_messages(messages)

	def get_chat_user_message_count(self, chat_id):
		return self.chat_manager.get_chat_user_message_count(chat_id)

	def get_chat_total_message_count(self, chat_id):
		return self.chat_manager.get_chat_total_message_count(chat_id)

	def _resolve_counts(self, chat_id, messages_or_count):
		if isinstance(messages_or_count, list):
			user_count = self.count_user_messages(messages_or_count)
			total_count = self.count_total_messages(messages_or_count)
			return int(user_count), int(total_count)

		user_count = self.get_chat_user_message_count(chat_id)
		total_count = self.get_chat_total_message_count(chat_id)
		return int(user_count), int(total_count)

	def refresh_chat_metadata(self, chat_id, messages_or_count):
		user_count, total_count = self._resolve_counts(chat_id, messages_or_count)

		chats_list = self.chat_manager._load_chats_list()
		for chat_info in chats_list:
			if chat_info.get("id") != chat_id:
				continue

			chat_info["last_updated"] = self.chat_manager._now_compact()
			chat_info["message_count"] = total_count
			chat_info["user_message_count"] = user_count
			chat_info["total_message_count"] = total_count
			break

		self.chat_manager._save_chats_list(chats_list)
