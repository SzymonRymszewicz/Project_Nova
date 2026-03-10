import builtins
import ctypes
import json
import queue
import sys
import threading
import tkinter as tk
from pathlib import Path

try:
	from PIL import Image, ImageChops, ImageDraw, ImageTk
	_HAS_PIL = True
except Exception:
	Image = None
	ImageChops = None
	ImageDraw = None
	ImageTk = None
	_HAS_PIL = False


class RestartRequested(Exception):
	pass


_RESTART_SENTINEL = object()


class ConsoleWindow():
	def __init__(self, title=f"Console"):
		self._theme = {
			"bg": "#0b0f14",
			"panel": "#0f141a",
			"text": "#d7dde6",
			"muted": "#9aa7b2",
			"accent": "#5bd1ff",
			"error": "#ff6b6b",
			"scroll": "#1a232d",
			"scroll_active": "#243140",
			"scroll_trough": "#0f141a",
		}
		self._input_queue = queue.Queue()
		self._history = []
		self._history_index = 0
		self._commands = {
			"help": ("Show available commands.", "help"),
			"clear": ("Clear the console output.", "clear"),
			"exit": ("Exit the console and stop the app.", "exit"),
			"restart": ("Restart the app.", "restart"),
		}
		self._completions = set(self._commands.keys())
		self._closed = False
		self._command_handler = None
		self._input_waiting = False
		self._output_hook = None
		self._set_windows_app_id()

		self.root = tk.Tk()
		self.root.title(title)
		self.root.geometry("980x620")
		self.root.configure(bg=self._theme["bg"])
		self.root.protocol("WM_DELETE_WINDOW", self._on_close)
		self.root.attributes("-alpha", 0.0)
		self._set_window_icon()

		self._font = self._select_font()

		self._text = tk.Text(
			self.root,
			bg=self._theme["bg"],
			fg=self._theme["text"],
			insertbackground=self._theme["text"],
			font=self._font,
			wrap="word",
			state="disabled",
			padx=10,
			pady=10,
			relief="flat",
			highlightthickness=0,
		)
		self._text.tag_configure("stderr", foreground=self._theme["error"])
		self._text.tag_configure("stdin", foreground=self._theme["accent"])

		scrollbar = tk.Scrollbar(
			self.root,
			command=self._text.yview,
			bg=self._theme["scroll"],
			activebackground=self._theme["scroll_active"],
			troughcolor=self._theme["scroll_trough"],
			highlightthickness=0,
			relief="flat",
		)
		self._scrollbar = scrollbar
		self._text.configure(yscrollcommand=self._on_text_scroll)

		input_frame = tk.Frame(self.root, bg=self._theme["panel"])
		self._entry = tk.Entry(
			input_frame,
			bg=self._theme["panel"],
			fg=self._theme["text"],
			insertbackground=self._theme["text"],
			font=self._font,
			relief="flat",
			highlightthickness=1,
			highlightbackground=self._theme["scroll"],
			highlightcolor=self._theme["accent"],
		)

		self._entry.bind("<Return>", self._on_enter)
		self._entry.bind("<Up>", self._on_history_up)
		self._entry.bind("<Down>", self._on_history_down)
		self._entry.bind("<Tab>", self._on_autocomplete)
		self._entry.bind("<Control-l>", self._on_clear)

		self._text.grid(row=0, column=0, sticky="nsew")
		self._scrollbar.grid(row=0, column=1, sticky="ns")
		self._scrollbar.grid_remove()
		input_frame.grid(row=1, column=0, columnspan=2, sticky="ew")
		self._entry.pack(fill="x", padx=10, pady=10)

		self.root.grid_rowconfigure(0, weight=1)
		self.root.grid_columnconfigure(0, weight=1)
		self.root.after(0, self._entry.focus_set)
		self.root.after(0, self._start_fade_in)

	def _set_windows_app_id(self):
		if not sys.platform.startswith("win"):
			return
		try:
			ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("BlueNovaAI.Console")
		except Exception:
			return

	def _set_window_icon(self):
		workspace_root = Path(__file__).resolve().parent.parent
		icon_candidates = []
		icon_fit = None

		config_icon, icon_fit = self._resolve_nova_icon_from_config(workspace_root)
		if config_icon is not None:
			icon_candidates.append(config_icon)

		icon_candidates.extend([
			workspace_root / "Bots" / "Nova" / "Coverart" / "Nova.png",
			workspace_root / "Bots" / "Nova" / "Images" / "Nova_selfie.png",
		])

		for icon_path in icon_candidates:
			if not icon_path.exists() or not icon_path.is_file():
				continue
			try:
				if _HAS_PIL:
					icon_32 = self._build_icon_variant_pil(icon_path, 32, icon_fit)
					icon_16 = self._build_icon_variant_pil(icon_path, 16, icon_fit)
					if icon_16 is not None and icon_32 is not None:
						self.root.iconphoto(True, icon_16, icon_32)
						self._icon_image_16 = icon_16
						self._icon_image_32 = icon_32
						self._icon_source_path = str(icon_path)
						return

				source_image = tk.PhotoImage(file=str(icon_path))
				icon_32 = self._build_icon_variant(source_image, 32, icon_fit)
				icon_16 = self._build_icon_variant(source_image, 16, icon_fit)
				self._apply_round_mask(icon_32)
				self._apply_round_mask(icon_16)
				self.root.iconphoto(True, icon_16, icon_32)
				self._icon_image = source_image
				self._icon_image_16 = icon_16
				self._icon_image_32 = icon_32
				return
			except Exception:
				continue

	def _build_icon_variant_pil(self, icon_path, target_size, fit=None):
		if not _HAS_PIL:
			return None

		target = max(16, int(target_size or 16))
		render_target = max(128, target * 8)
		safe_fit = fit if isinstance(fit, dict) else {}
		fit_size = self._safe_float(safe_fit.get("size"), 100.0)
		fit_x = self._safe_float(safe_fit.get("x"), 50.0)
		fit_y = self._safe_float(safe_fit.get("y"), 50.0)
		fit_size = max(10.0, min(400.0, fit_size))
		fit_x = max(0.0, min(100.0, fit_x))
		fit_y = max(0.0, min(100.0, fit_y))

		source = Image.open(str(icon_path)).convert("RGBA")
		src_w, src_h = source.size
		if src_w <= 0 or src_h <= 0:
			return None

		render_w = max(1, int(round(render_target * (fit_size / 100.0))))
		render_h = max(1, int(round(render_w * (src_h / float(src_w)))))
		resized = source.resize((render_w, render_h), Image.LANCZOS)

		offset_x = int(round((render_target - render_w) * (fit_x / 100.0)))
		offset_y = int(round((render_target - render_h) * (fit_y / 100.0)))

		canvas = Image.new("RGBA", (render_target, render_target), (0, 0, 0, 0))
		canvas.alpha_composite(resized, (offset_x, offset_y))

		mask = Image.new("L", (render_target, render_target), 0)
		draw = ImageDraw.Draw(mask)
		draw.ellipse((0, 0, render_target - 1, render_target - 1), fill=255)
		alpha = canvas.getchannel("A")
		alpha = ImageChops.multiply(alpha, mask)
		canvas.putalpha(alpha)

		final_image = canvas.resize((target, target), Image.LANCZOS)
		return ImageTk.PhotoImage(final_image)

	def _build_icon_variant(self, source_image, target_size, fit=None):
		target = max(16, int(target_size or 16))
		src_w = max(1, int(source_image.width()))
		src_h = max(1, int(source_image.height()))
		safe_fit = fit if isinstance(fit, dict) else {}
		fit_size = self._safe_float(safe_fit.get("size"), 100.0)
		fit_x = self._safe_float(safe_fit.get("x"), 50.0)
		fit_y = self._safe_float(safe_fit.get("y"), 50.0)
		fit_size = max(10.0, min(400.0, fit_size))
		fit_x = max(0.0, min(100.0, fit_x))
		fit_y = max(0.0, min(100.0, fit_y))

		# Match Website buildImageStyle semantics:
		# background-size:{size}% (single value => width%), background-position:{x}% {y}%.
		render_w = target * (fit_size / 100.0)
		render_h = render_w * (src_h / float(src_w))
		offset_x = (target - render_w) * (fit_x / 100.0)
		offset_y = (target - render_h) * (fit_y / 100.0)

		sx0_f = (-offset_x) * (src_w / render_w)
		sy0_f = (-offset_y) * (src_h / render_h)
		sx1_f = (target - offset_x) * (src_w / render_w)
		sy1_f = (target - offset_y) * (src_h / render_h)

		x0 = max(0, min(src_w - 1, int(round(sx0_f))))
		y0 = max(0, min(src_h - 1, int(round(sy0_f))))
		x1 = max(x0 + 1, min(src_w, int(round(sx1_f))))
		y1 = max(y0 + 1, min(src_h, int(round(sy1_f))))

		viewport_w = max(1, x1 - x0)
		viewport_h = max(1, y1 - y0)
		viewport = min(viewport_w, viewport_h)
		x1 = x0 + viewport
		y1 = y0 + viewport

		cropped = tk.PhotoImage()
		cropped.tk.call(
			str(cropped),
			"copy",
			str(source_image),
			"-from",
			x0,
			y0,
			x1,
			y1,
		)

		if viewport > target:
			factor = max(1, viewport // target)
			return cropped.subsample(factor, factor)
		if viewport < target:
			factor = max(1, target // viewport)
			return cropped.zoom(factor, factor)
		return cropped

	def _safe_float(self, value, default):
		try:
			return float(value)
		except Exception:
			return float(default)

	def _apply_round_mask(self, image):
		if image is None or not hasattr(image, "transparency_set"):
			return
		try:
			width = max(1, int(image.width()))
			height = max(1, int(image.height()))
		except Exception:
			return

		cx = (width - 1) / 2.0
		cy = (height - 1) / 2.0
		radius = min(width, height) / 2.0 - 0.5
		radius_sq = radius * radius

		for y in range(height):
			dy = y - cy
			for x in range(width):
				dx = x - cx
				if (dx * dx + dy * dy) <= radius_sq:
					continue
				try:
					image.transparency_set(x, y, True)
				except Exception:
					return

	def _resolve_nova_icon_from_config(self, workspace_root):
		config_path = workspace_root / "Bots" / "Nova" / "config.json"
		if not config_path.exists() or not config_path.is_file():
			return None, None

		try:
			payload = json.loads(config_path.read_text(encoding="utf-8"))
		except Exception:
			return None, None

		if not isinstance(payload, dict):
			return None, None

		fit_payload = payload.get("icon_fit") if isinstance(payload.get("icon_fit"), dict) else None

		for key in ("icon_art", "cover_art"):
			raw = str(payload.get(key) or "").strip()
			if not raw or raw.startswith("data:"):
				continue
			normalized = raw.split("?", 1)[0].replace("\\", "/")
			if normalized.startswith("/"):
				normalized = normalized[1:]
			candidate = (workspace_root / normalized).resolve()
			if candidate.exists() and candidate.is_file():
				return candidate, fit_payload

		return None, fit_payload

	def close(self):
		if self._closed:
			return
		if threading.current_thread() is threading.main_thread():
			self._on_close()
		else:
			self.root.after(0, self._on_close)

	def _start_fade_in(self):
		self._fade_alpha = 0.0
		self._fade_step()

	def _fade_step(self):
		if self._closed:
			return
		self._fade_alpha = min(1.0, self._fade_alpha + 0.06)
		self.root.attributes("-alpha", self._fade_alpha)
		if self._fade_alpha < 1.0:
			self.root.after(16, self._fade_step)

	def _select_font(self):
		for font_name in ("VF-Heavy Data", "Cascadia Mono", "Consolas", "Courier New"):
			try:
				return (font_name, 11)
			except tk.TclError:
				continue
		return ("Courier", 11)

	def _on_close(self):
		self._closed = True
		self._input_queue.put(None)
		self.root.destroy()

	def _append_text(self, text, tag="stdout"):
		self._text.configure(state="normal")
		self._text.insert("end", text, tag)
		self._text.configure(state="disabled")
		self._text.see("end")
		self._on_text_scroll(*self._text.yview())
		if self._output_hook:
			try:
				self._output_hook(text, tag)
			except Exception:
				pass

	def write(self, text):
		if not text or self._closed:
			return
		if threading.current_thread() is threading.main_thread():
			self._append_text(text, "stdout")
		else:
			self.root.after(0, self._append_text, text, "stdout")

	def write_error(self, text):
		if not text or self._closed:
			return
		if threading.current_thread() is threading.main_thread():
			self._append_text(text, "stderr")
		else:
			self.root.after(0, self._append_text, text, "stderr")

	def flush(self):
		return None

	def input(self, prompt=""):
		if prompt:
			self.write(prompt)
		if self._closed:
			raise EOFError()

		self._input_waiting = True
		try:
			user_input = self._input_queue.get()
		finally:
			self._input_waiting = False
		if user_input is _RESTART_SENTINEL:
			raise RestartRequested()
		if user_input is None:
			raise EOFError()
		return user_input

	def set_completions(self, completions):
		self._completions = set(completions)

	def set_command_handler(self, handler):
		self._command_handler = handler

	def set_output_hook(self, hook):
		self._output_hook = hook

	def show_help(self):
		self._show_help()

	def start(self):
		self.root.mainloop()

	def _on_enter(self, _event):
		text = self._entry.get()
		self._entry.delete(0, "end")

		if self._handle_command(text):
			return "break"

		if text:
			self._history.append(text)
			self._history_index = len(self._history)
			self._completions.add(text.split(" ")[0])

		self._append_text(text + "\n", "stdin")
		self._input_queue.put(text)
		return "break"

	def _handle_command(self, text):
		command = text.strip().lower()
		if not command:
			return False
		if command == "exit":
			self._append_text("Exiting console...\n", "stdout")
			self.close()
			return True
		if command == "clear":
			self._on_clear(None)
			return True
		if command == "help":
			self._show_help()
			return True
		if command == "restart":
			self._append_text("Restarting app...\n", "stdout")
			if self._command_handler:
				self._command_handler(command)
				if self._input_waiting:
					self._input_queue.put(_RESTART_SENTINEL)
			return True
		return False

	def _show_help(self):
		self._append_text("\nAvailable commands:\n", "stdout")
		for name, (desc, example) in self._commands.items():
			self._append_text(f"- {name}: {desc} Example: {example}\n", "stdout")

	def _on_text_scroll(self, first, last):
		self._scrollbar.set(first, last)
		if float(first) <= 0.0 and float(last) >= 1.0:
			self._scrollbar.grid_remove()
		else:
			self._scrollbar.grid()

	def _on_history_up(self, _event):
		if not self._history:
			return "break"
		self._history_index = max(0, self._history_index - 1)
		self._replace_entry(self._history[self._history_index])
		return "break"

	def _on_history_down(self, _event):
		if not self._history:
			return "break"
		self._history_index = min(len(self._history), self._history_index + 1)
		if self._history_index == len(self._history):
			self._replace_entry("")
		else:
			self._replace_entry(self._history[self._history_index])
		return "break"

	def _on_autocomplete(self, _event):
		current = self._entry.get()
		prefix, token = self._split_last_token(current)
		if not token:
			return "break"

		matches = sorted([c for c in self._completions if c.startswith(token)])
		if not matches:
			self.root.bell()
			return "break"

		if len(matches) == 1:
			completed = prefix + matches[0]
			self._replace_entry(completed)
			return "break"

		self._append_text("\n" + " ".join(matches) + "\n", "stdout")
		return "break"

	def _on_clear(self, _event):
		self._text.configure(state="normal")
		self._text.delete("1.0", "end")
		self._text.configure(state="disabled")
		return "break"

	def _replace_entry(self, text):
		self._entry.delete(0, "end")
		self._entry.insert(0, text)

	def _split_last_token(self, text):
		if " " not in text:
			return "", text
		prefix, token = text.rsplit(" ", 1)
		return prefix + " ", token


class ConsoleRedirector:
	def __init__(self, console):
		self.console = console

	def write(self, text):
		self.console.write(text)

	def flush(self):
		self.console.flush()


class ConsoleErrorRedirector:
	def __init__(self, console):
		self.console = console

	def write(self, text):
		self.console.write_error(text)

	def flush(self):
		self.console.flush()


def run_with_console(app_factory):
	console = ConsoleWindow()

	original_stdout = sys.stdout
	original_stderr = sys.stderr
	original_input = builtins.input

	sys.stdout = ConsoleRedirector(console)
	sys.stderr = ConsoleErrorRedirector(console)
	builtins.input = console.input

	def _run_app():
		try:
			app_factory()
		except EOFError:
			return
		except Exception as exc:  # noqa: BLE001
			console.write_error(f"\n[error] {exc}\n")

	thread = threading.Thread(target=_run_app, daemon=True)
	thread.start()

	try:
		console.start()
	finally:
		sys.stdout = original_stdout
		sys.stderr = original_stderr
		builtins.input = original_input
