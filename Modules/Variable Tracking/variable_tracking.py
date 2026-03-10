"""
Variable Tracking module.

Tracks structured variables from chat messages and stores them in
Bots/<BotName>/<ChatId>/variables.json.
"""

import hashlib
import json
import re
import threading
from datetime import datetime
from pathlib import Path


MODULE_PROMPT = """
Variable Tracking Module (Internal)
- Structured variables are tracked from chat content (for example hp, stamina, time, counters).
- Use the latest tracked variable snapshot as factual context when relevant.
- Prefer tracked values over guessed values if both exist.
""".strip()

_LOCK = threading.RLock()
_PATCHED_PIPELINES = set()

_NAME_NARRATIVE_TOKENS = {
    "as", "for", "my", "our", "your", "their", "the", "a", "an", "and", "or",
    "story", "backstory", "background", "equipment", "starting", "about", "description",
    "take", "will", "would", "can", "could", "should",
}

_STRING_STATE_HINTS = {
    "hp", "health", "mana", "mp", "stamina", "energy", "time", "clock", "hour", "minute",
    "gold", "coins", "money", "level", "xp", "exp", "score", "count", "counter", "status",
    "state", "mode", "phase", "location", "zone", "room", "quest", "objective", "target",
    "class", "race", "title", "alignment", "strength", "dexterity", "intelligence", "wisdom",
    "charisma", "luck", "attack", "defense", "speed", "rank", "name",
}

_STRING_VALUE_STOPWORDS = {
    "i", "we", "you", "he", "she", "they", "it", "my", "our", "your", "their",
    "am", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "will", "would", "can", "could", "should", "take", "raised", "decided", "explore",
}


def _now_iso():
    return datetime.now().isoformat()


def _debug(context, event, **details):
    logger = (context or {}).get("debug_logger")
    if logger is None:
        return
    try:
        if callable(logger):
            logger(f"variable_tracking.{event}", **details)
            return
        if hasattr(logger, "log_event") and callable(getattr(logger, "log_event")):
            logger.log_event(f"variable_tracking.{event}", **details)
    except Exception:
        return


def _parse_bool(value, default=False):
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _parse_int(value, default):
    try:
        return int(float(str(value).strip()))
    except Exception:
        return default


def _load_bot_module_settings(context, bot_name):
    bot_manager = (context or {}).get("bot_manager")
    if not bot_manager or not bot_name:
        return {}

    try:
        bot = bot_manager.load_bot(bot_name)
    except Exception:
        return {}

    if not isinstance(bot, dict):
        return {}

    module_settings = bot.get("module_settings")
    if not isinstance(module_settings, dict):
        return {}

    candidates = [
        "Variable Tracking",
        "Variable_Tracking",
        "variable_tracking",
        "VariableTracking"
    ]
    for key in candidates:
        value = module_settings.get(key)
        if isinstance(value, dict):
            return value
    return {}


def _normalize_settings(raw):
    source = {str(key).strip().lower(): raw[key] for key in (raw or {}) if str(key).strip()}

    def pick(*keys, default=None):
        for key in keys:
            if key in source:
                return source[key]
        return default

    return {
        "auto_tracking_enabled": _parse_bool(pick("auto_tracking_enabled", "enabled", default="true"), True),
        "track_assistant_messages": _parse_bool(pick("track_assistant_messages", default="false"), False),
        "context_max_items": max(1, _parse_int(pick("context_max_items", default="12"), 12)),
        "context_max_chars": max(80, _parse_int(pick("context_max_chars", default="420"), 420)),
    }


def _safe_read_json(path):
    if not path.exists() or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _default_state(auto_tracking_enabled=True):
    return {
        "auto_tracking_enabled": bool(auto_tracking_enabled),
        "variables": [],
        "_meta": {
            "schema_version": 1,
            "last_processed_signature": "",
            "last_change_id": 0,
            "last_changes": [],
            "prompt_context": "",
            "updated_at": _now_iso()
        }
    }


