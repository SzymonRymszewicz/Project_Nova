import json
import re
import threading
import time
from datetime import datetime
from pathlib import Path

_LOCK = threading.RLock()
_PATCHED_PIPELINES = set()
_ACTIVE_RUNS = set()
_STATUS_BY_CHAT = {}
_STATE_BY_CHAT = {}

DEFAULT_SETTINGS = {
    "messages_history_limit": 14,
    "entity_cap": 8,
    "edge_cap": 12,
    "context_max_lines": 10,
    "context_max_chars": 900,
    "module_max_token_budget": 260,
    "module_max_latency_ms": 20000,
    "llm_max_tokens": 170,
    "llm_max_retries": 0,
    "edge_decay_per_turn": 0.06,
    "tone_decay_per_turn": 0.08,
    "ambiguity_neutral_threshold": 0.70,
    "question_relationship_update": "Infer relationship changes and emotional subtext from the latest exchange.",
    "question_tone_flags": "Score sarcasm, irony, playful, and hostile tone with confidence in range 0..1.",
}

_TONE_KEYS = ("sarcasm", "irony", "playful", "hostile")
_STATE_MAX_AGE_SECONDS = 1800
_LLM_DEADLINE_BUFFER_MS = 1200
_ENTITY_STOP_WORDS = {
    "the", "this", "that", "with", "from", "when", "then", "they", "them", "your", "you",
    "user", "assistant", "bot", "core", "scenario", "hello", "hey", "hi", "how", "what", "why",
    "where", "who", "just", "please", "thanks", "thank", "im", "i", "its", "it", "we", "us",
    "can", "could", "would", "should", "about", "something", "anything", "today", "tonight", "now",
}


def _now_iso():
    return datetime.now().isoformat()


def _debug(context, event, **details):
    logger = (context or {}).get("debug_logger")
    if logger is None:
        return
    try:
        if callable(logger):
            logger(f"empathy.{event}", **details)
            return
        if hasattr(logger, "log_event") and callable(getattr(logger, "log_event")):
            logger.log_event(f"empathy.{event}", **details)
    except Exception:
        return


def _chat_key(bot_name, chat_id):
    return f"{str(bot_name or '').strip()}::{str(chat_id or '').strip()}"


def _parse_int(value, default):
    try:
        return int(float(str(value).strip()))
    except Exception:
        return default


def _parse_float(value, default):
    try:
        return float(str(value).strip())
    except Exception:
        return default


def _clamp(value, low=0.0, high=1.0):
    number = _parse_float(value, low)
    return max(low, min(high, number))


def _safe_read_json(path):
    if not path.exists() or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _truncate(text, max_chars):
    raw = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(raw) <= max_chars:
        return raw
    cut = raw[:max_chars]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.strip()


def _estimate_tokens(text):
    raw = str(text or "")
    if not raw.strip():
        return 0
    return max(1, int(round(len(raw) / 4)))


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

    for key in ("Empathy", "empathy", "Empathy_Module", "empathy_module"):
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

    settings = dict(DEFAULT_SETTINGS)
    settings["messages_history_limit"] = max(6, min(40, _parse_int(pick("messages_history_limit"), DEFAULT_SETTINGS["messages_history_limit"])))
    settings["entity_cap"] = max(3, min(16, _parse_int(pick("entity_cap"), DEFAULT_SETTINGS["entity_cap"])))
    settings["edge_cap"] = max(2, min(24, _parse_int(pick("edge_cap"), DEFAULT_SETTINGS["edge_cap"])))
    settings["context_max_lines"] = max(4, min(20, _parse_int(pick("context_max_lines"), DEFAULT_SETTINGS["context_max_lines"])))
    settings["context_max_chars"] = max(220, min(2000, _parse_int(pick("context_max_chars"), DEFAULT_SETTINGS["context_max_chars"])))
    settings["module_max_token_budget"] = max(80, min(1200, _parse_int(pick("module_max_token_budget"), DEFAULT_SETTINGS["module_max_token_budget"])))
    settings["module_max_latency_ms"] = max(300, min(60000, _parse_int(pick("module_max_latency_ms"), DEFAULT_SETTINGS["module_max_latency_ms"])))
    settings["llm_max_tokens"] = max(80, min(700, _parse_int(pick("llm_max_tokens"), DEFAULT_SETTINGS["llm_max_tokens"])))
    settings["llm_max_retries"] = max(0, min(6, _parse_int(pick("llm_max_retries"), DEFAULT_SETTINGS["llm_max_retries"])))
    settings["edge_decay_per_turn"] = _clamp(pick("edge_decay_per_turn"), 0.0, 0.40)
    settings["tone_decay_per_turn"] = _clamp(pick("tone_decay_per_turn"), 0.0, 0.40)
    settings["ambiguity_neutral_threshold"] = _clamp(pick("ambiguity_neutral_threshold"), 0.0, 1.0)

    for key in ("question_relationship_update", "question_tone_flags"):
        value = str(pick(key, default=settings[key]) or "").strip()
        if value:
            settings[key] = value

    return settings


def _empty_state():
    return {
        "updated_at": _now_iso(),
        "entities": ["UserPersona", "Assistant"],
        "edges": [
            {
                "from": "Assistant",
                "to": "UserPersona",
                "affinity": 0.5,
                "trust": 0.5,
                "tension": 0.2,
                "notes": ["baseline"],
                "updated_at": _now_iso(),
            }
        ],
        "tone_flags": {
            key: {"score": 0.0, "confidence": 0.0} for key in _TONE_KEYS
        },
    }


