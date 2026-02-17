# Prompt Pipeline: Builds ordered prompt context and calls an OpenAI-compatible LLM endpoint.

import json
from pathlib import Path
import threading
import urllib.error
import urllib.request


class PromptPipeline:
    def __init__(self, bot_manager, chat_manager, persona_manager, settings_manager, debug_logger=None):
        self.bot_manager = bot_manager
        self.chat_manager = chat_manager
        self.persona_manager = persona_manager
        self.settings_manager = settings_manager
        self.debug_logger = debug_logger
        self._local_model_instance = None
        self._local_model_path = ""
        self._local_model_lock = threading.Lock()

    def _debug(self, event, **details):
        if callable(self.debug_logger):
            try:
                self.debug_logger(f"pipeline.{event}", **details)
            except Exception:
                pass

    def _preview_text(self, value, max_len=240):
        text = str(value or "").replace("\n", "\\n")
        if len(text) <= max_len:
            return text
        return text[:max_len] + "..."

    def generate_reply(self, user_message, bot_name, chat_id=None, persona_id=None, persona_name=None):
        self._debug(
            "generate.start",
            bot_name=bot_name,
            chat_id=chat_id,
            persona_id=persona_id,
            persona_name=persona_name,
            user_message_length=len(str(user_message or ""))
        )
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

        self._debug(
            "context.composed",
            persona_id=persona_context.get("id"),
            persona_name=persona_context.get("name"),
            persona_definition_length=len(str(persona_context.get("definition") or "")),
            history_count=len(history_messages),
            composed_count=len(composed_messages),
            first_messages=[
                {
                    "role": msg.get("role"),
                    "content_preview": self._preview_text(msg.get("content", ""), 160)
                }
                for msg in composed_messages[:3]
            ]
        )

        payload = self._build_request_payload(settings=settings, messages=composed_messages, persona_context=persona_context)
        self._debug(
            "request.payload",
            model=payload.get("model"),
            message_count=len(payload.get("messages", [])),
            temperature=payload.get("temperature"),
            max_tokens=payload.get("max_tokens"),
            has_stop=bool(payload.get("stop")),
            extra_keys=sorted([key for key in payload.keys() if key not in ("model", "messages", "temperature", "max_tokens", "stop")])
        )
        response_text, error = self._request_completion(settings=settings, payload=payload)
        if error:
            self._debug("request.error", error=error)
            return None, error

        if not response_text:
            return None, "LLM returned an empty response."

        self._debug("request.success", response_length=len(response_text), response_preview=self._preview_text(response_text, 220))

        return response_text, None

    def generate_reply_from_history(self, bot_name, history_messages, persona_id=None, persona_name=None, latest_user_message=None):
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
        normalized_history = []
        for msg in history_messages or []:
            role = (msg or {}).get("role")
            content = str((msg or {}).get("content", "")).strip()
            if role in ("user", "assistant") and content:
                normalized_history.append({"role": role, "content": content})

        user_message = str(latest_user_message or "").strip()
        if not user_message and normalized_history and normalized_history[-1].get("role") == "user":
            user_message = normalized_history[-1].get("content", "")

        composed_messages = self._compose_messages(
            bot=bot,
            persona_context=persona_context,
            history_messages=normalized_history,
            latest_user_message=user_message
        )

        payload = self._build_request_payload(settings=settings, messages=composed_messages, persona_context=persona_context)
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

        if provider == "localmodel":
            if not model:
                return "Select a local model in Settings > API Client."
            resolved_path = self._resolve_local_model_path(model)
            if resolved_path is None or not resolved_path.exists() or not resolved_path.is_file():
                return "Selected local model file was not found in Models/ChatModels."
            return None

        if not api_base_url:
            return "API Base URL is not set."

        if provider == "openai" and not api_key:
            return "OpenAI provider requires API key."

        if not model:
            return "Model is not set in Settings > API Client."

        return None

    def _resolve_local_model_path(self, model_value):
        candidate = str(model_value or "").strip()
        if not candidate:
            return None

        path_candidate = Path(candidate)
        if path_candidate.is_absolute():
            return path_candidate

        models_root = Path(__file__).parent.parent / "Models" / "ChatModels"
        return models_root / candidate

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
                        parsed = self._extract_persona_text(content)
                        if parsed:
                            return parsed
                except Exception:
                    continue

        return (persona.get("description") or "").strip()

    def _extract_persona_text(self, raw_text):
        text = str(raw_text or "").strip()
        if not text:
            return ""
        try:
            loaded = json.loads(text)
        except Exception:
            return text

        if isinstance(loaded, dict):
            description = str(loaded.get("description") or "").strip()
            if description:
                return description
            name = str(loaded.get("name") or "").strip()
            if name:
                return f"Name: {name}"
            return ""

        if isinstance(loaded, list) and loaded:
            first = loaded[0]
            if isinstance(first, dict):
                description = str(first.get("description") or "").strip()
                if description:
                    return description
                name = str(first.get("name") or "").strip()
                if name:
                    return f"Name: {name}"
        return ""

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

        if latest_user_message and not has_latest_user:
            messages.append({"role": "user", "content": latest_user_message})

        return messages

    def _normalize_prompt_order(self, order):
        defaults = ["conduct", "scenario", "core", "user_persona", "iam"]
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
            "conduct": (
                "Conversation Conduct\n"
                "- Be respectful, supportive, and helpful.\n"
                "- Never insult, mock, belittle, taunt, or shame the user.\n"
                "- If user information is missing, politely ask for clarification instead of guessing.\n"
                "- Keep answers constructive and aligned with the configured bot persona."
            ).strip(),
            "core": f"Definition / Core\nBot Name: {bot_name}\n\nDefinition:\n{core_data}".strip(),
            "scenario": f"Rules / Scenario\nRules:\n{scenario_data}".strip(),
            "user_persona": f"User / Persona\nPersona Name: {persona_name}\n\nDefinition:\n{persona_definition}".strip()
        }

    def _build_request_payload(self, settings, messages, persona_context=None):
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
        normalized_stop = self._sanitize_stop_strings(normalized_stop, persona_context)
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

    def _sanitize_stop_strings(self, stop_strings, persona_context=None):
        if not isinstance(stop_strings, list):
            return []
        persona_name = ""
        if isinstance(persona_context, dict):
            persona_name = str(persona_context.get("name") or "").strip().lower()

        filtered = []
        for value in stop_strings:
            token = str(value or "").strip()
            if not token:
                continue
            lowered = token.lower()

            if lowered == "user":
                continue
            if persona_name and lowered == persona_name:
                continue

            filtered.append(token)
        return filtered

    def _request_completion(self, settings, payload):
        provider = (settings.get("api_provider") or "localhost").strip().lower()
        if provider == "localmodel":
            return self._request_local_model_completion(settings=settings, payload=payload)

        api_base_url = (settings.get("api_base_url") or "").strip().rstrip("/")
        endpoint = f"{api_base_url}/chat/completions"
        api_key = (settings.get("api_key") or "").strip()

        self._debug(
            "http.begin",
            endpoint=endpoint,
            provider=(settings.get("api_provider") or "localhost"),
            has_api_key=bool(api_key)
        )

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
                self._debug("http.error", status=exc.code, detail_preview=self._preview_text(detail, 240))
                return None, f"HTTP {exc.code}: {detail[:240]}"
            self._debug("http.error", status=exc.code)
            return None, f"HTTP {exc.code}."
        except urllib.error.URLError as exc:
            reason = exc.reason if exc.reason else "Connection failed"
            self._debug("http.connection_error", reason=str(reason))
            return None, f"Connection error: {reason}"
        except Exception as exc:
            self._debug("http.exception", error=str(exc))
            return None, str(exc)

        try:
            decoded = json.loads(body) if body else {}
        except Exception:
            return None, "Invalid response from LLM endpoint."

        choices = decoded.get("choices") if isinstance(decoded, dict) else None
        if not choices or not isinstance(choices, list):
            self._debug("http.invalid_choices", body_preview=self._preview_text(body, 240))
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

    def _request_local_model_completion(self, settings, payload):
        model_value = (settings.get("model") or "").strip()
        model_path = self._resolve_local_model_path(model_value)
        if model_path is None or not model_path.exists() or not model_path.is_file():
            return None, "Selected local model file was not found."

        try:
            from llama_cpp import Llama
        except Exception:
            return None, "LocalModel provider requires llama-cpp-python to be installed."

        target_model_path = str(model_path.resolve())
        with self._local_model_lock:
            if self._local_model_instance is None or self._local_model_path != target_model_path:
                try:
                    n_ctx = int(settings.get("max_tokens", 10000))
                except Exception:
                    n_ctx = 4096
                n_ctx = max(512, min(n_ctx, 32768))
                try:
                    self._local_model_instance = Llama(model_path=target_model_path, n_ctx=n_ctx)
                    self._local_model_path = target_model_path
                except Exception as exc:
                    return None, f"Failed to load local model: {exc}"

            inference_kwargs = {
                "messages": payload.get("messages", []),
                "temperature": payload.get("temperature", 0.7),
                "max_tokens": payload.get("max_tokens", 300)
            }

            if payload.get("stop"):
                inference_kwargs["stop"] = payload.get("stop")
            if "top_p" in payload:
                inference_kwargs["top_p"] = payload.get("top_p")

            try:
                response = self._local_model_instance.create_chat_completion(**inference_kwargs)
            except Exception as exc:
                return None, f"Local model generation failed: {exc}"

        if not isinstance(response, dict):
            return None, "Invalid local model response format."

        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            return None, "Local model response missing choices."

        first = choices[0] or {}
        message = first.get("message") if isinstance(first, dict) else None
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content.strip(), None

        text = first.get("text") if isinstance(first, dict) else None
        if isinstance(text, str):
            return text.strip(), None

        return None, "Local model response did not include text content."
