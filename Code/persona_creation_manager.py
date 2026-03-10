import json
import re
from datetime import datetime
from pathlib import Path


class PersonaCreationManager:
	DEFAULT_FIT = {"size": 100, "x": 50, "y": 50}
	DRAFT_FILE_NAME = "persona_creation_draft.json"
	PERSONA_FILE_NAME = "persona.json"
	ERROR_PREFIX = "[PersonaCreationManager]"

	def __init__(self, personas_folder="../Personas"):
		self.personas_folder = Path(__file__).parent / personas_folder

	def _persona_dir(self, persona_id):
		return self.personas_folder / str(persona_id or "")

	def _get_asset_folder(self, persona_id, folder_name):
		asset_folder = self._persona_dir(persona_id) / folder_name
		asset_folder.mkdir(parents=True, exist_ok=True)
		return asset_folder

	def _get_images_folder(self, persona_id):
		return self._get_asset_folder(persona_id, "Images")

	def _get_coverart_folder(self, persona_id):
		return self._get_asset_folder(persona_id, "Coverart")

	def _log_error(self, message, exc):
		print(f"{self.ERROR_PREFIX} {message}: {exc}")

	def _write_json(self, file_path, payload, error_message):
		try:
			with open(file_path, "w", encoding="utf-8") as file:
				json.dump(payload, file, indent=2)
			return True
		except Exception as exc:
			self._log_error(error_message, exc)
			return False

	def _read_json_dict(self, file_path, error_message):
		if not file_path.exists():
			return None
		try:
			with open(file_path, "r", encoding="utf-8") as file:
				payload = json.load(file)
			return payload if isinstance(payload, dict) else None
		except Exception as exc:
			self._log_error(error_message, exc)
			return None

	def _persona_payload(self, persona):
		default_fit = dict(self.DEFAULT_FIT)
		return {
			"id": persona.get("id"),
			"name": persona.get("name"),
			"description": persona.get("description", ""),
			"cover_art": persona.get("cover_art", ""),
			"icon_art": persona.get("icon_art", ""),
			"cover_art_fit": persona.get("cover_art_fit", default_fit),
			"icon_fit": persona.get("icon_fit", dict(self.DEFAULT_FIT)),
			"created": persona.get("created"),
			"is_system": persona.get("is_system", False),
		}

	def _save_persona(self, persona_dir, persona):
		persona_dir.mkdir(parents=True, exist_ok=True)
		payload = self._persona_payload(persona)
		self._write_json(persona_dir / self.PERSONA_FILE_NAME, payload, "Error saving persona")

	def _get_drafts_folder(self):
		drafts_folder = self.personas_folder / "Drafts"
		drafts_folder.mkdir(parents=True, exist_ok=True)
		return drafts_folder

	def _get_persona_creation_draft_file(self):
		return self._get_drafts_folder() / self.DRAFT_FILE_NAME

	def load_persona_creation_draft(self):
		draft_file = self._get_persona_creation_draft_file()
		return self._read_json_dict(draft_file, "Error loading persona creation draft")

	def save_persona_creation_draft(self, draft_payload):
		if not isinstance(draft_payload, dict):
			return False
		draft_file = self._get_persona_creation_draft_file()
		return self._write_json(draft_file, draft_payload, "Error saving persona creation draft")

	def clear_persona_creation_draft(self):
		draft_file = self._get_persona_creation_draft_file()
		if not draft_file.exists():
			return True
		try:
			draft_file.unlink()
			return True
		except Exception as e:
			self._log_error("Error clearing persona creation draft", e)
			return False

	def create_persona(self, name, description="", cover_art=""):
		"""Create a new persona"""
		safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", name or "Persona")
		persona_dir = self._persona_dir(safe_name)
		if persona_dir.exists():
			print(f"{self.ERROR_PREFIX} Persona '{safe_name}' already exists")
			return None

		persona = {
			"id": safe_name,
			"name": name or safe_name,
			"description": description,
			"cover_art": cover_art,
			"icon_art": cover_art,
			"cover_art_fit": dict(self.DEFAULT_FIT),
			"icon_fit": dict(self.DEFAULT_FIT),
			"created": datetime.now().isoformat(),
			"is_system": False
		}

		self._get_images_folder(safe_name)
		self._get_coverart_folder(safe_name)
		self._save_persona(persona_dir, persona)

		print(f"{self.ERROR_PREFIX} Created persona '{name}'")
		return persona