def _safe_state(state):
    if not isinstance(state, dict):
        return _empty_state()

    safe = _empty_state()

    entities = state.get("entities") if isinstance(state.get("entities"), list) else []
    safe_entities = []
    for item in entities:
        text = _truncate(str(item or "").strip(), 40)
        if text and text not in safe_entities:
            safe_entities.append(text)
    if not safe_entities:
        safe_entities = ["UserPersona", "Assistant"]
    safe["entities"] = safe_entities

    edges = state.get("edges") if isinstance(state.get("edges"), list) else []
    safe_edges = []
    for row in edges:
        if not isinstance(row, dict):
            continue
        from_name = _truncate(str(row.get("from") or "").strip(), 40)
        to_name = _truncate(str(row.get("to") or "").strip(), 40)
        if not from_name or not to_name or from_name == to_name:
            continue
        safe_edges.append(
            {
                "from": from_name,
                "to": to_name,
                "affinity": _clamp(row.get("affinity"), 0.0, 1.0),
                "trust": _clamp(row.get("trust"), 0.0, 1.0),
                "tension": _clamp(row.get("tension"), 0.0, 1.0),
                "notes": _sanitize_notes(row.get("notes")),
                "updated_at": str(row.get("updated_at") or _now_iso()),
            }
        )
    if safe_edges:
        safe["edges"] = safe_edges[:24]

    tone_flags = state.get("tone_flags") if isinstance(state.get("tone_flags"), dict) else {}
    safe_tones = {}
    for key in _TONE_KEYS:
        payload = tone_flags.get(key)
        if isinstance(payload, dict):
            safe_tones[key] = {
                "score": _clamp(payload.get("score"), 0.0, 1.0),
                "confidence": _clamp(payload.get("confidence"), 0.0, 1.0),
            }
        else:
            safe_tones[key] = {"score": 0.0, "confidence": 0.0}
    safe["tone_flags"] = safe_tones
    safe["updated_at"] = str(state.get("updated_at") or _now_iso())
    return safe


def _sanitize_notes(notes):
    if not isinstance(notes, list):
        notes = [notes] if notes else []
    cleaned = []
    for item in notes:
        text = _truncate(str(item or "").strip(), 80)
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned[:4]


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


def _load_iam_messages(chat_folder, max_items=14):
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

        rows.append(
            {
                "role": role,
                "content": str(content),
                "order": order_num,
            }
        )

    rows.sort(key=lambda item: (item.get("order", 0), item.get("role", "")))
    if len(rows) > max_items:
        rows = rows[-max_items:]
    return rows


def _chat_folder_from_context(context, bot_name, chat_id):
    chat_manager = (context or {}).get("chat_manager")
    if not chat_manager or not bot_name or not chat_id:
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
    return folder


def _extract_latest_messages(messages):
    latest_user = ""
    latest_assistant = ""
    for row in reversed(messages or []):
        role = str(row.get("role") or "").strip().lower()
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        if not latest_user and role == "user":
            latest_user = content
        elif not latest_assistant and role == "assistant":
            latest_assistant = content
        if latest_user and latest_assistant:
            break
    return latest_user, latest_assistant


def _resolve_persona_context(context):
    persona_name = "User"
    persona_id = "User"
    persona_definition = ""

    chat_manager = (context or {}).get("chat_manager")
    chat_id = str((context or {}).get("chat_id") or "").strip()
    if chat_manager and chat_id and hasattr(chat_manager, "get_chat_persona"):
        try:
            stored_name = str(chat_manager.get_chat_persona(chat_id) or "").strip()
            if stored_name:
                persona_name = stored_name
        except Exception:
            pass

    persona_manager = (context or {}).get("persona_manager")
    if persona_manager and hasattr(persona_manager, "get_all_personas"):
        try:
            for candidate in persona_manager.get_all_personas() or []:
                if not isinstance(candidate, dict):
                    continue
                candidate_name = str(candidate.get("name") or "").strip()
                if not candidate_name:
                    continue
                if candidate_name.lower() != persona_name.lower():
                    continue
                persona_id = str(candidate.get("id") or persona_id or "User")
                persona_definition = _truncate(str(candidate.get("description") or "").strip(), 420)
                break
        except Exception:
            pass

    return {
        "id": persona_id or "User",
        "name": persona_name or "User",
        "definition": persona_definition,
    }


def _normalize_entity_token(value):
    token = _truncate(str(value or "").strip(), 30)
    token = re.sub(r"[^A-Za-z0-9_-]", "", token)
    if not token:
        return ""
    lowered = token.lower()
    if lowered in _ENTITY_STOP_WORDS:
        return ""
    if len(token) < 3:
        return ""
    if token.isdigit():
        return ""
    return token


def _extract_entities_from_messages(messages, cap=8, bot_name="", persona_name=""):
    base = ["UserPersona", "Assistant"]
    candidates = {}
    role_seen = {}

    known_bot = _normalize_entity_token(bot_name)
    if known_bot and known_bot not in base:
        base.append(known_bot)

    persona_token = _normalize_entity_token(persona_name)
    if persona_token and persona_token.lower() not in {"user", "userpersona"} and persona_token not in base:
        base.append(persona_token)

    user_aliases = _extract_user_self_aliases(messages)

    for row in messages or []:
        role = str(row.get("role") or "").strip().lower()
        content = str(row.get("content") or "")
        if not content:
            continue

        # Prefer explicit mentions first ("@Name") because they are usually intentional.
        explicit = re.findall(r"@([A-Za-z][A-Za-z0-9_-]{2,24})", content)
        proper = re.findall(r"\b[A-Z][a-zA-Z0-9_-]{2,24}\b", content)
        for raw in explicit + proper:
            token = _normalize_entity_token(raw)
            if not token:
                continue
            if token in {"Assistant", "UserPersona"}:
                continue
            if token.lower() in user_aliases:
                continue

            candidates[token] = int(candidates.get(token) or 0) + 1
            seen = role_seen.setdefault(token, set())
            if role:
                seen.add(role)

    scored = []
    for token, count in candidates.items():
        roles = role_seen.get(token, set())
        cross_role = len(roles) >= 2
        is_known = token == known_bot or token == persona_token
        if not (is_known or count >= 2 or cross_role):
            continue

        # Score for ordering and cap selection.
        score = float(count)
        if cross_role:
            score += 1.6
        if is_known:
            score += 2.0
        scored.append((score, token))

    scored.sort(key=lambda row: row[0], reverse=True)
    for _, token in scored:
        if token not in base:
            base.append(token)
        if len(base) >= cap:
            break

    return base[:cap]


