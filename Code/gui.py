from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote

import threading
import json
import sys

WEB_PORT = 2137 # Port for the localhost GUI server

GUI_DIR = Path(__file__).resolve().parent.parent / "Website"
GUI_STYLES_DIR = GUI_DIR / "Styles"
BOTS_DIR = Path(__file__).resolve().parent.parent / "Bots"
PERSONAS_DIR = Path(__file__).resolve().parent.parent / "Personas"
MODULES_DIR = Path(__file__).resolve().parent.parent / "Modules"
STATIC_FILES = {
	"/": ("main.html", "text/html; charset=utf-8"),
	"/main.html": ("main.html", "text/html; charset=utf-8"),
}
MIME_TYPES = {
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
}


def _build_handler(callbacks):
	class GuiHandler(BaseHTTPRequestHandler):
		def _send_static(self, file_path, content_type):
			if not file_path.exists():
				self.send_error(HTTPStatus.NOT_FOUND)
				return

			body_bytes = file_path.read_bytes()
			self.send_response(HTTPStatus.OK)
			self.send_header("Content-Type", content_type)
			self.send_header("Content-Length", str(len(body_bytes)))
			self.end_headers()
			self.wfile.write(body_bytes)

		def _send_json(self, payload, status=HTTPStatus.OK):
			response_data = json.dumps(payload)
			response_bytes = response_data.encode("utf-8")
			self.send_response(status)
			self.send_header("Content-Type", "application/json")
			self.send_header("Content-Length", str(len(response_bytes)))
			self.end_headers()
			self.wfile.write(response_bytes)

		def _send_json_error(self, message, status=HTTPStatus.INTERNAL_SERVER_ERROR):
			self._send_json({"success": False, "error": str(message or "Internal server error")}, status)

		def _serve_scoped_static(self, request_path, base_dir):
			rel_path = request_path.lstrip("/")
			parts = rel_path.split("/", 1)
			if len(parts) < 2:
				self.send_error(HTTPStatus.NOT_FOUND)
				return True

			decoded_subpath = unquote(parts[1])
			base_resolved = base_dir.resolve()
			file_path = (base_dir / decoded_subpath).resolve()
			if not str(file_path).startswith(str(base_resolved)):
				self.send_error(HTTPStatus.NOT_FOUND)
				return True

			content_type = MIME_TYPES.get(file_path.suffix)
			if content_type and file_path.exists():
				self._send_static(file_path, content_type)
				return True

			self.send_error(HTTPStatus.NOT_FOUND)
			return True

		def _serve_auto_summary_status_fallback(self, request_path):
			prefix = "/Modules/Auto%20Summary/runtime/"
			if not request_path.startswith(prefix):
				return False

			file_name = request_path.split("/")[-1]
			if not (file_name.startswith("auto_summary_status_") and file_name.endswith(".json")):
				return False

			decoded_subpath = unquote(request_path.lstrip("/").split("/", 1)[1])
			base_resolved = MODULES_DIR.resolve()
			file_path = (MODULES_DIR / decoded_subpath).resolve()
			if not str(file_path).startswith(str(base_resolved)):
				self.send_error(HTTPStatus.NOT_FOUND)
				return True

			if file_path.exists() and file_path.is_file():
				self._send_static(file_path, "application/json")
				return True

			stem = file_name[len("auto_summary_status_"):-len(".json")]
			safe_bot = ""
			safe_chat = ""
			if "_" in stem:
				safe_bot, safe_chat = stem.split("_", 1)

			engine = sys.modules.get("auto_summary_engine_runtime")
			if engine is not None:
				reader = getattr(engine, "get_runtime_status_by_safe_names", None)
				if callable(reader):
					try:
						payload = reader(safe_bot, safe_chat)
						if isinstance(payload, dict):
							self._send_json(payload, status=HTTPStatus.OK)
							return True
					except Exception:
						pass

			self._send_json({"phase3_active": False, "message": "", "updated_at": ""}, status=HTTPStatus.OK)
			return True

		def _read_json_body(self):
			content_length = int(self.headers.get("Content-Length", 0))
			if content_length <= 0:
				return {}
			body = self.rfile.read(content_length)
			if not body:
				return {}
			return json.loads(body.decode("utf-8"))

		def do_GET(self):  
			parsed_url = urlparse(self.path)
			request_path = parsed_url.path
			query_params = parse_qs(parsed_url.query)

			if request_path == "/api/bots":
				result = callbacks["on_bot_list"]() if callbacks.get("on_bot_list") else []
				self._send_json(result or [])
				return

			if request_path == "/api/chats":
				result = callbacks["on_chat_list"]() if callbacks.get("on_chat_list") else []
				self._send_json(result or [])
				return

			if request_path == "/api/personas":
				result = callbacks["on_personas_list"]() if callbacks.get("on_personas_list") else []
				self._send_json(result or [])
				return

			if request_path == "/api/settings":
				result = callbacks["on_settings_get"]() if callbacks.get("on_settings_get") else {}
				self._send_json(result or {})
				return

			if request_path == "/api/main-page":
				result = callbacks["on_main_page_get"]() if callbacks.get("on_main_page_get") else {}
				self._send_json(result or {})
				return

			if request_path == "/api/help-me":
				result = callbacks["on_help_me_get"]() if callbacks.get("on_help_me_get") else {}
				self._send_json(result or {})
				return

			if request_path == "/api/bot/images":
				bot_name = (query_params.get("bot_name") or [None])[0]
				if callbacks.get("on_bot_images"):
					result = callbacks["on_bot_images"]("list", {"bot_name": bot_name})
					self._send_json(result or {"items": []})
				else:
					self._send_json({"items": []})
				return

			if request_path == "/api/themes":
				themes = [p.stem for p in GUI_STYLES_DIR.glob("*.css")]
				themes.sort()
				self._send_json(themes)
				return

			if request_path == "/api/modules":
				result = callbacks["on_modules_list"]() if callbacks.get("on_modules_list") else []
				self._send_json(result or [])
				return

			if request_path == "/api/datasets":
				bot_name = (query_params.get("bot_name") or [None])[0]
				if callbacks.get("on_dataset_list"):
					result = callbacks["on_dataset_list"](bot_name)
					self._send_json(result or {"success": True, "datasets": []})
				else:
					self._send_json({"success": True, "datasets": []})
				return

			if request_path == "/api/dev/system-info":
				result = callbacks["on_dev_system_info"]() if callbacks.get("on_dev_system_info") else {}
				self._send_json(result or {})
				return

			if request_path == "/api/dev/debug-logs":
				result = callbacks["on_dev_debug_logs"]() if callbacks.get("on_dev_debug_logs") else {}
				self._send_json(result or {})
				return

			if request_path in STATIC_FILES:
				file_name, content_type = STATIC_FILES[request_path]
				self._send_static(GUI_DIR / file_name, content_type)
				return

			if request_path.startswith("/Bots/"):
				self._serve_scoped_static(request_path, BOTS_DIR)
				return

			if request_path.startswith("/Personas/"):
				self._serve_scoped_static(request_path, PERSONAS_DIR)
				return

			if request_path.startswith("/Modules/"):
				if self._serve_auto_summary_status_fallback(request_path):
					return
				self._serve_scoped_static(request_path, MODULES_DIR)
				return

			if request_path.startswith("/"):
				file_name = request_path.lstrip("/")
				content_type = MIME_TYPES.get(Path(file_name).suffix)
				if content_type:
					self._send_static(GUI_DIR / file_name, content_type)
					return
				self.send_error(HTTPStatus.NOT_FOUND)
				return

			self.send_error(HTTPStatus.NOT_FOUND)
			return

		def do_POST(self):  # noqa: N802
			if self.path == "/api/message":
				try:
					data = self._read_json_body()
					message = data.get('message', '')
					save_response = data.get('save_response', False)
					chat_id = data.get('chat_id')
					bot_name = data.get('bot_name')
					persona_id = data.get('persona_id')
					persona_name = data.get('persona_name')
					
					if callbacks.get('on_message'):
						response = callbacks['on_message'](message, save_response, chat_id, bot_name, persona_id, persona_name)
						if not save_response:
							# Only return response payload if this is a user message
							if isinstance(response, dict):
								response_payload = response
							else:
								response_payload = {"response": response or ""}
							self._send_json(response_payload)
							return
						elif save_response:
							# For bot responses, just acknowledge
							if isinstance(response, dict):
								response_payload = {"success": True, **response}
							else:
								response_payload = {"success": True}
							self._send_json(response_payload)
							return
				except Exception as e:
					print(f"[GUI] Error in /api/message: {e}")
					self._send_json_error(e)
					return

			elif self.path == "/api/message-stream":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length)
				try:
					data = json.loads(body.decode('utf-8'))
					message = data.get('message', '')
					chat_id = data.get('chat_id')
					bot_name = data.get('bot_name')
					persona_id = data.get('persona_id')
					persona_name = data.get('persona_name')

					if not callbacks.get('on_message_stream'):
						self.send_response(HTTPStatus.NOT_IMPLEMENTED)
						self.send_header('Content-Type', 'application/json')
						error_payload = json.dumps({"success": False, "error": "Streaming callback not available"}).encode('utf-8')
						self.send_header('Content-Length', str(len(error_payload)))
						self.end_headers()
						self.wfile.write(error_payload)
						return

					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
					self.send_header('Cache-Control', 'no-cache')
					self.send_header('Connection', 'keep-alive')
					self.end_headers()

					event_iter = callbacks['on_message_stream'](message, chat_id, bot_name, persona_id, persona_name)
					for event in event_iter or []:
						payload = event if isinstance(event, dict) else {"type": "chunk", "text": str(event or "")}
						line = (json.dumps(payload, ensure_ascii=False) + "\n").encode('utf-8')
						self.wfile.write(line)
						self.wfile.flush()
					return
				except Exception as e:
					print(f"[GUI] Error in /api/message-stream: {e}")
					try:
						error_event = (json.dumps({"type": "error", "error": str(e)}, ensure_ascii=False) + "\n").encode('utf-8')
						self.wfile.write(error_event)
						self.wfile.flush()
					except Exception:
						self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
						self.end_headers()
					return

			elif self.path == "/api/chat-action-stream":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length)
				try:
					data = json.loads(body.decode('utf-8'))

					if not callbacks.get('on_chat_action_stream'):
						self.send_response(HTTPStatus.NOT_IMPLEMENTED)
						self.send_header('Content-Type', 'application/json')
						error_payload = json.dumps({"success": False, "error": "Chat action streaming callback not available"}).encode('utf-8')
						self.send_header('Content-Length', str(len(error_payload)))
						self.end_headers()
						self.wfile.write(error_payload)
						return

					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
					self.send_header('Cache-Control', 'no-cache')
					self.send_header('Connection', 'keep-alive')
					self.end_headers()

					event_iter = callbacks['on_chat_action_stream'](data)
					for event in event_iter or []:
						payload = event if isinstance(event, dict) else {"type": "chunk", "text": str(event or "")}
						line = (json.dumps(payload, ensure_ascii=False) + "\n").encode('utf-8')
						self.wfile.write(line)
						self.wfile.flush()
					return
				except Exception as e:
					print(f"[GUI] Error in /api/chat-action-stream: {e}")
					try:
						error_event = (json.dumps({"type": "error", "error": str(e)}, ensure_ascii=False) + "\n").encode('utf-8')
						self.wfile.write(error_event)
						self.wfile.flush()
					except Exception:
						self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
						self.end_headers()
					return

			elif self.path == "/api/stop-generation":
				try:
					data = self._read_json_body()
					if callbacks.get('on_stop_generation'):
						result = callbacks['on_stop_generation'](data)
						payload = result or {"success": True}
					else:
						payload = {"success": False}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/stop-generation: {e}")
					self._send_json_error(e)
					return

			elif self.path == "/api/debug-event":
				try:
					data = self._read_json_body()
					if callbacks.get('on_debug_event'):
						result = callbacks['on_debug_event'](data)
						payload = result or {"success": True}
					else:
						payload = {"success": True}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/debug-event: {e}")
					self._send_json_error(e)
					return

			elif self.path == "/api/bot/select":
				try:
					data = self._read_json_body()
					bot_name = data.get('bot_name')
					if callbacks.get('on_bot_select'):
						result = callbacks['on_bot_select'](bot_name)
						payload = {"success": result is not None, "bot": result}
					else:
						payload = {"success": False}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bot/select: {e}")
					self._send_json_error(e)
					return
					
			elif self.path == "/api/bots":
				try:
					data = self._read_json_body()
					if data:
						action = data.get('action', 'list')
						if action == 'create' and callbacks.get('on_bot_create'):
							result = callbacks['on_bot_create'](data.get('name'), data.get('core_data', ''))
							payload = result or {}
						elif action == 'update' and callbacks.get('on_bot_update'):
							result = callbacks['on_bot_update'](data)
							payload = result or {}
						elif action == 'delete' and callbacks.get('on_bot_delete'):
							result = callbacks['on_bot_delete'](data.get('name'))
							payload = result or {}
						else:
							payload = []
					else:
						if callbacks.get('on_bot_list'):
							result = callbacks['on_bot_list']()
							payload = result or []
						else:
							payload = []

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bots: {e}")
					self._send_json_error(e)
					return

			elif self.path == "/api/bot/iam":
				try:
					data = self._read_json_body()
					action = data.get('action', 'list')
					if callbacks.get('on_bot_iam'):
						result = callbacks['on_bot_iam'](action, data)
						payload = result or {}
					else:
						payload = {"success": False}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bot/iam: {e}")
					self._send_json_error(e)
					return

			elif self.path == "/api/bot/images":
				try:
					data = self._read_json_body()
					action = data.get('action', 'list')
					if callbacks.get('on_bot_images'):
						result = callbacks['on_bot_images'](action, data)
						payload = result or {}
					else:
						payload = {"success": False}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bot/images: {e}")
					self._send_json_error(e)
					return

			elif self.path == "/api/bot/draft":
				try:
					data = self._read_json_body()
					action = data.get('action', 'load')
					if callbacks.get('on_bot_draft'):
						result = callbacks['on_bot_draft'](action, data)
						payload = result or {"success": False}
					else:
						payload = {"success": False, "message": "Draft API not available"}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bot/draft: {e}")
					self._send_json_error(e)
					return
					
			elif self.path == "/api/chats":
				try:
					data = self._read_json_body()
					if data:
						action = data.get('action', 'create')
						if action == 'create' and callbacks.get('on_chat_create'):
							result = callbacks['on_chat_create'](data.get('bot_name'), data.get('title'), data.get('persona_name'), data.get('iam_set'))
							payload = result or {}
						elif action == 'delete' and callbacks.get('on_chat_delete'):
							result = callbacks['on_chat_delete'](data.get('chat_id'))
							payload = result or {"success": False}
						elif action == 'switch_iam' and callbacks.get('on_chat_switch_iam'):
							result = callbacks['on_chat_switch_iam'](data.get('chat_id'), data.get('bot_name'), data.get('iam_set'), data.get('persona_name'))
							payload = result or {"success": False}
						elif action == 'edit_message' and callbacks.get('on_chat_edit_message'):
							result = callbacks['on_chat_edit_message'](
								data.get('chat_id'),
								data.get('bot_name'),
								data.get('message_index'),
								data.get('content'),
								data.get('client_message_count')
							)
							payload = result or {"success": False}
						elif action == 'delete_message' and callbacks.get('on_chat_delete_message'):
							result = callbacks['on_chat_delete_message'](
								data.get('chat_id'),
								data.get('bot_name'),
								data.get('message_index'),
								data.get('client_message_count')
							)
							payload = result or {"success": False}
						elif action == 'regenerate_message' and callbacks.get('on_chat_regenerate_message'):
							result = callbacks['on_chat_regenerate_message'](
								data.get('chat_id'),
								data.get('bot_name'),
								data.get('message_index'),
								data.get('client_message_count'),
								data.get('persona_id'),
								data.get('persona_name')
							)
							payload = result or {"success": False}
						elif action == 'select_variant' and callbacks.get('on_chat_select_variant'):
							result = callbacks['on_chat_select_variant'](
								data.get('chat_id'),
								data.get('bot_name'),
								data.get('message_index'),
								data.get('variant_index'),
								data.get('client_message_count')
							)
							payload = result or {"success": False}
						elif action == 'continue_message' and callbacks.get('on_chat_continue_message'):
							result = callbacks['on_chat_continue_message'](
								data.get('chat_id'),
								data.get('bot_name'),
								data.get('message_index'),
								data.get('client_message_count'),
								data.get('persona_id'),
								data.get('persona_name')
							)
							payload = result or {"success": False}
						else:
							payload = {}
					else:
						if callbacks.get('on_chat_list'):
							result = callbacks['on_chat_list']()
							payload = result or []
						else:
							payload = []

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/chats: {e}")
					self._send_json_error(e)
					return
					
			elif self.path == "/api/last-chat":
				try:
					data = self._read_json_body()
					bot_name = data.get('bot_name')
					if callbacks.get('on_get_last_chat'):
						result = callbacks['on_get_last_chat'](bot_name)
						payload = result or {}
					else:
						payload = {}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/last-chat: {e}")
					self._send_json_error(e)
					return

			elif self.path == "/api/load-chat":
				try:
					data = self._read_json_body()
					chat_id = data.get('chat_id')
					bot_name = data.get('bot_name')
					if callbacks.get('on_load_chat'):
						result = callbacks['on_load_chat'](chat_id, bot_name)
						payload = result or {"messages": []}
					else:
						payload = {"messages": []}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/load-chat: {e}")
					self._send_json_error(e)
					return
					
			elif self.path == "/api/personas":
				try:
					data = self._read_json_body()
					if data:
						action = data.get('action', 'create')
						if action == 'create' and callbacks.get('on_persona_create'):
							result = callbacks['on_persona_create'](data.get('name'), data.get('description', ''), data.get('cover_art', ''))
							payload = result or {}
						elif action == 'update' and callbacks.get('on_persona_update'):
							result = callbacks['on_persona_update'](data)
							payload = result or {}
						elif action == 'delete' and callbacks.get('on_persona_delete'):
							result = callbacks['on_persona_delete'](data.get('persona_id') or data.get('id'))
							payload = result or {"success": False}
						else:
							payload = {}
					else:
						if callbacks.get('on_personas_list'):
							result = callbacks['on_personas_list']()
							payload = result or []
						else:
							payload = []

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/personas: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/persona/images":
				try:
					data = self._read_json_body()
					action = data.get('action', 'list')
					if callbacks.get('on_persona_images'):
						result = callbacks['on_persona_images'](action, data)
						payload = result or {}
					else:
						payload = {"success": False}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/persona/images: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/persona/draft":
				try:
					data = self._read_json_body()
					action = data.get('action', 'load')
					if callbacks.get('on_persona_draft'):
						result = callbacks['on_persona_draft'](action, data)
						payload = result or {"success": False}
					else:
						payload = {"success": False, "message": "Persona draft API not available"}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/persona/draft: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return
					
			elif self.path == "/api/settings":
				try:
					data = self._read_json_body()
					if data:
						action = data.get('action', 'update')
						if action == 'update' and callbacks.get('on_settings_update'):
							result = callbacks['on_settings_update'](data.get('settings', {}))
							payload = {"success": result}
						else:
							payload = {"success": False}
					else:
						if callbacks.get('on_settings_get'):
							result = callbacks['on_settings_get']()
							payload = result or {}
						else:
							payload = {}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/settings: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return
			
			elif self.path == "/api/settings/reset":
				try:
					if callbacks.get('on_settings_reset'):
						result = callbacks['on_settings_reset']()
						payload = result or {}
					else:
						payload = {}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/settings/reset: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/settings/test":
				try:
					data = self._read_json_body()
					settings_payload = data.get('settings', {}) if data else {}
					if callbacks.get('on_settings_test'):
						result = callbacks['on_settings_test'](settings_payload)
						payload = result or {"success": False, "message": "No response"}
					else:
						payload = {"success": False, "message": "Test not available"}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/settings/test: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/dev/system-info":
				try:
					if callbacks.get('on_dev_system_info'):
						result = callbacks['on_dev_system_info']()
						payload = result or {}
					else:
						payload = {}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/dev/system-info: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/dev/debug-logs":
				try:
					if callbacks.get('on_dev_debug_logs'):
						result = callbacks['on_dev_debug_logs']()
						payload = result or {}
					else:
						payload = {}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/dev/debug-logs: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/dev/delete-debug-logs":
				try:
					data = self._read_json_body()
					if callbacks.get('on_dev_delete_logs'):
						result = callbacks['on_dev_delete_logs'](data)
						payload = result or {"success": False}
					else:
						payload = {"success": False}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/dev/delete-debug-logs: {e}")
					self._send_json({"success": False, "error": str(e)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
					return

			elif self.path == "/api/module-action":
				try:
					data = self._read_json_body()
					if callbacks.get('on_module_action'):
						result = callbacks['on_module_action'](data)
						payload = result or {"success": False}
					else:
						payload = {"success": False, "message": "Module action API not available"}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/module-action: {e}")
					self._send_json({"success": False, "error": str(e)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
					return

			elif self.path == "/api/datasets":
				try:
					data = self._read_json_body()
					action = data.get('action', 'list') if isinstance(data, dict) else 'list'
					if callbacks.get('on_dataset_action'):
						result = callbacks['on_dataset_action'](action, data)
						payload = result or {"success": False}
					else:
						payload = {"success": False, "message": "Dataset API not available"}

					self._send_json(payload)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/datasets: {e}")
					self._send_json({"success": False, "error": str(e)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
					return

			self.send_error(HTTPStatus.NOT_FOUND)
			return

		def log_message(self, _format, *_args):
			return

	return GuiHandler


def start_gui_server(on_message=None, on_message_stream=None, on_chat_action_stream=None, on_bot_list=None, on_bot_select=None, on_bot_create=None, on_bot_update=None, on_bot_delete=None, on_bot_iam=None, on_bot_images=None, on_bot_draft=None,
                     on_chat_list=None, on_chat_create=None, on_chat_delete=None, on_chat_switch_iam=None, on_chat_edit_message=None, on_chat_delete_message=None,
					 on_chat_regenerate_message=None, on_chat_select_variant=None, on_chat_continue_message=None, on_get_last_chat=None, on_load_chat=None, on_settings_get=None,
					 on_main_page_get=None,
					 on_settings_update=None, on_settings_reset=None, on_settings_test=None, on_personas_list=None, on_persona_select=None,
					 on_persona_create=None, on_persona_update=None, on_persona_delete=None, on_persona_images=None, on_persona_draft=None, on_modules_list=None,
					 on_module_action=None,
					 on_stop_generation=None, on_debug_event=None, on_dev_system_info=None,
					 on_dev_debug_logs=None, on_dev_delete_logs=None, callbacks_dict=None):
	# Support both parameter-based and dict-based callback injection
	# If callbacks_dict is provided, use it; otherwise build from parameters
	if callbacks_dict is None:
		callbacks = {
			'on_message': on_message,
			'on_message_stream': on_message_stream,
			'on_chat_action_stream': on_chat_action_stream,
			'on_stop_generation': on_stop_generation,
			'on_debug_event': on_debug_event,
			'on_bot_list': on_bot_list,
			'on_bot_select': on_bot_select,
			'on_bot_create': on_bot_create,
			'on_bot_update': on_bot_update,
			'on_bot_delete': on_bot_delete,
			'on_bot_iam': on_bot_iam,
			'on_bot_images': on_bot_images,
			'on_bot_draft': on_bot_draft,
			'on_chat_list': on_chat_list,
			'on_chat_create': on_chat_create,
			'on_chat_delete': on_chat_delete,
			'on_chat_switch_iam': on_chat_switch_iam,
			'on_chat_edit_message': on_chat_edit_message,
			'on_chat_delete_message': on_chat_delete_message,
			'on_chat_regenerate_message': on_chat_regenerate_message,
			'on_chat_select_variant': on_chat_select_variant,
			'on_chat_continue_message': on_chat_continue_message,
			'on_get_last_chat': on_get_last_chat,
			'on_load_chat': on_load_chat,
			'on_settings_get': on_settings_get,
			'on_main_page_get': on_main_page_get,
			'on_settings_update': on_settings_update,
			'on_settings_reset': on_settings_reset,
			'on_settings_test': on_settings_test,
			'on_personas_list': on_personas_list,
			'on_persona_select': on_persona_select,
			'on_persona_create': on_persona_create,
			'on_persona_update': on_persona_update,
			'on_persona_delete': on_persona_delete,
			'on_persona_images': on_persona_images,
			'on_persona_draft': on_persona_draft,
			'on_modules_list': on_modules_list,
			'on_module_action': on_module_action,
			'on_dev_system_info': on_dev_system_info,
			'on_dev_debug_logs': on_dev_debug_logs,
			'on_dev_delete_logs': on_dev_delete_logs,
			'on_dataset_list': None,
			'on_dataset_action': None
		}
	else:
		callbacks = callbacks_dict
	handler = _build_handler(callbacks)
	server = ThreadingHTTPServer(("127.0.0.1", WEB_PORT), handler)
	port = server.server_address[1]
	thread = threading.Thread(target=server.serve_forever, daemon=True)
	thread.start()
	print(f"Server started running on http://127.0.0.1:{port}")
	return server, thread, f"http://127.0.0.1:{port}/"