def _normalize_state(payload, settings):
    state = payload if isinstance(payload, dict) else _default_state(auto_tracking_enabled=settings["auto_tracking_enabled"])

    if not isinstance(state.get("variables"), list):
        state["variables"] = []

    if not isinstance(state.get("_meta"), dict):
        state["_meta"] = {}

    state.setdefault("auto_tracking_enabled", bool(settings["auto_tracking_enabled"]))

    normalized_vars = []
    for item in state.get("variables", []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        normalized_vars.append({
            "name": name,
            "value": item.get("value"),
            "type": str(item.get("type") or "string"),
            "scope": str(item.get("scope") or "global"),
            "updated_at": str(item.get("updated_at") or _now_iso()),
            "source": str(item.get("source") or ""),
            "last_updater": str(item.get("last_updater") or ""),
            "locked": bool(item.get("locked", False)),
        })

    state["variables"] = normalized_vars
    state["_meta"].setdefault("schema_version", 1)
    state["_meta"].setdefault("last_processed_signature", "")
    state["_meta"].setdefault("last_change_id", 0)
    state["_meta"].setdefault("last_changes", [])
    state["_meta"].setdefault("prompt_context", "")
    state["_meta"]["updated_at"] = _now_iso()
    return state


def _atomic_write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _slug(value):
    cleaned = re.sub(r"[^a-z0-9_]+", "_", str(value or "").strip().lower())
    cleaned = cleaned.strip("_")
    return cleaned


def _normalize_alias_token(text):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(text or "").lower())).strip()


def _build_alias_map(settings_map):
    alias_map = {}

    defaults = {
        "user_hp": ["hp", "my hp", "user hp", "health", "my health", "user health"],
        "bot_hp": ["bot hp", "assistant hp", "enemy hp", "npc hp"],
        "stamina": ["stamina", "energy"],
        "mana": ["mana", "mp"],
        "time": ["time", "clock", "hour"],
        "gold": ["gold", "coins", "money"],
    }

    for canonical, aliases in defaults.items():
        alias_map[_normalize_alias_token(canonical)] = canonical
        for alias in aliases:
            alias_map[_normalize_alias_token(alias)] = canonical

    for key, raw_value in (settings_map or {}).items():
        key_text = str(key or "").strip().lower()
        if not key_text.startswith("alias_"):
            continue
        canonical = _slug(key_text[len("alias_"):])
        if not canonical:
            continue
        alias_map[_normalize_alias_token(canonical)] = canonical
        values = [part.strip() for part in str(raw_value or "").split("|") if part.strip()]
        for alias in values:
            alias_map[_normalize_alias_token(alias)] = canonical

    return alias_map


def _canonicalize_name(raw_name, alias_map):
    token = _normalize_alias_token(raw_name)
    if not token:
        return ""

    aliased = alias_map.get(token)
    if aliased:
        return aliased

    direct = _slug(token.replace(" ", "_"))
    if not direct:
        return ""
    return direct


def _cast_value(raw_value):
    text = str(raw_value or "").strip()
    if not text:
        return None

    if re.fullmatch(r"\d{1,2}:\d{2}", text):
        return {"value": text, "type": "time", "display": text}

    if text.endswith("%"):
        num_part = text[:-1].strip()
        try:
            num = float(num_part)
        except Exception:
            return None
        if num.is_integer():
            num = int(num)
        return {"value": num, "type": "percent", "display": f"{num}%"}

    if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", text):
        try:
            num = float(text)
        except Exception:
            return None
        if num.is_integer():
            num = int(num)
        return {"value": num, "type": "number", "display": str(num)}

    compact = re.sub(r"\s+", " ", text).strip()
    if not compact:
        return None
    if len(compact) > 80:
        compact = compact[:80].rsplit(" ", 1)[0].strip() or compact[:80]
    return {"value": compact, "type": "string", "display": compact}


def _is_likely_variable_name(canonical_name):
    name = str(canonical_name or "").strip().lower()
    if not name:
        return False

    tokens = [part for part in name.split("_") if part]
    if not tokens:
        return False

    if len(tokens) > 5:
        return False

    if any(len(token) > 20 for token in tokens):
        return False

    narrative_hits = sum(1 for token in tokens if token in _NAME_NARRATIVE_TOKENS)
    if narrative_hits >= 2:
        return False

    if name.startswith("as_for_") or name.startswith("for_my_"):
        return False

    return True


def _is_scalar_string_value(value_text):
    text = str(value_text or "").strip()
    if not text:
        return False

    if len(text) > 32:
        return False

    if any(ch in text for ch in ".!?;\n"):
        return False

    words = [word for word in re.split(r"\s+", text) if word]
    if not words:
        return False

    if len(words) > 4:
        return False

    lowered_words = [word.lower() for word in words]
    if any(word in _STRING_VALUE_STOPWORDS for word in lowered_words):
        return False

    return True