def _extract_user_self_aliases(messages):
    aliases = set()
    patterns = (
        r"\bi\s+am\s+([A-Za-z][A-Za-z0-9_-]{1,24})\b",
        r"\bi\'m\s+([A-Za-z][A-Za-z0-9_-]{1,24})\b",
        r"\bmy\s+name\s+is\s+([A-Za-z][A-Za-z0-9_-]{1,24})\b",
        r"\bcall\s+me\s+([A-Za-z][A-Za-z0-9_-]{1,24})\b",
    )
    for row in messages or []:
        role = str(row.get("role") or "").strip().lower()
        if role != "user":
            continue
        content = str(row.get("content") or "")
        if not content:
            continue
        lower = content.lower()
        for pattern in patterns:
            for match in re.findall(pattern, lower):
                token = _normalize_entity_token(match)
                if token:
                    aliases.add(token.lower())
    return aliases


def _entity_mentions(messages, entity_name):
    token = str(entity_name or "").strip()
    if not token:
        return 0
    pattern = re.compile(rf"\b{re.escape(token)}\b")
    total = 0
    for row in messages or []:
        content = str(row.get("content") or "")
        if not content:
            continue
        total += len(pattern.findall(content))
    return total


def _tone_signal(text):
    raw = str(text or "")
    if not raw.strip():
        return {key: {"score": 0.0, "confidence": 0.0} for key in _TONE_KEYS}

    lower = raw.lower()
    exclamations = min(4, lower.count("!"))

    sarcasm_hits = sum(1 for token in ("yeah right", "sure", "as if", "obviously", "totally") if token in lower)
    irony_hits = sum(1 for token in ("ironically", "how convenient", "what a surprise", "just great") if token in lower)
    playful_hits = sum(1 for token in ("haha", "lol", "tease", "play", "fun", ":)", ";)") if token in lower)
    hostile_hits = sum(1 for token in ("hate", "stupid", "idiot", "annoying", "shut up", "leave me") if token in lower)

    sarcasm = _clamp((sarcasm_hits * 0.32) + (0.06 * exclamations), 0.0, 1.0)
    irony = _clamp((irony_hits * 0.34) + (0.04 * exclamations), 0.0, 1.0)
    playful = _clamp((playful_hits * 0.22) + (0.03 * exclamations), 0.0, 1.0)
    hostile = _clamp((hostile_hits * 0.36) + (0.05 * exclamations), 0.0, 1.0)

    return {
        "sarcasm": {"score": sarcasm, "confidence": _clamp(0.2 + sarcasm, 0.0, 1.0)},
        "irony": {"score": irony, "confidence": _clamp(0.2 + irony, 0.0, 1.0)},
        "playful": {"score": playful, "confidence": _clamp(0.2 + playful, 0.0, 1.0)},
        "hostile": {"score": hostile, "confidence": _clamp(0.2 + hostile, 0.0, 1.0)},
    }


def _decay_state(state, settings):
    safe = _safe_state(state)
    edge_decay = float(settings.get("edge_decay_per_turn") or 0.0)
    tone_decay = float(settings.get("tone_decay_per_turn") or 0.0)

    for row in safe.get("edges") or []:
        row["affinity"] = _clamp(float(row.get("affinity") or 0.0) * (1.0 - edge_decay), 0.0, 1.0)
        row["trust"] = _clamp(float(row.get("trust") or 0.0) * (1.0 - edge_decay), 0.0, 1.0)
        row["tension"] = _clamp(float(row.get("tension") or 0.0) * (1.0 - edge_decay), 0.0, 1.0)

    for key in _TONE_KEYS:
        payload = safe["tone_flags"].get(key) if isinstance(safe.get("tone_flags"), dict) else None
        if not isinstance(payload, dict):
            payload = {"score": 0.0, "confidence": 0.0}
            safe["tone_flags"][key] = payload
        payload["score"] = _clamp(float(payload.get("score") or 0.0) * (1.0 - tone_decay), 0.0, 1.0)
        payload["confidence"] = _clamp(float(payload.get("confidence") or 0.0) * (1.0 - tone_decay * 0.6), 0.0, 1.0)

    safe["updated_at"] = _now_iso()
    return safe


def _find_edge(edges, from_name, to_name):
    for row in edges:
        if str(row.get("from") or "") == from_name and str(row.get("to") or "") == to_name:
            return row
    return None


