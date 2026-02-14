# Persona Manager: Responsible for managing user personas

import json
from pathlib import Path
from datetime import datetime


class PersonaManager:
    def __init__(self, personas_folder="../Personas"):
        """Initialize the persona manager with the path to the Personas folder"""
        self.personas_folder = Path(__file__).parent / personas_folder
        self.personas_file = self.personas_folder / "personas.txt"
        self.current_persona = None
        
    def _ensure_personas_file(self):
        """Ensure the personas file exists with default user persona"""
        if not self.personas_file.exists():
            default_personas = [
                {
                    "id": "user_default",
                    "name": "User",
                    "description": "",
                    "cover_art": "",
                    "created": datetime.now().isoformat(),
                    "is_system": True
                }
            ]
            self._save_personas(default_personas)
            return default_personas
            
        return self._load_personas()
            
    def _load_personas(self):
        """Load all personas from file"""
        if not self.personas_file.exists():
            return self._ensure_personas_file()
            
        try:
            with open(self.personas_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if not content:
                    return self._ensure_personas_file()
                return json.loads(content)
        except Exception as e:
            print(f"[PersonaManager] Error loading personas: {e}")
            return self._ensure_personas_file()
            
    def _save_personas(self, personas_list):
        """Save personas to file"""
        self.personas_folder.mkdir(parents=True, exist_ok=True)
        try:
            with open(self.personas_file, 'w', encoding='utf-8') as f:
                json.dump(personas_list, f, indent=2)
        except Exception as e:
            print(f"[PersonaManager] Error saving personas: {e}")
            
    def get_all_personas(self):
        """Get all available personas"""
        return self._load_personas()
        
    def get_persona(self, persona_id):
        """Get a specific persona"""
        personas = self._load_personas()
        for persona in personas:
            if persona["id"] == persona_id:
                return persona
        return None
        
    def create_persona(self, name, description="", cover_art=""):
        """Create a new persona"""
        personas = self._load_personas()
        
        persona_id = f"persona_{len(personas)}_{datetime.now().strftime('%s')}"
        new_persona = {
            "id": persona_id,
            "name": name,
            "description": description,
            "cover_art": cover_art,
            "created": datetime.now().isoformat(),
            "is_system": False
        }
        
        personas.append(new_persona)
        self._save_personas(personas)
        
        print(f"[PersonaManager] Created persona '{name}'")
        return new_persona
        
    def update_persona(self, persona_id, **kwargs):
        """Update a persona's properties"""
        personas = self._load_personas()
        
        for persona in personas:
            if persona["id"] == persona_id:
                # Don't allow updating system personas
                if persona.get("is_system") and persona_id == "user_default":
                    persona.update(kwargs)
                elif not persona.get("is_system"):
                    persona.update(kwargs)
                else:
                    print(f"[PersonaManager] Cannot update system persona")
                    return None
                    
                self._save_personas(personas)
                print(f"[PersonaManager] Updated persona '{persona_id}'")
                return persona
                
        print(f"[PersonaManager] Persona '{persona_id}' not found")
        return None
        
    def delete_persona(self, persona_id):
        """Delete a persona (cannot delete system personas)"""
        if persona_id == "user_default":
            print(f"[PersonaManager] Cannot delete system persona")
            return False
            
        personas = self._load_personas()
        personas = [p for p in personas if p["id"] != persona_id]
        
        self._save_personas(personas)
        print(f"[PersonaManager] Deleted persona '{persona_id}'")
        return True