def _should_accept_candidate(canonical_name, casted):
    if not _is_likely_variable_name(canonical_name):
        return False

    value_type = str((casted or {}).get("type") or "").strip().lower()
    if value_type in {"number", "percent", "time"}:
        return True

    if value_type != "string":
        return False

    tokens = {part for part in str(canonical_name or "").split("_") if part}
    if tokens.intersection(_STRING_STATE_HINTS):
        return True

    return _is_scalar_string_value((casted or {}).get("value"))


def _iter_message_candidates(content):
    text = str(content or "")
    if not text.strip():
        return

    assignment_pattern = re.compile(
        r"(?P<name>[A-Za-z][A-Za-z0-9_\- ]{0,32})\s*(?:is|=)\s*(?P<value>\d{1,4}(?:\.\d+)?%?|\d{1,2}:\d{2}|[A-Za-z][A-Za-z0-9_\- ]{0,40})",
        re.IGNORECASE,
    )
    colon_pair_pattern = re.compile(
        r"(?P<name>[A-Za-z][A-Za-z0-9_\- ]{0,32})\s*:\s*(?P<value>\d{1,4}(?:\.\d+)?%?|\d{1,2}:\d{2}|[A-Za-z][A-Za-z0-9_\- ]{0,40})(?!\s*:)",
        re.IGNORECASE,
    )
    percent_pattern = re.compile(
        r"\b(?P<name>[A-Za-z][A-Za-z0-9_\- ]{0,24})\s+(?P<value>\d{1,3}(?:\.\d+)?)%\b",
        re.IGNORECASE,
    )

    seen = set()
    for match in assignment_pattern.finditer(text):
        name = str(match.group("name") or "").strip()
        value = str(match.group("value") or "").strip()
        key = (name.lower(), value.lower())
        if key in seen:
            continue
        seen.add(key)
        yield {"name": name, "value": value}

    for match in colon_pair_pattern.finditer(text):
        name = str(match.group("name") or "").strip()
        value = str(match.group("value") or "").strip()
        key = (name.lower(), value.lower())
        if key in seen:
            continue
        seen.add(key)
        yield {"name": name, "value": value}

    for match in percent_pattern.finditer(text):
        name = str(match.group("name") or "").strip()
        value = f"{str(match.group('value') or '').strip()}%"
        key = (name.lower(), value.lower())
        if key in seen:
            continue
        seen.add(key)
        yield {"name": name, "value": value}


def _resolve_effective_content(payload):
    if not isinstance(payload, dict):
        return ""

    role = str(payload.get("role") or "").strip().lower()
    if role != "assistant":
        return str(payload.get("content") or "")

    variants = payload.get("variants")
    if not isinstance(variants, list) or not variants:
        return str(payload.get("content") or "")

    selected_index = payload.get("selected_variant_index")
    try:
        selected_index = int(selected_index)
    except Exception:
        selected_index = len(variants) - 1

    selected_index = max(0, min(selected_index, len(variants) - 1))
    selected = variants[selected_index] if selected_index < len(variants) else None
    if isinstance(selected, dict):
        selected_content = str(selected.get("content") or "")
        if selected_content.strip():
            return selected_content

    return str(payload.get("content") or "")