def _apply_fallback_update(state, messages, settings, bot_name="", persona_name=""):
    safe = _safe_state(state)
    entities = _extract_entities_from_messages(
        messages,
        cap=int(settings.get("entity_cap") or 8),
        bot_name=bot_name,
        persona_name=persona_name,
    )
    safe["entities"] = entities[: int(settings.get("entity_cap") or 8)]

    latest_user, latest_assistant = _extract_latest_messages(messages)
    tone = _tone_signal(latest_user or latest_assistant)

    # Bias for neutral interpretation under sparse/ambiguous cues.
    ambiguity = 1.0 - max(
        float(tone["sarcasm"].get("score") or 0.0),
        float(tone["irony"].get("score") or 0.0),
        float(tone["playful"].get("score") or 0.0),
        float(tone["hostile"].get("score") or 0.0),
    )
    if ambiguity >= float(settings.get("ambiguity_neutral_threshold") or 0.70):
        for key in _TONE_KEYS:
            tone[key]["score"] *= 0.55
            tone[key]["confidence"] *= 0.55

    safe["tone_flags"] = tone

    playful_score = float(tone["playful"].get("score") or 0.0)
    hostile_score = float(tone["hostile"].get("score") or 0.0)
    sarcasm_score = float(tone["sarcasm"].get("score") or 0.0)

    affinity_delta = (playful_score * 0.10) - (hostile_score * 0.12)
    trust_delta = (playful_score * 0.08) - (sarcasm_score * 0.04) - (hostile_score * 0.10)
    tension_delta = (hostile_score * 0.14) + (sarcasm_score * 0.05) - (playful_score * 0.06)

    def ensure_edge(from_name, to_name):
        row = _find_edge(safe.get("edges") or [], from_name, to_name)
        if row is not None:
            return row
        row = {
            "from": from_name,
            "to": to_name,
            "affinity": 0.5,
            "trust": 0.5,
            "tension": 0.2,
            "notes": [],
            "updated_at": _now_iso(),
        }
        safe.setdefault("edges", []).append(row)
        return row

    def apply_edge_shift(edge_row, scale=1.0, note_prefix=""):
        edge_row["affinity"] = _clamp(float(edge_row.get("affinity") or 0.0) + (affinity_delta * scale), 0.0, 1.0)
        edge_row["trust"] = _clamp(float(edge_row.get("trust") or 0.0) + (trust_delta * scale), 0.0, 1.0)
        edge_row["tension"] = _clamp(float(edge_row.get("tension") or 0.0) + (tension_delta * scale), 0.0, 1.0)

        notes = []
        if playful_score >= 0.35:
            notes.append("playful tone detected")
        if sarcasm_score >= 0.30:
            notes.append("possible sarcasm")
        if hostile_score >= 0.25:
            notes.append("raised tension")
        if not notes:
            notes.append("neutral continuity")
        if note_prefix:
            notes = [f"{note_prefix}: {item}" for item in notes]

        edge_row["notes"] = _sanitize_notes((edge_row.get("notes") or []) + notes)
        edge_row["updated_at"] = _now_iso()

    # Always keep primary assistant<->user relationship updated.
    main_edge = ensure_edge("Assistant", "UserPersona")
    apply_edge_shift(main_edge, scale=1.0)

    # Multi-character fallback: update per-entity edges when roleplay participants are detected.
    participants = [
        item for item in (safe.get("entities") or [])
        if item not in {"UserPersona", "Assistant"}
    ]

    persona_aliases = _extract_user_self_aliases(messages)
    normalized_persona_name = _normalize_entity_token(persona_name)
    if normalized_persona_name:
        persona_aliases.add(normalized_persona_name.lower())

    for entity_name in participants:
        if str(entity_name or "").strip().lower() in persona_aliases:
            continue
        mentions = _entity_mentions(messages, entity_name)
        # Mild scaling: entities mentioned more often receive stronger updates.
        scale = 0.45 + min(0.55, 0.08 * float(mentions))
        char_to_user = ensure_edge(entity_name, "UserPersona")
        assistant_to_char = ensure_edge("Assistant", entity_name)
        apply_edge_shift(char_to_user, scale=scale, note_prefix=entity_name)
        apply_edge_shift(assistant_to_char, scale=max(0.35, scale * 0.8), note_prefix=entity_name)

    safe["edges"] = (safe.get("edges") or [])[: int(settings.get("edge_cap") or 12)]
    safe["updated_at"] = _now_iso()

    return {
        "state": safe,
        "llm_used": False,
        "ambiguity": _clamp(ambiguity, 0.0, 1.0),
        "fallback_used": True,
    }


def _extract_json_object(text):
    raw = str(text or "").strip()
    if not raw:
        return None

    if raw.startswith("```"):
        raw = raw.strip("`\n ")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        candidate = raw[start: end + 1]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


def _normalize_llm_tones(value):
    if not isinstance(value, dict):
        return {key: {"score": 0.0, "confidence": 0.0} for key in _TONE_KEYS}

    out = {}
    for key in _TONE_KEYS:
        payload = value.get(key)
        if isinstance(payload, dict):
            score = _clamp(payload.get("score"), 0.0, 1.0)
            confidence = _clamp(payload.get("confidence"), 0.0, 1.0)
        else:
            score = _clamp(payload, 0.0, 1.0)
            confidence = _clamp(0.25 + score, 0.0, 1.0)
        out[key] = {"score": score, "confidence": confidence}
    return out


def _normalize_llm_updates(parsed):
    if not isinstance(parsed, dict):
        return None

    entities = parsed.get("entities") if isinstance(parsed.get("entities"), list) else []
    entity_rows = []
    for item in entities:
        text = _truncate(str(item or "").strip(), 40)
        if text and text not in entity_rows:
            entity_rows.append(text)

    updates = parsed.get("edge_updates") if isinstance(parsed.get("edge_updates"), list) else []
    edge_updates = []
    for row in updates:
        if not isinstance(row, dict):
            continue
        from_name = _truncate(str(row.get("from") or "").strip(), 40)
        to_name = _truncate(str(row.get("to") or "").strip(), 40)
        if not from_name or not to_name or from_name == to_name:
            continue
        edge_updates.append(
            {
                "from": from_name,
                "to": to_name,
                "affinity_delta": _clamp(row.get("affinity_delta"), -0.35, 0.35),
                "trust_delta": _clamp(row.get("trust_delta"), -0.35, 0.35),
                "tension_delta": _clamp(row.get("tension_delta"), -0.35, 0.35),
                "notes": _sanitize_notes(row.get("notes")),
            }
        )

    tones = _normalize_llm_tones(parsed.get("tone_flags"))
    ambiguity = _clamp(parsed.get("ambiguity"), 0.0, 1.0)
    return {
        "entities": entity_rows,
        "edge_updates": edge_updates,
        "tone_flags": tones,
        "ambiguity": ambiguity,
    }


