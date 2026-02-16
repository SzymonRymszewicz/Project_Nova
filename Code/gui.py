from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from http.server import HTTPServer
from pathlib import Path
from variables import *
import threading
import json

GUI_DIR = Path(__file__).resolve().parent.parent / "GUI_Website"
GUI_STYLES_DIR = GUI_DIR / "Styles"
BOTS_DIR = Path(__file__).resolve().parent.parent / "Bots"
PERSONAS_DIR = Path(__file__).resolve().parent.parent / "Personas"
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

		def do_GET(self):  # noqa: N802
			request_path = self.path.split("?", 1)[0]
			# API endpoints for GET requests
			if request_path == "/api/bots":
				if callbacks.get('on_bot_list'):
					result = callbacks['on_bot_list']()
					response_data = json.dumps(result or [])
				else:
					response_data = json.dumps([])
					
				response_bytes = response_data.encode('utf-8')
				self.send_response(HTTPStatus.OK)
				self.send_header('Content-Type', 'application/json')
				self.send_header('Content-Length', str(len(response_bytes)))
				self.end_headers()
				self.wfile.write(response_bytes)
				return
				
			elif request_path == "/api/chats":
				if callbacks.get('on_chat_list'):
					result = callbacks['on_chat_list']()
					response_data = json.dumps(result or [])
				else:
					response_data = json.dumps([])
					
				response_bytes = response_data.encode('utf-8')
				self.send_response(HTTPStatus.OK)
				self.send_header('Content-Type', 'application/json')
				self.send_header('Content-Length', str(len(response_bytes)))
				self.end_headers()
				self.wfile.write(response_bytes)
				return
				
			elif request_path == "/api/personas":
				if callbacks.get('on_personas_list'):
					result = callbacks['on_personas_list']()
					response_data = json.dumps(result or [])
				else:
					response_data = json.dumps([])
					
				response_bytes = response_data.encode('utf-8')
				self.send_response(HTTPStatus.OK)
				self.send_header('Content-Type', 'application/json')
				self.send_header('Content-Length', str(len(response_bytes)))
				self.end_headers()
				self.wfile.write(response_bytes)
				return
			
			elif request_path == "/api/settings":
				if callbacks.get('on_settings_get'):
					result = callbacks['on_settings_get']()
					response_data = json.dumps(result or {})
				else:
					response_data = json.dumps({})
					
				response_bytes = response_data.encode('utf-8')
				self.send_response(HTTPStatus.OK)
				self.send_header('Content-Type', 'application/json')
				self.send_header('Content-Length', str(len(response_bytes)))
				self.end_headers()
				self.wfile.write(response_bytes)
				return
			
			elif request_path == "/api/themes":
				themes = [p.stem for p in GUI_STYLES_DIR.glob("*.css")]
				themes.sort()
				response_data = json.dumps(themes)
				response_bytes = response_data.encode('utf-8')
				self.send_response(HTTPStatus.OK)
				self.send_header('Content-Type', 'application/json')
				self.send_header('Content-Length', str(len(response_bytes)))
				self.end_headers()
				self.wfile.write(response_bytes)
				return

			elif request_path in STATIC_FILES:
				file_name, content_type = STATIC_FILES[request_path]
				self._send_static(GUI_DIR / file_name, content_type)
				return

			elif request_path.startswith("/Bots/"):
				rel_path = request_path.lstrip("/")
				file_path = (BOTS_DIR / rel_path.split("/", 1)[1]).resolve()
				if not str(file_path).startswith(str(BOTS_DIR.resolve())):
					self.send_error(HTTPStatus.NOT_FOUND)
					return
				ext = file_path.suffix
				content_type = MIME_TYPES.get(ext)
				if content_type and file_path.exists():
					self._send_static(file_path, content_type)
					return
				self.send_error(HTTPStatus.NOT_FOUND)
				return

			elif request_path.startswith("/Personas/"):
				rel_path = request_path.lstrip("/")
				file_path = (PERSONAS_DIR / rel_path.split("/", 1)[1]).resolve()
				if not str(file_path).startswith(str(PERSONAS_DIR.resolve())):
					self.send_error(HTTPStatus.NOT_FOUND)
					return
				ext = file_path.suffix
				content_type = MIME_TYPES.get(ext)
				if content_type and file_path.exists():
					self._send_static(file_path, content_type)
					return
				self.send_error(HTTPStatus.NOT_FOUND)
				return

			elif request_path.startswith("/"):
				file_name = request_path.lstrip("/")
				ext = Path(file_name).suffix
				content_type = MIME_TYPES.get(ext)
				if content_type:
					self._send_static(GUI_DIR / file_name, content_type)
					return
				self.send_error(HTTPStatus.NOT_FOUND)
				return

			self.send_error(HTTPStatus.NOT_FOUND)
			return

		def do_POST(self):  # noqa: N802
			if self.path == "/api/message":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length)
				try:
					data = json.loads(body.decode('utf-8'))
					message = data.get('message', '')
					save_response = data.get('save_response', False)
					chat_id = data.get('chat_id')
					bot_name = data.get('bot_name')
					
					if callbacks.get('on_message'):
						response = callbacks['on_message'](message, save_response, chat_id, bot_name)
						if response and not save_response:
							# Only return response if this is a user message, not saving a bot response
							response_data = json.dumps({"response": response})
							response_bytes = response_data.encode('utf-8')
							self.send_response(HTTPStatus.OK)
							self.send_header('Content-Type', 'application/json')
							self.send_header('Content-Length', str(len(response_bytes)))
							self.end_headers()
							self.wfile.write(response_bytes)
							return
						elif save_response:
							# For bot responses, just acknowledge
							response_data = json.dumps({"success": True})
							response_bytes = response_data.encode('utf-8')
							self.send_response(HTTPStatus.OK)
							self.send_header('Content-Type', 'application/json')
							self.send_header('Content-Length', str(len(response_bytes)))
							self.end_headers()
							self.wfile.write(response_bytes)
							return
				except Exception as e:
					print(f"[GUI] Error in /api/message: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/load-chat":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length)
				try:
					data = json.loads(body.decode('utf-8'))
					chat_id = data.get('chat_id')
					bot_name = data.get('bot_name')
					if callbacks.get('on_load_chat'):
						result = callbacks['on_load_chat'](chat_id, bot_name)
						response_data = json.dumps(result or {})
					else:
						response_data = json.dumps({})
						
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/load-chat: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return
			
			elif self.path == "/api/bot/select":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length)
				try:
					data = json.loads(body.decode('utf-8'))
					bot_name = data.get('bot_name')
					if callbacks.get('on_bot_select'):
						result = callbacks['on_bot_select'](bot_name)
						response_data = json.dumps({"success": result is not None, "bot": result})
					else:
						response_data = json.dumps({"success": False})
						
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bot/select: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return
					
			elif self.path == "/api/bots":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length) if content_length > 0 else b''
				try:
					if body:
						data = json.loads(body.decode('utf-8'))
						action = data.get('action', 'list')
						if action == 'create' and callbacks.get('on_bot_create'):
							result = callbacks['on_bot_create'](data.get('name'), data.get('core_data', ''))
							response_data = json.dumps(result or {})
						elif action == 'update' and callbacks.get('on_bot_update'):
							result = callbacks['on_bot_update'](data)
							response_data = json.dumps(result or {})
						elif action == 'delete' and callbacks.get('on_bot_delete'):
							result = callbacks['on_bot_delete'](data.get('name'))
							response_data = json.dumps(result or {})
						else:
							response_data = json.dumps([])
					else:
						if callbacks.get('on_bot_list'):
							result = callbacks['on_bot_list']()
							response_data = json.dumps(result or [])
						else:
							response_data = json.dumps([])
						
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bots: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/bot/iam":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length) if content_length > 0 else b''
				try:
					data = json.loads(body.decode('utf-8')) if body else {}
					action = data.get('action', 'list')
					if callbacks.get('on_bot_iam'):
						result = callbacks['on_bot_iam'](action, data)
						response_data = json.dumps(result or {})
					else:
						response_data = json.dumps({"success": False})

					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bot/iam: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/bot/images":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length) if content_length > 0 else b''
				try:
					data = json.loads(body.decode('utf-8')) if body else {}
					action = data.get('action', 'list')
					if callbacks.get('on_bot_images'):
						result = callbacks['on_bot_images'](action, data)
						response_data = json.dumps(result or {})
					else:
						response_data = json.dumps({"success": False})

					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/bot/images: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return
					
			elif self.path == "/api/chats":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length) if content_length > 0 else b''
				try:
					if body:
						data = json.loads(body.decode('utf-8'))
						action = data.get('action', 'create')
						if action == 'create' and callbacks.get('on_chat_create'):
							result = callbacks['on_chat_create'](data.get('bot_name'), data.get('title'), data.get('persona_name'), data.get('iam_set'))
							response_data = json.dumps(result or {})
						elif action == 'delete' and callbacks.get('on_chat_delete'):
							result = callbacks['on_chat_delete'](data.get('chat_id'))
							response_data = json.dumps(result or {"success": False})
						elif action == 'switch_iam' and callbacks.get('on_chat_switch_iam'):
							result = callbacks['on_chat_switch_iam'](data.get('chat_id'), data.get('bot_name'), data.get('iam_set'), data.get('persona_name'))
							response_data = json.dumps(result or {"success": False})
						else:
							response_data = json.dumps({})
					else:
						if callbacks.get('on_chat_list'):
							result = callbacks['on_chat_list']()
							response_data = json.dumps(result or [])
						else:
							response_data = json.dumps([])
						
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/chats: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return
					
			elif self.path == "/api/last-chat":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length)
				try:
					data = json.loads(body.decode('utf-8'))
					bot_name = data.get('bot_name')
					if callbacks.get('on_get_last_chat'):
						result = callbacks['on_get_last_chat'](bot_name)
						response_data = json.dumps(result or {})
					else:
						response_data = json.dumps({})
						
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/last-chat: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return
					
			elif self.path == "/api/personas":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length) if content_length > 0 else b''
				try:
					if body:
						data = json.loads(body.decode('utf-8'))
						action = data.get('action', 'create')
						if action == 'create' and callbacks.get('on_persona_create'):
							result = callbacks['on_persona_create'](data.get('name'), data.get('description', ''), data.get('cover_art', ''))
							response_data = json.dumps(result or {})
						elif action == 'update' and callbacks.get('on_persona_update'):
							result = callbacks['on_persona_update'](data)
							response_data = json.dumps(result or {})
						else:
							response_data = json.dumps({})
					else:
						if callbacks.get('on_personas_list'):
							result = callbacks['on_personas_list']()
							response_data = json.dumps(result or [])
						else:
							response_data = json.dumps([])
						
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/personas: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/persona/images":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length) if content_length > 0 else b''
				try:
					data = json.loads(body.decode('utf-8')) if body else {}
					action = data.get('action', 'list')
					if callbacks.get('on_persona_images'):
						result = callbacks['on_persona_images'](action, data)
						response_data = json.dumps(result or {})
					else:
						response_data = json.dumps({"success": False})

					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/persona/images: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return
					
			elif self.path == "/api/settings":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length) if content_length > 0 else b''
				try:
					if body:
						data = json.loads(body.decode('utf-8'))
						action = data.get('action', 'update')
						if action == 'update' and callbacks.get('on_settings_update'):
							result = callbacks['on_settings_update'](data.get('settings', {}))
							response_data = json.dumps({"success": result})
						else:
							response_data = json.dumps({"success": False})
					else:
						if callbacks.get('on_settings_get'):
							result = callbacks['on_settings_get']()
							response_data = json.dumps(result or {})
						else:
							response_data = json.dumps({})
						
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
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
						response_data = json.dumps(result or {})
					else:
						response_data = json.dumps({})
						
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/settings/reset: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			elif self.path == "/api/settings/test":
				content_length = int(self.headers.get('Content-Length', 0))
				body = self.rfile.read(content_length) if content_length > 0 else b''
				try:
					settings_payload = {}
					if body:
						data = json.loads(body.decode('utf-8'))
						settings_payload = data.get('settings', {})
					if callbacks.get('on_settings_test'):
						result = callbacks['on_settings_test'](settings_payload)
						response_data = json.dumps(result or {"success": False, "message": "No response"})
					else:
						response_data = json.dumps({"success": False, "message": "Test not available"})
					
					response_bytes = response_data.encode('utf-8')
					self.send_response(HTTPStatus.OK)
					self.send_header('Content-Type', 'application/json')
					self.send_header('Content-Length', str(len(response_bytes)))
					self.end_headers()
					self.wfile.write(response_bytes)
					return
				except Exception as e:
					print(f"[GUI] Error in /api/settings/test: {e}")
					self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
					self.end_headers()
					return

			self.send_error(HTTPStatus.NOT_FOUND)
			return

		def log_message(self, _format, *_args):
			return

	return GuiHandler


