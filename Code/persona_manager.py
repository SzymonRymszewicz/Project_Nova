# Persona Manager: Responsible for managing user personas

import base64
import json
import re
import shutil
from pathlib import Path
from datetime import datetime


class PersonaManager:
    def __init__(self, personas_folder="../Personas"):
        """Initialize the persona manager with the path to the Personas folder"""
        self.personas_folder = Path(__file__).parent / personas_folder
        self.current_persona = None

    def _iter_persona_dirs(self):
        if not self.personas_folder.exists():
            return []
        return [
            p for p in sorted(self.personas_folder.iterdir())
            if p.is_dir() and p.name != "__pycache__" and not p.name.startswith(".")
        ]

    def _load_persona_from_dir(self, persona_dir):
        data = {}
        json_file = persona_dir / "persona.json"
        if json_file.exists():
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    loaded = json.load(f)
                if isinstance(loaded, list) and loaded:
                    data = loaded[0]
                elif isinstance(loaded, dict):
                    data = loaded
            except Exception as e:
                print(f"[PersonaManager] Error reading persona.json: {e}")
        else:
            txt_files = sorted(persona_dir.glob("*.txt"))
            preferred = None
            for candidate in txt_files:
                if candidate.stem.lower() == persona_dir.name.lower():
                    preferred = candidate
                    break
            if preferred is None and txt_files:
                preferred = txt_files[0]
            if preferred:
                try:
                    content = preferred.read_text(encoding='utf-8').strip()
                    loaded = json.loads(content) if content else {}
                    if isinstance(loaded, list) and loaded:
                        data = loaded[0]
                    elif isinstance(loaded, dict):
                        data = loaded
                except Exception as e:
                    print(f"[PersonaManager] Error reading persona file: {e}")

        # Use folder name as persona_id to ensure consistency with folder structure
        persona_id = persona_dir.name
        name = data.get("name") or persona_dir.name
        description = data.get("description", "")
        cover_art = data.get("cover_art") or self._get_coverart_url(persona_dir)
        icon_art = data.get("icon_art") or cover_art
        cover_fit = self._normalize_fit(data.get("cover_art_fit"))
        icon_fit = self._normalize_fit(data.get("icon_fit"))

        persona = {
            "id": persona_id,
            "name": name,
            "description": description,
            "cover_art": cover_art or "",
            "icon_art": icon_art or "",
            "cover_art_fit": cover_fit,
            "icon_fit": icon_fit,
            "created": data.get("created") or datetime.now().isoformat(),
            "is_system": bool(data.get("is_system", False))
        }

        return persona

    def _save_persona(self, persona_dir, persona):
        payload = {
            "id": persona.get("id"),
            "name": persona.get("name"),
            "description": persona.get("description", ""),
            "cover_art": persona.get("cover_art", ""),
            "icon_art": persona.get("icon_art", ""),
            "cover_art_fit": persona.get("cover_art_fit", {"size": 100, "x": 50, "y": 50}),
            "icon_fit": persona.get("icon_fit", {"size": 100, "x": 50, "y": 50}),
            "created": persona.get("created"),
            "is_system": persona.get("is_system", False)
        }
        persona_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(persona_dir / "persona.json", 'w', encoding='utf-8') as f:
                json.dump(payload, f, indent=2)
        except Exception as e:
            print(f"[PersonaManager] Error saving persona: {e}")

    def get_all_personas(self):
        """Get all available personas"""
        personas = []
        for persona_dir in self._iter_persona_dirs():
            personas.append(self._load_persona_from_dir(persona_dir))
        return personas

    def _find_persona_dir(self, persona_id):
        for persona_dir in self._iter_persona_dirs():
            persona = self._load_persona_from_dir(persona_dir)
            if persona.get("id") == persona_id or persona_dir.name == persona_id:
                return persona_dir
        return None

    def get_persona(self, persona_id):
        """Get a specific persona"""
        persona_dir = self._find_persona_dir(persona_id)
        if not persona_dir:
            return None
        return self._load_persona_from_dir(persona_dir)

    def create_persona(self, name, description="", cover_art=""):
        """Create a new persona"""
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", name or "Persona")
        persona_dir = self.personas_folder / safe_name
        if persona_dir.exists():
            print(f"[PersonaManager] Persona '{safe_name}' already exists")
            return None

        persona = {
            "id": safe_name,
            "name": name or safe_name,
            "description": description,
            "cover_art": cover_art,
            "icon_art": cover_art,
            "cover_art_fit": {"size": 100, "x": 50, "y": 50},
            "icon_fit": {"size": 100, "x": 50, "y": 50},
            "created": datetime.now().isoformat(),
            "is_system": False
        }

        self._get_images_folder(safe_name)
        self._get_coverart_folder(safe_name)
        self._save_persona(persona_dir, persona)

        print(f"[PersonaManager] Created persona '{name}'")
        return persona

    def update_persona(self, persona_id, **kwargs):
        """Update a persona's properties"""
        persona_dir = self._find_persona_dir(persona_id)
        if not persona_dir:
            print(f"[PersonaManager] Persona '{persona_id}' not found")
            return None

        persona = self._load_persona_from_dir(persona_dir)
        if persona.get("is_system") and persona.get("id") == "user_default":
            pass

        for key in ["name", "description", "cover_art", "icon_art", "cover_art_fit", "icon_fit"]:
            if key in kwargs and kwargs[key] is not None:
                persona[key] = kwargs[key]

        self._save_persona(persona_dir, persona)
        print(f"[PersonaManager] Updated persona '{persona_id}'")
        return persona

    def delete_persona(self, persona_id):
        """Delete a persona (cannot delete system personas)"""
        persona_dir = self._find_persona_dir(persona_id)
        if not persona_dir:
            return False

        persona = self._load_persona_from_dir(persona_dir)
        if persona.get("is_system"):
            print(f"[PersonaManager] Cannot delete system persona")
            return False

        try:
            shutil.rmtree(persona_dir)
            print(f"[PersonaManager] Deleted persona '{persona_id}'")
            return True
        except Exception as e:
            print(f"[PersonaManager] Error deleting persona '{persona_id}': {e}")
            return False

    def _normalize_fit(self, fit):
        if not isinstance(fit, dict):
            return {"size": 100, "x": 50, "y": 50}
        return {
            "size": fit.get("size", 100),
            "x": fit.get("x", 50),
            "y": fit.get("y", 50)
        }

    def _get_coverart_url(self, persona_dir):
        cover_folder = persona_dir / "Coverart"
        if not cover_folder.exists():
            return ""
        images = sorted([p for p in cover_folder.iterdir() if p.is_file()])
        if not images:
            return ""
        return f"/Personas/{persona_dir.name}/Coverart/{images[0].name}"

    def _get_images_folder(self, persona_id):
        persona_dir = self.personas_folder / persona_id
        images_folder = persona_dir / "Images"
        images_folder.mkdir(parents=True, exist_ok=True)
        return images_folder

    def _get_coverart_folder(self, persona_id):
        persona_dir = self.personas_folder / persona_id
        cover_folder = persona_dir / "Coverart"
        cover_folder.mkdir(parents=True, exist_ok=True)
        return cover_folder

    def list_images(self, persona_id):
        if not persona_id:
            return []
        images_folder = self._get_images_folder(persona_id)
        items = []
        for img in sorted(images_folder.iterdir()):
            if img.is_file():
                items.append({
                    "name": img.name,
                    "url": f"/Personas/{persona_id}/Images/{img.name}"
                })
        return items

    def add_image(self, persona_id, filename, data_url):
        if not persona_id:
            return None
        images_folder = self._get_images_folder(persona_id)
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", Path(filename).name or "image.png")

        if data_url and "," in data_url:
            _, encoded = data_url.split(",", 1)
        else:
            encoded = data_url or ""

        try:
            payload = base64.b64decode(encoded)
        except Exception:
            return None

        file_path = images_folder / safe_name
        try:
            file_path.write_bytes(payload)
        except Exception as e:
            print(f"[PersonaManager] Error writing image for '{persona_id}': {e}")
            return None

        return {"name": safe_name, "url": f"/Personas/{persona_id}/Images/{safe_name}"}

    def delete_image(self, persona_id, filename):
        if not persona_id or not filename:
            return False
        images_folder = self._get_images_folder(persona_id)
        safe_name = Path(filename).name
        target = images_folder / safe_name
        if not target.exists():
            return False
        try:
            target.unlink()
            return True
        except Exception as e:
            print(f"[PersonaManager] Error deleting image for '{persona_id}': {e}")
            return False

    def set_cover_art_from_image(self, persona_id, image_name):
        if not persona_id or not image_name:
            return None
        images_folder = self._get_images_folder(persona_id)
        cover_folder = self._get_coverart_folder(persona_id)
        safe_name = Path(image_name).name
        source = images_folder / safe_name
        if not source.exists():
            return None
        target = cover_folder / safe_name
        try:
            shutil.copy2(source, target)
        except Exception as e:
            print(f"[PersonaManager] Error setting coverart for '{persona_id}': {e}")
            return None

        cover_url = f"/Personas/{persona_id}/Coverart/{safe_name}"
        return self.update_persona(persona_id, cover_art=cover_url, icon_art=cover_url)

    def set_icon_from_image(self, persona_id, image_name, source_folder="Images"):
        if not persona_id or not image_name:
            return None
        safe_name = Path(image_name).name
        if source_folder == "Coverart":
            cover_folder = self._get_coverart_folder(persona_id)
            if not (cover_folder / safe_name).exists():
                return None
            icon_url = f"/Personas/{persona_id}/Coverart/{safe_name}"
        else:
            images_folder = self._get_images_folder(persona_id)
            if not (images_folder / safe_name).exists():
                return None
            icon_url = f"/Personas/{persona_id}/Images/{safe_name}"
        return self.update_persona(persona_id, icon_art=icon_url)