def _build_compact_state_for_llm(state):
    safe = _safe_state(state)
    edges = list(safe.get("edges") or [])
    edges.sort(
        key=lambda item: (
            float(item.get("trust") or 0.0) +
            float(item.get("affinity") or 0.0) +
            float(item.get("tension") or 0.0)
        ),
        reverse=True,
    )
    compact_edges = []
    for row in edges[:6]:
        compact_edges.append(
            {
                "from": str(row.get("from") or ""),
                "to": str(row.get("to") or ""),
                "affinity": round(_clamp(row.get("affinity"), 0.0, 1.0), 3),
                "trust": round(_clamp(row.get("trust"), 0.0, 1.0), 3),
                "tension": round(_clamp(row.get("tension"), 0.0, 1.0), 3),
                "notes": list((row.get("notes") or [])[:2]),
            }
        )

    tones = {}
    tone_flags = safe.get("tone_flags") if isinstance(safe.get("tone_flags"), dict) else {}
    for key in _TONE_KEYS:
        payload = tone_flags.get(key) if isinstance(tone_flags.get(key), dict) else {}
        tones[key] = {
            "score": round(_clamp(payload.get("score"), 0.0, 1.0), 3),
            "confidence": round(_clamp(payload.get("confidence"), 0.0, 1.0), 3),
        }

    return {
        "updated_at": str(safe.get("updated_at") or ""),
        "entities": list((safe.get("entities") or [])[:10]),
        "edges": compact_edges,
        "tone_flags": tones,
    }


def _llm_update(context, settings, state, messages, latest_user, latest_assistant, timeout_ms=None):
    prompt_pipeline = (context or {}).get("prompt_pipeline")
    settings_manager = (context or {}).get("settings_manager")
    bot_manager = (context or {}).get("bot_manager")
    bot_name = str((context or {}).get("bot_name") or "").strip()
    if not prompt_pipeline or not settings_manager or not bot_manager or not bot_name:
        return None
    if not hasattr(prompt_pipeline, "_build_request_payload") or not hasattr(prompt_pipeline, "_request_completion"):
        return None

    bot = bot_manager.load_bot(bot_name) if bot_manager else {}
    core_data = _truncate(str((bot or {}).get("core_data") or ""), 220)
    scenario_data = _truncate(str((bot or {}).get("scenario_data") or ""), 220)

    history_rows = []
    for row in (messages or [])[-6:]:
        role = str(row.get("role") or "").strip().upper()
        content = _truncate(str(row.get("content") or ""), 180)
        if not role or not content:
            continue
        history_rows.append(f"{role}: {content}")

    question_block = f"- {settings['question_relationship_update']}\n- {settings['question_tone_flags']}"

    persona_context = _resolve_persona_context(context)
    compact_state = _build_compact_state_for_llm(state)

    messages_payload = [
        {
            "role": "system",
            "content": (
                "You are an internal empathy tracker for roleplay continuity. "
                "Return strict JSON only, no markdown, no prose. "
                "Schema: {entities:string[], edge_updates:[{from,to,affinity_delta,trust_delta,tension_delta,notes:string[]}], "
                "tone_flags:{sarcasm:{score,confidence},irony:{score,confidence},playful:{score,confidence},hostile:{score,confidence}}, ambiguity:number}. "
                "All score/confidence/ambiguity fields are 0..1. "
                "Use conservative updates when evidence is weak."
            ),
        },
        {
            "role": "user",
            "content": (
                "Update empathy state for this turn.\n"
                f"Questions:\n{question_block}\n\n"
                f"Latest user message:\n{_truncate(latest_user, 420)}\n\n"
                f"Latest assistant message:\n{_truncate(latest_assistant, 420)}\n\n"
                f"Persona identity:\n"
                f"- persona_name: {_truncate(persona_context.get('name') or 'User', 80)}\n"
                f"- persona_id: {_truncate(persona_context.get('id') or 'User', 80)}\n\n"
                f"Persona definition:\n{_truncate(persona_context.get('definition') or '(none)', 420)}\n\n"
                f"Recent history:\n{chr(10).join(history_rows) if history_rows else '(none)'}\n\n"
                f"Bot core reminder:\n{core_data or '(none)'}\n\n"
                f"Scenario reminder:\n{scenario_data or '(none)'}\n\n"
                f"Current state JSON:\n{json.dumps(compact_state, ensure_ascii=False)}"
            ),
        },
    ]

    all_settings = settings_manager.get_all() if hasattr(settings_manager, "get_all") else {}
    payload = prompt_pipeline._build_request_payload(all_settings, messages_payload)
    payload["max_tokens"] = int(settings.get("llm_max_tokens") or 220)

    max_retries = int(settings.get("llm_max_retries") or 0)
    call_timeout_ms = int(timeout_ms or settings.get("module_max_latency_ms") or 2600)
    call_timeout_ms = max(500, call_timeout_ms)
    effective_deadline_ms = max(900, call_timeout_ms - int(_LLM_DEADLINE_BUFFER_MS))

    # Hard deadline to enforce module max latency. This prevents retry storms.
    deadline = time.monotonic() + (effective_deadline_ms / 1000.0)

    request_once = None
    if hasattr(prompt_pipeline, "_request_completion_attempt_cancellable"):
        request_once = lambda cfg, pld: prompt_pipeline._request_completion_attempt_cancellable(
            settings=cfg,
            payload=pld,
            cancel_check=None,
        )
    elif hasattr(prompt_pipeline, "_request_completion_attempt"):
        request_once = lambda cfg, pld: prompt_pipeline._request_completion_attempt(settings=cfg, payload=pld)
    elif hasattr(prompt_pipeline, "_request_completion"):
        request_once = lambda cfg, pld: prompt_pipeline._request_completion(settings=cfg, payload=pld)
    else:
        return None

    attempt = 0
    while attempt <= max_retries:
        remaining_ms = int((deadline - time.monotonic()) * 1000)
        if remaining_ms < 350:
            _debug(context, "llm_skipped_deadline", remaining_ms=max(0, remaining_ms))
            break

        attempt += 1
        attempt_payload = dict(payload)
        attempt_payload["request_timeout_seconds"] = max(1.0, min(remaining_ms / 1000.0, 12.0))
        text, error = request_once(all_settings, attempt_payload)
        if error and ("timeout" in str(error).lower() or "timed out" in str(error).lower()):
            timeout_seconds = float(attempt_payload["request_timeout_seconds"])
            _debug(
                context,
                "llm_timeout",
                timeout_seconds=round(timeout_seconds, 3),
                timeout_ms=int(round(timeout_seconds * 1000.0)),
                attempt=attempt,
            )
        elif error:
            _debug(
                context,
                "llm_error",
                attempt=attempt,
                error=_truncate(str(error), 180),
            )
        if error or not text:
            # Tiny cooldown to avoid hammering overloaded local endpoints.
            if attempt <= max_retries:
                time.sleep(0.12)
            continue

        parsed = _extract_json_object(text)
        normalized = _normalize_llm_updates(parsed)
        if normalized:
            return normalized
        _debug(
            context,
            "llm_parse_failed",
            attempt=attempt,
            response_preview=_truncate(text, 260),
        )

    return None