def _load_iam_messages(chat_folder):
    iam_dir = Path(chat_folder) / "IAM"
    if not iam_dir.exists() or not iam_dir.is_dir():
        return []

    rows = []
    for iam_file in sorted(iam_dir.glob("*.txt"), key=lambda item: item.name.lower()):
        payload = _safe_read_json(iam_file)
        if not isinstance(payload, dict):
            continue

        role = str(payload.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue

        content = _resolve_effective_content(payload)
        if not str(content).strip():
            continue

        order_value = payload.get("order")
        try:
            order_num = int(order_value)
        except Exception:
            order_num = 0

        rows.append({
            "file": iam_file.name,
            "role": role,
            "content": content,
            "order": order_num,
            "timestamp": str(payload.get("timestamp") or ""),
        })

    rows.sort(key=lambda item: (item.get("order", 0), item.get("file", "")))
    return rows


def _select_latest_message(messages, track_assistant_messages):
    allowed_roles = {"user", "assistant"} if track_assistant_messages else {"user"}
    for item in reversed(messages or []):
        if item.get("role") in allowed_roles and str(item.get("content") or "").strip():
            return item
    return None


def _compute_message_signature(message):
    if not isinstance(message, dict):
        return ""
    role = str(message.get("role") or "")
    file_name = str(message.get("file") or "")
    content = str(message.get("content") or "")
    digest = hashlib.sha1(content.encode("utf-8", errors="ignore")).hexdigest()
    return f"{file_name}:{role}:{digest}"


def _resolve_scope(canonical_name, updater_role):
    if canonical_name.startswith("user_"):
        return "user"
    if canonical_name.startswith("bot_") or canonical_name.startswith("assistant_"):
        return "assistant"
    return "user" if updater_role == "user" else "global"


def _apply_updates(state, updates, source_file, updater_role):
    variables = state.get("variables", [])
    existing_by_name = {str(item.get("name") or ""): item for item in variables if isinstance(item, dict)}

    change_rows = []
    for update in updates:
        canonical_name = str(update.get("name") or "").strip()
        casted = update.get("casted") if isinstance(update.get("casted"), dict) else None
        if not canonical_name or not casted:
            continue

        current = existing_by_name.get(canonical_name)
        if current is None:
            current = {
                "name": canonical_name,
                "value": casted.get("value"),
                "type": casted.get("type", "string"),
                "scope": _resolve_scope(canonical_name, updater_role),
                "updated_at": _now_iso(),
                "source": source_file,
                "last_updater": updater_role,
                "locked": False,
            }
            variables.append(current)
            existing_by_name[canonical_name] = current
            change_rows.append({"action": "created", "name": canonical_name, "display": casted.get("display")})
            continue

        if bool(current.get("locked", False)):
            continue

        prev_value = current.get("value")
        prev_type = str(current.get("type") or "string")
        next_value = casted.get("value")
        next_type = str(casted.get("type") or "string")

        if prev_value == next_value and prev_type == next_type:
            continue

        current["value"] = next_value
        current["type"] = next_type
        current["updated_at"] = _now_iso()
        current["source"] = source_file
        current["last_updater"] = updater_role
        change_rows.append({"action": "updated", "name": canonical_name, "display": casted.get("display")})

    state["variables"] = sorted(
        [item for item in variables if isinstance(item, dict) and str(item.get("name") or "").strip()],
        key=lambda item: str(item.get("name") or "").lower(),
    )
    return change_rows


def _render_value_for_prompt(item):
    vtype = str(item.get("type") or "")
    value = item.get("value")
    if vtype == "percent":
        return f"{value}%"
    return str(value)


def _build_prompt_context(state, settings):
    variables = state.get("variables") if isinstance(state.get("variables"), list) else []
    if not variables:
        return ""

    sorted_vars = sorted(
        variables,
        key=lambda item: str(item.get("updated_at") or ""),
        reverse=True,
    )

    max_items = max(1, int(settings.get("context_max_items", 12)))
    max_chars = max(80, int(settings.get("context_max_chars", 420)))

    chunks = []
    for item in sorted_vars[:max_items]:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        value_text = _render_value_for_prompt(item)
        chunks.append(f"{name}={value_text}")

    text = ", ".join(chunks)
    if len(text) > max_chars:
        text = text[:max_chars].rsplit(",", 1)[0].strip()
        if not text:
            text = ", ".join(chunks)[:max_chars].strip()
    return text


def _get_variables_file(context, bot_name, chat_id):
    chat_manager = (context or {}).get("chat_manager")
    if chat_manager is None or not bot_name or not chat_id:
        return None

    try:
        chat_folder = chat_manager._get_chat_folder(chat_id, bot_name)
    except Exception:
        return None

    if not chat_folder:
        return None

    folder = Path(chat_folder)
    if not folder.exists() or not folder.is_dir():
        return None

    return folder / "variables.json"


def _load_prompt_context_for_chat(context, bot_name, chat_id):
    variables_file = _get_variables_file(context, bot_name, chat_id)
    if not variables_file:
        return ""

    payload = _safe_read_json(variables_file)
    if not isinstance(payload, dict):
        return ""

    meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
    cached = str(meta.get("prompt_context") or "").strip()
    if cached:
        return cached

    fallback_settings = {
        "context_max_items": 12,
        "context_max_chars": 420,
    }
    state = _normalize_state(payload, {"auto_tracking_enabled": True})
    return _build_prompt_context(state, fallback_settings)


def _resolve_module_prompt_key(prompt_order, module_name="Variable Tracking"):
    target = re.sub(r"[\s_-]+", " ", str(module_name or "").strip().lower())
    for key in (prompt_order or []):
        key_text = str(key or "").strip()
        if not key_text.startswith("module::"):
            continue
        raw_name = key_text[len("module::"):]
        normalized = re.sub(r"[\s_-]+", " ", str(raw_name or "").strip().lower())
        if normalized == target:
            return key_text
    return None


def _install_prompt_patch(context):
    prompt_pipeline = (context or {}).get("prompt_pipeline")
    if prompt_pipeline is None:
        return

    pipeline_id = id(prompt_pipeline)
    with _LOCK:
        if pipeline_id in _PATCHED_PIPELINES:
            return

        original = getattr(prompt_pipeline, "_build_module_sections", None)
        if not callable(original):
            return

        def wrapped_build_module_sections(prompt_order, prompt_order_enabled, module_context=None, cancel_check=None):
            # Keep compatibility with both old and new PromptPipeline signatures.
            try:
                sections = original(
                    prompt_order,
                    prompt_order_enabled,
                    module_context=module_context,
                    cancel_check=cancel_check,
                )
            except TypeError:
                sections = original(prompt_order, prompt_order_enabled, module_context=module_context)
            try:
                key = _resolve_module_prompt_key(prompt_order, module_name="Variable Tracking")
                if key and key in sections:
                    active_context = module_context if isinstance(module_context, dict) else {}
                    bot_name = active_context.get("bot_name")
                    chat_id = active_context.get("chat_id")
                    tracked = _load_prompt_context_for_chat(context, bot_name, chat_id)
                    if tracked:
                        sections[key] = (
                            f"{sections[key]}\n\n"
                            f"Tracked Variables (Internal)\n"
                            f"{tracked}"
                        )
            except Exception:
                return sections
            return sections

        setattr(prompt_pipeline, "_build_module_sections", wrapped_build_module_sections)
        _PATCHED_PIPELINES.add(pipeline_id)


def _execute_tracking(context):
    bot_name = (context or {}).get("bot_name")
    chat_id = (context or {}).get("chat_id")
    chat_manager = (context or {}).get("chat_manager")

    if not bot_name or not chat_id or chat_manager is None:
        return

    module_settings_raw = _load_bot_module_settings(context, bot_name)
    settings = _normalize_settings(module_settings_raw)
    alias_map = _build_alias_map(module_settings_raw)

    try:
        chat_folder = chat_manager._get_chat_folder(chat_id, bot_name)
    except Exception:
        chat_folder = None

    if not chat_folder:
        return

    chat_path = Path(chat_folder)
    variables_file = chat_path / "variables.json"

    with _LOCK:
        payload = _safe_read_json(variables_file)
        state = _normalize_state(payload, settings)

        existing_auto = state.get("auto_tracking_enabled")
        if isinstance(existing_auto, bool):
            settings["auto_tracking_enabled"] = existing_auto
        else:
            state["auto_tracking_enabled"] = bool(settings["auto_tracking_enabled"])

        messages = _load_iam_messages(chat_path)
        selected = _select_latest_message(messages, track_assistant_messages=settings["track_assistant_messages"])

        meta = state.setdefault("_meta", {})
        previous_signature = str(meta.get("last_processed_signature") or "")

        changes = []
        if settings["auto_tracking_enabled"] and selected is not None:
            signature = _compute_message_signature(selected)
            if signature and signature != previous_signature:
                parsed_updates = []
                for candidate in _iter_message_candidates(selected.get("content")):
                    canonical_name = _canonicalize_name(candidate.get("name"), alias_map)
                    casted = _cast_value(candidate.get("value"))
                    if not canonical_name or casted is None:
                        continue
                    if not _should_accept_candidate(canonical_name, casted):
                        continue
                    parsed_updates.append({
                        "name": canonical_name,
                        "casted": casted,
                    })

                if parsed_updates:
                    changes = _apply_updates(
                        state,
                        parsed_updates,
                        source_file=str(selected.get("file") or ""),
                        updater_role=str(selected.get("role") or "")
                    )

                meta["last_processed_signature"] = signature

        prompt_context = _build_prompt_context(state, settings)
        meta["prompt_context"] = prompt_context
        meta["updated_at"] = _now_iso()

        if changes:
            change_id = int(meta.get("last_change_id") or 0) + 1
            meta["last_change_id"] = change_id
            meta["last_changes"] = changes[:8]
        else:
            meta.setdefault("last_change_id", int(meta.get("last_change_id") or 0))
            meta.setdefault("last_changes", [])

        _atomic_write_json(variables_file, state)

    _debug(
        context,
        "sync_complete",
        bot_name=bot_name,
        chat_id=chat_id,
        tracked_count=len(state.get("variables", [])),
        changes=len(changes),
        auto_tracking_enabled=bool(settings["auto_tracking_enabled"]),
    )


def _resolve_action_context(action_context, payload):
    context = action_context if isinstance(action_context, dict) else {}
    body = payload if isinstance(payload, dict) else {}

    bot_name = str(
        body.get("bot_name")
        or context.get("bot_name")
        or ""
    ).strip()
    chat_id = str(
        body.get("chat_id")
        or context.get("chat_id")
        or ""
    ).strip()
    return context, body, bot_name, chat_id


def _normalize_manual_value(value, declared_type=None):
    value_type = str(declared_type or "").strip().lower()
    if value_type in {"number", "percent", "time", "string"}:
        casted = _cast_value(f"{value}%" if value_type == "percent" and not str(value).strip().endswith("%") else value)
        if casted and casted.get("type") == value_type:
            return casted
        if value_type == "string":
            return {"value": str(value or ""), "type": "string", "display": str(value or "")}
        return None
    return _cast_value(value)


def _load_or_create_state_for_action(context, bot_name, chat_id, use_module_settings=True):
    if use_module_settings:
        settings_raw = _load_bot_module_settings(context, bot_name)
        settings = _normalize_settings(settings_raw)
    else:
        settings = _normalize_settings({})
    variables_file = _get_variables_file(context, bot_name, chat_id)
    if not variables_file:
        return None, None, None

    payload = _safe_read_json(variables_file)
    state = _normalize_state(payload, settings)
    return variables_file, state, settings


def _public_state_payload(state):
    public = {
        "auto_tracking_enabled": bool(state.get("auto_tracking_enabled", True)),
        "variables": state.get("variables") if isinstance(state.get("variables"), list) else [],
    }
    meta = state.get("_meta") if isinstance(state.get("_meta"), dict) else {}
    public["_meta"] = {
        "schema_version": int(meta.get("schema_version") or 1),
        "last_change_id": int(meta.get("last_change_id") or 0),
        "last_changes": meta.get("last_changes") if isinstance(meta.get("last_changes"), list) else [],
        "updated_at": str(meta.get("updated_at") or ""),
    }
    return public


def handle_action(action=None, payload=None, context=None):
    action_name = str(action or "").strip().lower()
    context, body, bot_name, chat_id = _resolve_action_context(context, payload)
    if not bot_name or not chat_id:
        return {"success": False, "message": "Missing bot_name or chat_id"}

    needs_module_settings = action_name not in {"list", "get"}
    variables_file, state, _settings = _load_or_create_state_for_action(
        context,
        bot_name,
        chat_id,
        use_module_settings=needs_module_settings
    )
    if not variables_file or state is None:
        return {"success": False, "message": "Unable to resolve chat variables file"}

    alias_map = _build_alias_map(_load_bot_module_settings(context, bot_name)) if needs_module_settings else {}

    with _LOCK:
        if action_name in {"list", "get"}:
            return _public_state_payload(state)

        if action_name == "set_auto_tracking":
            enabled = _parse_bool(body.get("enabled"), True)
            state["auto_tracking_enabled"] = bool(enabled)
            meta = state.setdefault("_meta", {})
            meta["updated_at"] = _now_iso()
            meta["last_change_id"] = int(meta.get("last_change_id") or 0) + 1
            meta["last_changes"] = [{"action": "updated", "name": "auto_tracking_enabled", "display": str(bool(enabled)).lower()}]
            _atomic_write_json(variables_file, state)
            return _public_state_payload(state)

        if action_name in {"upsert", "set_variable", "create_variable", "update_variable"}:
            raw_name = body.get("name")
            raw_value = body.get("value")
            raw_type = body.get("type")
            raw_scope = str(body.get("scope") or "").strip().lower() or "global"

            canonical = _canonicalize_name(raw_name, alias_map)
            casted = _normalize_manual_value(raw_value, raw_type)
            if not canonical:
                return {"success": False, "message": "Invalid variable name"}
            if casted is None:
                return {"success": False, "message": "Invalid variable value/type"}

            variables = state.get("variables") if isinstance(state.get("variables"), list) else []
            current = next((item for item in variables if isinstance(item, dict) and str(item.get("name") or "") == canonical), None)
            change_action = "updated"
            if current is None:
                current = {
                    "name": canonical,
                    "value": casted.get("value"),
                    "type": casted.get("type"),
                    "scope": raw_scope,
                    "updated_at": _now_iso(),
                    "source": str(body.get("source") or "manual"),
                    "last_updater": "manual",
                    "locked": bool(body.get("locked", False)),
                }
                variables.append(current)
                change_action = "created"
            else:
                if bool(current.get("locked", False)) and not _parse_bool(body.get("force"), False):
                    return {"success": False, "message": "Variable is locked"}
                current["value"] = casted.get("value")
                current["type"] = casted.get("type")
                current["scope"] = raw_scope or str(current.get("scope") or "global")
                current["updated_at"] = _now_iso()
                current["source"] = str(body.get("source") or "manual")
                current["last_updater"] = "manual"

            state["variables"] = sorted(
                [item for item in variables if isinstance(item, dict) and str(item.get("name") or "").strip()],
                key=lambda item: str(item.get("name") or "").lower(),
            )
            meta = state.setdefault("_meta", {})
            meta["updated_at"] = _now_iso()
            meta["last_change_id"] = int(meta.get("last_change_id") or 0) + 1
            meta["last_changes"] = [{"action": change_action, "name": canonical, "display": casted.get("display")}]
            _atomic_write_json(variables_file, state)
            return _public_state_payload(state)

        if action_name == "delete_variable":
            canonical = _canonicalize_name(body.get("name"), alias_map)
            if not canonical:
                return {"success": False, "message": "Invalid variable name"}
            before = len(state.get("variables") or [])
            state["variables"] = [
                item for item in (state.get("variables") or [])
                if not (isinstance(item, dict) and str(item.get("name") or "") == canonical)
            ]
            if len(state["variables"]) == before:
                return {"success": False, "message": "Variable not found"}
            meta = state.setdefault("_meta", {})
            meta["updated_at"] = _now_iso()
            meta["last_change_id"] = int(meta.get("last_change_id") or 0) + 1
            meta["last_changes"] = [{"action": "deleted", "name": canonical, "display": canonical}]
            _atomic_write_json(variables_file, state)
            return _public_state_payload(state)

        if action_name == "set_lock":
            canonical = _canonicalize_name(body.get("name"), alias_map)
            if not canonical:
                return {"success": False, "message": "Invalid variable name"}
            locked = _parse_bool(body.get("locked"), True)
            target = None
            for item in (state.get("variables") or []):
                if isinstance(item, dict) and str(item.get("name") or "") == canonical:
                    target = item
                    break
            if target is None:
                return {"success": False, "message": "Variable not found"}
            target["locked"] = bool(locked)
            target["updated_at"] = _now_iso()
            target["source"] = "manual"
            target["last_updater"] = "manual"
            meta = state.setdefault("_meta", {})
            meta["updated_at"] = _now_iso()
            meta["last_change_id"] = int(meta.get("last_change_id") or 0) + 1
            meta["last_changes"] = [{"action": "updated", "name": canonical, "display": f"locked={str(bool(locked)).lower()}"}]
            _atomic_write_json(variables_file, state)
            return _public_state_payload(state)

        return {"success": False, "message": f"Unknown action: {action_name}"}


def process(context=None):
    context = context or {}
    _install_prompt_patch(context)
    _execute_tracking(context)
    return MODULE_PROMPT


def extend(context=None):
    context = context or {}
    _install_prompt_patch(context)
    _execute_tracking(context)
    return MODULE_PROMPT
