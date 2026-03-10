import json
from datetime import datetime
from pathlib import Path


class DebugManager:
	DEBUG_FOLDER_NAME = "Debug"
	SENSITIVE_FIELD_NAMES = {
		"api_key",
		"apikey",
		"authorization",
		"token",
		"password",
		"secret",
	}

	def __init__(self, settings_manager, original_print):
		self.settings_manager = settings_manager
		self._original_print = original_print
		self._debug_session_log_path = None

	def _now_session_file(self):
		return datetime.now().strftime("%Y%m%d_%H%M%S_%f")

	def _now_log_line(self):
		return datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

	def _now_debug_event(self):
		return datetime.now().strftime("%H:%M:%S")

	def is_enabled(self):
		return bool(self.settings_manager.get("debug_mode", False))

	def debug_print(self, *args, **kwargs):
		if self.is_enabled():
			self._original_print(*args, **kwargs)

	def get_debug_logs_folder(self):
		nova_root = Path(__file__).resolve().parent.parent
		debug_folder = nova_root / self.DEBUG_FOLDER_NAME
		try:
			debug_folder.mkdir(parents=True, exist_ok=True)
		except Exception:
			pass
		return debug_folder

	def _get_debug_session_log_path(self):
		if self._debug_session_log_path is not None:
			return self._debug_session_log_path

		folder = self.get_debug_logs_folder()
		timestamp = self._now_session_file()
		self._debug_session_log_path = folder / f"debug_session_{timestamp}.txt"
		return self._debug_session_log_path

	def _write_console_session_log(self, text, tag):
		if not self.is_enabled() or text is None:
			return

		path = self._get_debug_session_log_path()
		try:
			timestamp = self._now_log_line()
			line = f"[{timestamp}] [{str(tag or 'stdout')}] {text}"
			with path.open("a", encoding="utf-8") as file:
				file.write(line)
		except Exception:
			return

	def on_console_output(self, text, tag="stdout"):
		self._write_console_session_log(text, tag)

	def _is_sensitive_field(self, key_name):
		return str(key_name).lower() in self.SENSITIVE_FIELD_NAMES

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
				if self._is_sensitive_field(key):
					safe[key] = self._mask_sensitive(item)
				else:
					safe[key] = self._safe_debug_data(item)
			return safe

		if isinstance(value, list):
			return [self._safe_debug_data(item) for item in value]

		if isinstance(value, tuple):
			return tuple(self._safe_debug_data(item) for item in value)

		return value

	def _format_payload(self, details):
		safe_details = self._safe_debug_data(details)
		if not safe_details:
			return ""
		try:
			return " " + json.dumps(safe_details, ensure_ascii=False)
		except Exception:
			return f" {safe_details}"

	def log_event(self, event, **details):
		if not self.is_enabled():
			return

		timestamp = self._now_debug_event()
		payload = self._format_payload(details)
		self._original_print(f"[DEBUG {timestamp}] {event}{payload}")