def _apply_llm_update_to_state(base_state, llm_update, settings):
    safe = _safe_state(base_state)
    entities = safe.get("entities") if isinstance(safe.get("entities"), list) else []

    for item in llm_update.get("entities") or []:
        if item not in entities:
            entities.append(item)

    if "UserPersona" not in entities:
        entities.insert(0, "UserPersona")
    if "Assistant" not in entities:
        entities.append("Assistant")
    safe["entities"] = entities[: int(settings.get("entity_cap") or 8)]

    ambiguity = _clamp(llm_update.get("ambiguity"), 0.0, 1.0)
    neutral_threshold = float(settings.get("ambiguity_neutral_threshold") or 0.70)
    neutral_scale = 0.50 if ambiguity >= neutral_threshold else 1.0

    for update in llm_update.get("edge_updates") or []:
        from_name = str(update.get("from") or "")
        to_name = str(update.get("to") or "")
        if not from_name or not to_name or from_name == to_name:
            continue

        edge = _find_edge(safe.get("edges") or [], from_name, to_name)
        if edge is None:
            edge = {
                "from": from_name,
                "to": to_name,
                "affinity": 0.5,
                "trust": 0.5,
                "tension": 0.2,
                "notes": [],
                "updated_at": _now_iso(),
            }
            safe.setdefault("edges", []).append(edge)

        edge["affinity"] = _clamp(float(edge.get("affinity") or 0.0) + (float(update.get("affinity_delta") or 0.0) * neutral_scale), 0.0, 1.0)
        edge["trust"] = _clamp(float(edge.get("trust") or 0.0) + (float(update.get("trust_delta") or 0.0) * neutral_scale), 0.0, 1.0)
        edge["tension"] = _clamp(float(edge.get("tension") or 0.0) + (float(update.get("tension_delta") or 0.0) * neutral_scale), 0.0, 1.0)
        edge["notes"] = _sanitize_notes((edge.get("notes") or []) + (update.get("notes") or []))
        edge["updated_at"] = _now_iso()

    safe["edges"] = (safe.get("edges") or [])[: int(settings.get("edge_cap") or 12)]

    tone_flags = llm_update.get("tone_flags") if isinstance(llm_update.get("tone_flags"), dict) else {}
    for key in _TONE_KEYS:
        current = safe["tone_flags"].get(key) if isinstance(safe.get("tone_flags"), dict) else None
        if not isinstance(current, dict):
            current = {"score": 0.0, "confidence": 0.0}
            safe["tone_flags"][key] = current

        incoming = tone_flags.get(key) if isinstance(tone_flags.get(key), dict) else {}
        score = _clamp(incoming.get("score"), 0.0, 1.0) * neutral_scale
        confidence = _clamp(incoming.get("confidence"), 0.0, 1.0) * neutral_scale

        current["score"] = _clamp((float(current.get("score") or 0.0) * 0.45) + (score * 0.55), 0.0, 1.0)
        current["confidence"] = _clamp((float(current.get("confidence") or 0.0) * 0.35) + (confidence * 0.65), 0.0, 1.0)

    safe["updated_at"] = _now_iso()
    return {
        "state": safe,
        "ambiguity": ambiguity,
        "llm_used": True,
        "fallback_used": False,
    }


def _compose_context_snippet(state, settings):
    safe = _safe_state(state)
    lines = ["Empathy Snapshot (Internal / Do Not Output)"]

    edges = list(safe.get("edges") or [])
    edges.sort(key=lambda item: max(
        float(item.get("tension") or 0.0),
        float(item.get("trust") or 0.0),
        float(item.get("affinity") or 0.0),
    ), reverse=True)

    for row in edges[:4]:
        lines.append(
            "- rel: {from_name}->{to_name} | affinity={affinity:.2f}, trust={trust:.2f}, tension={tension:.2f}".format(
                from_name=str(row.get("from") or "?"),
                to_name=str(row.get("to") or "?"),
                affinity=float(row.get("affinity") or 0.0),
                trust=float(row.get("trust") or 0.0),
                tension=float(row.get("tension") or 0.0),
            )
        )
        notes = row.get("notes") if isinstance(row.get("notes"), list) else []
        if notes:
            lines.append(f"  note: {_truncate('; '.join([str(n) for n in notes[:2]]), 120)}")

    tones = safe.get("tone_flags") if isinstance(safe.get("tone_flags"), dict) else {}
    tone_bits = []
    for key in _TONE_KEYS:
        payload = tones.get(key) if isinstance(tones.get(key), dict) else {}
        score = _clamp(payload.get("score"), 0.0, 1.0)
        confidence = _clamp(payload.get("confidence"), 0.0, 1.0)
        tone_bits.append(f"{key}={score:.2f}@{confidence:.2f}")
    lines.append("- tone: " + ", ".join(tone_bits))

    max_lines = int(settings.get("context_max_lines") or 10)
    trimmed = lines[:max_lines]
    joined = "\n".join(trimmed)
    return _truncate(joined, int(settings.get("context_max_chars") or 900))