def start_gui_server(on_message=None, on_bot_list=None, on_bot_select=None, on_bot_create=None, on_bot_update=None, on_bot_delete=None, on_bot_iam=None, on_bot_images=None,
                     on_chat_list=None, on_chat_create=None, on_chat_delete=None, on_chat_switch_iam=None, on_get_last_chat=None, on_load_chat=None, on_settings_get=None, 
					 on_settings_update=None, on_settings_reset=None, on_settings_test=None, on_personas_list=None, on_persona_select=None, 
					 on_persona_create=None, on_persona_update=None, on_persona_images=None):
	callbacks = {
		'on_message': on_message,
		'on_bot_list': on_bot_list,
		'on_bot_select': on_bot_select,
		'on_bot_create': on_bot_create,
		'on_bot_update': on_bot_update,
		'on_bot_delete': on_bot_delete,
		'on_bot_iam': on_bot_iam,
		'on_bot_images': on_bot_images,
		'on_chat_list': on_chat_list,
		'on_chat_create': on_chat_create,
		'on_chat_delete': on_chat_delete,
		'on_chat_switch_iam': on_chat_switch_iam,
		'on_get_last_chat': on_get_last_chat,
		'on_load_chat': on_load_chat,
		'on_settings_get': on_settings_get,
		'on_settings_update': on_settings_update,
		'on_settings_reset': on_settings_reset,
		'on_settings_test': on_settings_test,
		'on_personas_list': on_personas_list,
		'on_persona_select': on_persona_select,
		'on_persona_create': on_persona_create,
		'on_persona_update': on_persona_update,
		'on_persona_images': on_persona_images
	}
	handler = _build_handler(callbacks)
	server = HTTPServer(("127.0.0.1", LOCALHOST), handler)
	port = server.server_address[1]
	thread = threading.Thread(target=server.serve_forever, daemon=True)
	thread.start()
	return server, thread, f"http://127.0.0.1:{port}/"
