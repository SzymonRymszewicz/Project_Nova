# Prompt Pipeline: Builds ordered prompt context and calls an OpenAI-compatible LLM endpoint.

import json
import urllib.error
import urllib.request


class PromptPipeline:
    def __init__(self, bot_manager, chat_manager, persona_manager, settings_manager):
        self.bot_manager = bot_manager
        self.chat_manager = chat_manager
        self.persona_manager = persona_manager
        self.settings_manager = settings_manager

    def generate_reply(self, user_message, bot_name, chat_id=None, persona_id=None, persona_name=None):
        if not user_message:
            return None, "Empty user message."
        if not bot_name:
            return None, "No bot selected."

        bot = self.bot_manager.load_bot(bot_name)
        if not bot:
            return None, "Failed to load bot configuration."

        settings = self.settings_manager.get_all()
        validation_error = self._validate_api_settings(settings)
        if validation_error:
            return None, validation_error

        persona_context = self._resolve_persona_context(persona_id=persona_id, persona_name=persona_name)
        history_messages = self._get_chat_history_messages(chat_id=chat_id, bot_name=bot_name)
        composed_messages = self._compose_messages(
            bot=bot,
            persona_context=persona_context,
            history_messages=history_messages,
            latest_user_message=user_message
        )

        payload = self._build_request_payload(settings=settings, messages=composed_messages)
        response_text, error = self._request_completion(settings=settings, payload=payload)
        if error:
            return None, error

        if not response_text:
            return None, "LLM returned an empty response."

        return response_text, None

    def _validate_api_settings(self, settings):
        provider = (settings.get("api_provider") or "localhost").strip().lower()
        api_base_url = (settings.get("api_base_url") or "").strip()
        model = (settings.get("model") or "").strip()
        api_key = (settings.get("api_key") or "").strip()

        if not api_base_url:
            return "API Base URL is not set."

        if provider == "openai" and not api_key:
            return "OpenAI provider requires API key."

        if not model:
            return "Model is not set in Settings > API Client."

        return None

    def _resolve_persona_context(self, persona_id=None, persona_name=None):
        persona = None

        if persona_id:
            persona = self.persona_manager.get_persona(persona_id)

        if persona is None and persona_name:
            for candidate in self.persona_manager.get_all_personas():
                if (candidate.get("name") or "").strip().lower() == str(persona_name).strip().lower():
                    persona = candidate
                    break

        if persona is None:
            persona = self.persona_manager.get_persona("User")

        if persona is None:
            persona = {
                "id": "User",
                "name": "User",
                "description": ""
            }

        persona_definition = self._read_persona_definition(persona)
        return {
            "id": persona.get("id") or "User",
            "name": persona.get("name") or "User",
            "definition": persona_definition
        }

    def _read_persona_definition(self, persona):
        persona_id = (persona.get("id") or "User").strip() or "User"
        persona_name = (persona.get("name") or "User").strip() or "User"

        persona_dir = self.persona_manager.personas_folder / persona_id
        candidate_files = [
            persona_dir / "user.txt",
            persona_dir / f"{persona_id}.txt",
            persona_dir / f"{persona_name}.txt"
        ]

        for file_path in candidate_files:
            if file_path.exists() and file_path.is_file():
                try:
                    content = file_path.read_text(encoding="utf-8").strip()
                    if content:
                        return content
                except Exception:
                    continue

        return (persona.get("description") or "").strip()

    def _get_chat_history_messages(self, chat_id, bot_name):
        if chat_id and self.chat_manager.current_chat_id == chat_id and self.chat_manager.current_bot_name == bot_name:
            messages = self.chat_manager.current_chat_messages or []
        elif chat_id:
            loaded = self.chat_manager.load_chat(chat_id, bot_name)
            messages = loaded or []
        else:
            messages = self.chat_manager.current_chat_messages or []

        normalized = []
        for msg in messages:
            role = (msg or {}).get("role")
            content = (msg or {}).get("content", "")
            if role not in ("user", "assistant"):
                continue
            text = str(content).strip()
            if not text:
                continue
            normalized.append({"role": role, "content": text})

        return normalized

    def _compose_messages(self, bot, persona_context, history_messages, latest_user_message):
        prompt_order = self._normalize_prompt_order(bot.get("prompt_order"))
        sections = self._build_sections(bot=bot, persona_context=persona_context)

        has_latest_user = bool(history_messages) and history_messages[-1].get("role") == "user" and history_messages[-1].get("content") == latest_user_message

        messages = []
        iam_inserted = False

        for key in prompt_order:
            if key == "iam":
                messages.extend(history_messages)
                iam_inserted = True
            else:
                section_text = sections.get(key, "").strip()
                if section_text:
                    messages.append({"role": "system", "content": section_text})

        if not iam_inserted:
            messages.extend(history_messages)

        if not has_latest_user:
            messages.append({"role": "user", "content": latest_user_message})

        return messages

    def _normalize_prompt_order(self, order):
        defaults = ["scenario", "core", "user_persona", "iam"]
        if not isinstance(order, list):
            return defaults

        normalized = []
        for item in order:
            if item in defaults and item not in normalized:
                normalized.append(item)

        for item in defaults:
            if item not in normalized:
                normalized.append(item)

        return normalized

    def _build_sections(self, bot, persona_context):
        bot_name = bot.get("name") or "Bot"
        core_data = (bot.get("core_data") or "").strip()
        scenario_data = (bot.get("scenario_data") or "").strip()
        persona_name = persona_context.get("name") or "User"
        persona_definition = (persona_context.get("definition") or "").strip()

        return {
            "core": f"Definition / Core\nBot Name: {bot_name}\n\nDefinition:\n{core_data}".strip(),
            "scenario": f"Rules / Scenario\nRules:\n{scenario_data}".strip(),
            "user_persona": f"User / Persona\nPersona Name: {persona_name}\n\nDefinition:\n{persona_definition}".strip()
        }

    def _build_request_payload(self, settings, messages):
        model = (settings.get("model") or "").strip()
        temperature = settings.get("temperature", 0.7)
        max_response_length = settings.get("max_response_length", 300)
        stop_strings = settings.get("stop_strings", [])

        payload = {
            "model": model,
            "messages": messages,
            "temperature": float(temperature),
            "max_tokens": int(max_response_length)
        }

        normalized_stop = self._normalize_stop_strings(stop_strings)
        if normalized_stop:
            payload["stop"] = normalized_stop

        if settings.get("enable_top_p_max", True):
            try:
                payload["top_p"] = float(settings.get("top_p_max", 0.95))
            except Exception:
                payload["top_p"] = 0.95

        # Localhost/LM Studio specific parameters (OpenAI-compatible servers may ignore unsupported fields)
        provider = (settings.get("api_provider") or "localhost").strip().lower()
        if provider == "localhost":
            try:
                payload["top_k"] = int(settings.get("top_k", 40))
            except Exception:
                payload["top_k"] = 40

            if settings.get("enable_repeat_penalty", True):
                try:
                    payload["repeat_penalty"] = float(settings.get("repeat_penalty", 1.0))
                except Exception:
                    payload["repeat_penalty"] = 1.0

            if settings.get("enable_top_p_min", True):
                try:
                    payload["min_p"] = float(settings.get("top_p_min", 0.05))
                except Exception:
                    payload["min_p"] = 0.05

        return payload

    def _normalize_stop_strings(self, value):
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            parts = [part.strip() for part in value.split("\n")]
            return [part for part in parts if part]
        return []

    def _request_completion(self, settings, payload):
        api_base_url = (settings.get("api_base_url") or "").strip().rstrip("/")
        endpoint = f"{api_base_url}/chat/completions"
        api_key = (settings.get("api_key") or "").strip()

        headers = {
            "Content-Type": "application/json"
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        request_body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(endpoint, data=request_body, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8", errors="ignore")
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8", errors="ignore")
            except Exception:
                detail = ""
            if detail:
                return None, f"HTTP {exc.code}: {detail[:240]}"
            return None, f"HTTP {exc.code}."
        except urllib.error.URLError as exc:
            reason = exc.reason if exc.reason else "Connection failed"
            return None, f"Connection error: {reason}"
        except Exception as exc:
            return None, str(exc)

        try:
            decoded = json.loads(body) if body else {}
        except Exception:
            return None, "Invalid response from LLM endpoint."

        choices = decoded.get("choices") if isinstance(decoded, dict) else None
        if not choices or not isinstance(choices, list):
            return None, "LLM response missing choices."

        first = choices[0] or {}
        message = first.get("message") if isinstance(first, dict) else None
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content.strip(), None

        text = first.get("text") if isinstance(first, dict) else None
        if isinstance(text, str):
            return text.strip(), None

        return None, "LLM response did not include text content."