def _state_digest(state):
    safe = _safe_state(state)
    edges = list(safe.get("edges") or [])
    edges.sort(
        key=lambda item: (
            float(item.get("trust") or 0.0) +
            float(item.get("affinity") or 0.0) +
            float(item.get("tension") or 0.0)
        ),
        reverse=True,
    )
    top_edges = []
    for row in edges[:3]:
        top_edges.append(
            {
                "from": str(row.get("from") or ""),
                "to": str(row.get("to") or ""),
                "affinity": round(float(row.get("affinity") or 0.0), 3),
                "trust": round(float(row.get("trust") or 0.0), 3),
                "tension": round(float(row.get("tension") or 0.0), 3),
                "notes": list((row.get("notes") or [])[:2]),
            }
        )

    tone_flags = safe.get("tone_flags") if isinstance(safe.get("tone_flags"), dict) else {}
    tones = {}
    for key in _TONE_KEYS:
        payload = tone_flags.get(key) if isinstance(tone_flags.get(key), dict) else {}
        tones[key] = {
            "score": round(_clamp(payload.get("score"), 0.0, 1.0), 3),
            "confidence": round(_clamp(payload.get("confidence"), 0.0, 1.0), 3),
        }

    return {
        "entity_count": len(safe.get("entities") or []),
        "edge_count": len(edges),
        "top_edges": top_edges,
        "tone_flags": tones,
    }


def _set_status(chat_key, payload):
    with _LOCK:
        _STATUS_BY_CHAT[chat_key] = dict(payload or {})
        _STATUS_BY_CHAT[chat_key]["updated_at"] = _now_iso()


def _get_status(chat_key):
    with _LOCK:
        value = _STATUS_BY_CHAT.get(chat_key)
        return dict(value or {})


def _set_state(chat_key, state):
    with _LOCK:
        _STATE_BY_CHAT[chat_key] = _safe_state(state)


def _get_state(chat_key):
    with _LOCK:
        state = _STATE_BY_CHAT.get(chat_key)

    safe = _safe_state(state)

    updated_at = str(safe.get("updated_at") or "").strip()
    age_seconds = _STATE_MAX_AGE_SECONDS + 1
    if updated_at:
        try:
            age_seconds = (datetime.now() - datetime.fromisoformat(updated_at)).total_seconds()
        except Exception:
            age_seconds = _STATE_MAX_AGE_SECONDS + 1

    if age_seconds > _STATE_MAX_AGE_SECONDS:
        return _empty_state()

    return safe


