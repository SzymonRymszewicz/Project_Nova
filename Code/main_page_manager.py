class MainPageManager:
	def __init__(self):
		self._config = {
			"quick_chat_bot_name": "Nova",
			"support_url": "buymeacoffee.com/saimon_szaszakg"
		}

	def get_config(self):
		return dict(self._config)