def _resolve_module_prompt_key(prompt_order, module_name="Empathy"):
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
                key = _resolve_module_prompt_key(prompt_order, module_name="Empathy")
                if key and key in sections:
                    active_context = module_context if isinstance(module_context, dict) else {}
                    debug_context = dict(context or {})
                    debug_context.update(active_context)
                    bot_name = active_context.get("bot_name")
                    chat_id = active_context.get("chat_id")
                    chat_key = _chat_key(bot_name, chat_id)
                    state = _get_state(chat_key)
                    live_settings = _normalize_settings(_load_bot_module_settings(context, bot_name))
                    snippet = _compose_context_snippet(state, live_settings)
                    token_budget = int(live_settings.get("module_max_token_budget") or DEFAULT_SETTINGS["module_max_token_budget"])
                    if _estimate_tokens(snippet) > token_budget:
                        snippet = _truncate(snippet, max(220, int(live_settings.get("context_max_chars") or 900) // 2))
                    if snippet:
                        sections[key] = f"{sections[key]}\n\n{snippet}"
                        _debug(
                            debug_context,
                            "injected_into_prompt",
                            bot_name=bot_name,
                            chat_id=chat_id,
                            prompt_key=key,
                            injected_token_estimate=_estimate_tokens(snippet),
                            injected_chars=len(snippet),
                        )
            except Exception:
                return sections
            return sections

        setattr(prompt_pipeline, "_build_module_sections", wrapped_build_module_sections)
        _PATCHED_PIPELINES.add(pipeline_id)


def _status_payload(chat_key, bot_name, chat_id):
    status_data = _get_status(chat_key)
    if not status_data:
        status_data = {
            "success": True,
            "processing": False,
            "message": "Trying to understand stuff",
            "thinking_output": "",
            "module_name": "Empathy",
            "bot_name": bot_name,
            "chat_id": chat_id,
        }

    state = _get_state(chat_key)
    status_data["state"] = state
    status_data["context_preview"] = _compose_context_snippet(state, DEFAULT_SETTINGS)
    status_data["bot_name"] = bot_name
    status_data["chat_id"] = chat_id
    status_data["module_name"] = "Empathy"
    status_data["success"] = True
    return status_data


def _execute(context):
    context = context or {}
    _install_prompt_patch(context)

    bot_name = str(context.get("bot_name") or "").strip()
    chat_id = str(context.get("chat_id") or "").strip()
    if not bot_name or not chat_id:
        return

    chat_key = _chat_key(bot_name, chat_id)

    with _LOCK:
        if chat_key in _ACTIVE_RUNS:
            _debug(context, "run_skip_already_active", bot_name=bot_name, chat_id=chat_id)
            return
        _ACTIVE_RUNS.add(chat_key)

    started = time.monotonic()
    report_progress = context.get("report_progress") if isinstance(context, dict) else None
    _set_status(
        chat_key,
        {
            "success": True,
            "processing": True,
            "message": "Trying to understand stuff",
            "thinking_output": "Analyzing relationship cues and tone from recent chat.",
            "module_name": "Empathy",
            "bot_name": bot_name,
            "chat_id": chat_id,
        },
    )
    if callable(report_progress):
        try:
            report_progress(
                phase="update",
                text="Trying to understand stuff",
                thinking_output="Analyzing relationship cues and tone from recent chat.",
            )
        except Exception:
            pass
    _debug(
        context,
        "triggered",
        bot_name=bot_name,
        chat_id=chat_id,
        trigger_target=str((context or {}).get("target") or "main"),
        extension_file=str((context or {}).get("extension_file") or ""),
    )
    _debug(context, "run_start", bot_name=bot_name, chat_id=chat_id)

    try:
        settings = _normalize_settings(_load_bot_module_settings(context, bot_name))
        persona_context = _resolve_persona_context(context)
        chat_folder = _chat_folder_from_context(context, bot_name, chat_id)
        messages = _load_iam_messages(chat_folder, max_items=int(settings.get("messages_history_limit") or 14)) if chat_folder else []
        latest_user, latest_assistant = _extract_latest_messages(messages)

        if not messages:
            _debug(
                context,
                "run_skip_no_messages",
                bot_name=bot_name,
                chat_id=chat_id,
            )
        elif not (latest_user or latest_assistant):
            _debug(
                context,
                "run_skip_no_latest_message",
                bot_name=bot_name,
                chat_id=chat_id,
                loaded_message_count=len(messages),
            )

        state = _get_state(chat_key)
        state = _decay_state(state, settings)

        module_elapsed = int((time.monotonic() - started) * 1000)
        max_latency_ms = int(settings.get("module_max_latency_ms") or 2600)
        remaining_ms = max(250, max_latency_ms - module_elapsed)

        llm_result = None
        if latest_user or latest_assistant:
            llm_update = _llm_update(
                context=context,
                settings=settings,
                state=state,
                messages=messages,
                latest_user=latest_user,
                latest_assistant=latest_assistant,
                timeout_ms=remaining_ms,
            )
            if llm_update:
                llm_result = _apply_llm_update_to_state(state, llm_update, settings)

        if not llm_result:
            llm_result = _apply_fallback_update(
                state,
                messages,
                settings,
                bot_name=bot_name,
                persona_name=str(persona_context.get("name") or "User"),
            )

        next_state = _safe_state(llm_result.get("state"))
        snippet = _compose_context_snippet(next_state, settings)
        token_estimate = _estimate_tokens(snippet)
        if token_estimate > int(settings.get("module_max_token_budget") or 260):
            snippet = _truncate(snippet, max(220, int(settings.get("context_max_chars") or 900) // 2))
            token_estimate = _estimate_tokens(snippet)

        _set_state(chat_key, next_state)

        duration_ms = int((time.monotonic() - started) * 1000)
        _set_status(
            chat_key,
            {
                "success": True,
                "processing": False,
                "message": "Trying to understand stuff",
                "thinking_output": snippet,
                "module_name": "Empathy",
                "bot_name": bot_name,
                "chat_id": chat_id,
                "llm_used": bool(llm_result.get("llm_used")),
                "fallback_used": bool(llm_result.get("fallback_used")),
                "ambiguity": _clamp(llm_result.get("ambiguity"), 0.0, 1.0),
                "duration_ms": duration_ms,
                "token_estimate": token_estimate,
            },
        )
        if callable(report_progress):
            try:
                report_progress(
                    phase="update",
                    text="Trying to understand stuff",
                    thinking_output=snippet,
                )
            except Exception:
                pass

        _debug(
            context,
            "run_success",
            bot_name=bot_name,
            chat_id=chat_id,
            llm_used=bool(llm_result.get("llm_used")),
            fallback_used=bool(llm_result.get("fallback_used")),
            ambiguity=_clamp(llm_result.get("ambiguity"), 0.0, 1.0),
            duration_ms=duration_ms,
            token_estimate=token_estimate,
        )
        _debug(
            context,
            "output",
            bot_name=bot_name,
            chat_id=chat_id,
            llm_used=bool(llm_result.get("llm_used")),
            fallback_used=bool(llm_result.get("fallback_used")),
            empathy_output=_truncate(snippet, 500),
            state_digest=_state_digest(next_state),
        )
    except Exception as exc:
        duration_ms = int((time.monotonic() - started) * 1000)
        _set_status(
            chat_key,
            {
                "success": False,
                "processing": False,
                "message": "Trying to understand stuff",
                "thinking_output": "",
                "module_name": "Empathy",
                "bot_name": bot_name,
                "chat_id": chat_id,
                "error": str(exc),
                "duration_ms": duration_ms,
            },
        )
        if callable(report_progress):
            try:
                report_progress(
                    phase="update",
                    text="Trying to understand stuff",
                    thinking_output="",
                )
            except Exception:
                pass
        _debug(context, "run_fail", bot_name=bot_name, chat_id=chat_id, error=str(exc), duration_ms=duration_ms)
    finally:
        with _LOCK:
            _ACTIVE_RUNS.discard(chat_key)


def _resolve_action_context(action_context, payload):
    context = action_context if isinstance(action_context, dict) else {}
    body = payload if isinstance(payload, dict) else {}
    bot_name = str(body.get("bot_name") or context.get("bot_name") or "").strip()
    chat_id = str(body.get("chat_id") or context.get("chat_id") or "").strip()
    return context, body, bot_name, chat_id


def _handle_action(action=None, payload=None, context=None):
    action_name = str(action or "").strip().lower()
    context, body, bot_name, chat_id = _resolve_action_context(context, payload)
    if not bot_name or not chat_id:
        return {"success": False, "message": "Missing bot_name or chat_id"}

    try:
        _install_prompt_patch(context or {})
    except Exception:
        pass

    chat_key = _chat_key(bot_name, chat_id)

    if action_name in {"status", "health", "get", "fetch"}:
        return _status_payload(chat_key, bot_name, chat_id)

    if action_name in {"force_run", "run"}:
        _execute(context)
        return _status_payload(chat_key, bot_name, chat_id)

    if action_name in {"reset", "clear_state"}:
        _set_state(chat_key, _empty_state())
        payload = _status_payload(chat_key, bot_name, chat_id)
        payload["message"] = "Empathy state reset"
        return payload

    return {"success": False, "message": f"Unknown action: {action_name}"}


def handle_action(action=None, payload=None, context=None):
    return _handle_action(action=action, payload=payload, context=context)
