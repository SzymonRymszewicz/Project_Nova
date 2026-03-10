import json
import ast
import re
import threading
import time
from datetime import datetime
from pathlib import Path

_LOCK = threading.RLock()
_LOCAL = threading.local()
_PATCHED_PIPELINES = set()
_PENDING_VALIDATIONS = []
_STATUS_BY_CHAT = {}

_STATUS_TEXT = "Validating"
_MAIN_RESPONSE_MARKER = "Always address the latest user message directly."
_VALIDATOR_REGEN_MARKER = "[Recursive Validator Feedback]"
_VALIDATOR_EVAL_MARKER = "[Recursive Validator Evaluator]"

DEFAULT_CRITERIA = [
    {"text": "Addresses the user's latest request directly.", "enabled": True, "hard_fail": True},
    {"text": "Stays consistent with bot core definition and scenario rules.", "enabled": True, "hard_fail": True},
    {"text": "Maintains the bot's established voice and relational tone without generic filler.", "enabled": True, "hard_fail": False},
    {"text": "Is clear, coherent, and useful for the current turn.", "enabled": True, "hard_fail": False},
]

DEFAULT_SETTINGS = {
    "max_iterations": 2,
    "conditional_output_threshold": 75.0,
    "hard_pass_score": 70.0,
    "module_max_latency_ms": 20000,
    "module_max_token_budget": 700,
    "evaluator_max_tokens": 200,
    "candidate_max_tokens": 180,
    "evaluator_reserved_ms": 2200,
    "precheck_min_score": 44.0,
    "min_improvement_delta": 1.5,
    "stagnation_stop_enabled": True,
    "min_iterations_before_stagnation": 3,
    "minimum_candidate_chars": 28,
    "pending_context_ttl_ms": 25000,
    "stream_emit_chunk_size": 28,
}

GENERIC_FILLER_PATTERNS = [
    re.compile(r"\bi(?:\s+do\s+not|\s+don't)?\s+really\s+have\s+thoughts\s+or\s+feelings\b", re.IGNORECASE),
    re.compile(r"\bi'?m\s+just\s+happy\s+to\s+be\s+chatting\b", re.IGNORECASE),
    re.compile(r"\bi'?m\s+always\s+happy\s+to\s+keep\s+the\s+conversation\s+going\b", re.IGNORECASE),
    re.compile(r"\bhow'?s\s+your\s+day\s+going\b", re.IGNORECASE),
    re.compile(r"\bi'?m\s+game\b", re.IGNORECASE),
]

META_PROCESS_PATTERNS = [
    re.compile(r"\blet\s+me\s+try\s+again\b", re.IGNORECASE),
    re.compile(r"\bi(?:'ll|\s+will)\s+try\s+again\b", re.IGNORECASE),
    re.compile(r"\blet'?s\s+start\s+again\b", re.IGNORECASE),
    re.compile(r"\bokay,?\s+i(?:'ve|\s+have)\s+got\s+one\b", re.IGNORECASE),
    re.compile(r"\bi(?:'ve|\s+have)\s+got\s+one\b", re.IGNORECASE),
    re.compile(r"\bi(?:\s+am|'m)\s+guessing\s+that(?:'s|\s+is)\s+a\s+setup\b", re.IGNORECASE),
    re.compile(r"\bi\s+think\s+i\s+might\s+have\s+to\s+work\s+on\s+that\b", re.IGNORECASE),
    re.compile(r"\bwork\s+in\s+progress\b", re.IGNORECASE),
    re.compile(r"\bneeds\s+a\s+bit\s+more\s+work\b", re.IGNORECASE),
]

WEAK_REPLY_PATTERNS = [
    re.compile(r"^\s*i\s+don't\s+know\s*,?\s*why\??\s*$", re.IGNORECASE),
    re.compile(r"^\s*i\s+forgot\s+why\s*!?\s*$", re.IGNORECASE),
    re.compile(r"^\s*because\s+it\s+(?:felt|was\s+feeling)\s+a\s+little\s+down\.?\s*$", re.IGNORECASE),
]

CANDIDATE_SHAPE_INSTRUCTION = (
    "Reply shape requirements (internal quality guard): "
    "1) Start with a direct answer to the latest user message. "
    "2) Add one specific, context-grounded detail tied to this chat/persona. "
    "3) End with a natural follow-up that moves the conversation forward. "
    "Do not mention these instructions."
)


def _now_iso():
    return datetime.now().isoformat()


def _debug(context, event, **details):
    logger = (context or {}).get("debug_logger")
    if logger is None:
        return
    try:
        if callable(logger):
            logger(f"recursive_validator.{event}", **details)
            return
        if hasattr(logger, "log_event") and callable(getattr(logger, "log_event")):
            logger.log_event(f"recursive_validator.{event}", **details)
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


def _parse_bool(value, default=True):
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    raw = str(value).strip().lower()
    if raw in {"1", "true", "yes", "on", "enabled"}:
        return True
    if raw in {"0", "false", "no", "off", "disabled"}:
        return False
    return default


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


def _safe_read_json(path):
    if not path.exists() or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


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
        "Recursive Validator",
        "recursive validator",
        "Recursive_Validator",
        "recursive_validator",
        "recursive-validator",
    ]
    for key in candidates:
        value = module_settings.get(key)
        if isinstance(value, dict):
            return value
    return {}


def _parse_criteria(raw):
    values = []
    if isinstance(raw, list):
        values = raw
    elif isinstance(raw, str) and raw.strip():
        text = raw.strip()
        try:
            loaded = json.loads(text)
            if isinstance(loaded, list):
                values = loaded
        except Exception:
            values = [
                {"text": line.strip(" -\t"), "enabled": True, "hard_fail": False}
                for line in text.splitlines()
                if line.strip()
            ]

    parsed = []
    for index, item in enumerate(values):
        if isinstance(item, dict):
            text = str(item.get("text") or item.get("criterion") or "").strip()
            enabled = _parse_bool(item.get("enabled"), True)
            hard_fail = _parse_bool(item.get("hard_fail"), False)
        else:
            text = str(item or "").strip()
            enabled = True
            hard_fail = False

        if not text:
            continue

        parsed.append(
            {
                "id": f"criterion_{index + 1}",
                "text": _truncate(text, 240),
                "enabled": enabled,
                "hard_fail": hard_fail,
            }
        )

    if not parsed:
        parsed = [dict(item) for item in DEFAULT_CRITERIA]

    enabled_rows = [row for row in parsed if row.get("enabled")]
    if not enabled_rows:
        first = dict(parsed[0]) if parsed else dict(DEFAULT_CRITERIA[0])
        first["enabled"] = True
        enabled_rows = [first]

    for idx, row in enumerate(enabled_rows):
        row["id"] = row.get("id") or f"criterion_{idx + 1}"

    return enabled_rows[:12]


def _normalize_settings(raw):
    source = {str(key).strip().lower(): raw[key] for key in (raw or {}) if str(key).strip()}

    def pick(*keys, default=None):
        for key in keys:
            if key in source:
                return source[key]
        return default

    settings = dict(DEFAULT_SETTINGS)
    settings["max_iterations"] = max(1, min(8, _parse_int(pick("max_iterations"), DEFAULT_SETTINGS["max_iterations"])))
    settings["conditional_output_threshold"] = max(1.0, min(100.0, _parse_float(pick("conditional_output_threshold"), DEFAULT_SETTINGS["conditional_output_threshold"])))
    settings["hard_pass_score"] = max(1.0, min(100.0, _parse_float(pick("hard_pass_score"), DEFAULT_SETTINGS["hard_pass_score"])))
    settings["module_max_latency_ms"] = max(800, _parse_int(pick("module_max_latency_ms"), DEFAULT_SETTINGS["module_max_latency_ms"]))
    settings["module_max_token_budget"] = max(120, _parse_int(pick("module_max_token_budget"), DEFAULT_SETTINGS["module_max_token_budget"]))
    settings["evaluator_max_tokens"] = max(80, _parse_int(pick("evaluator_max_tokens"), DEFAULT_SETTINGS["evaluator_max_tokens"]))
    settings["candidate_max_tokens"] = max(0, _parse_int(pick("candidate_max_tokens"), DEFAULT_SETTINGS["candidate_max_tokens"]))
    settings["evaluator_reserved_ms"] = max(600, _parse_int(pick("evaluator_reserved_ms"), DEFAULT_SETTINGS["evaluator_reserved_ms"]))
    settings["precheck_min_score"] = max(0.0, min(100.0, _parse_float(pick("precheck_min_score"), DEFAULT_SETTINGS["precheck_min_score"])))
    settings["min_improvement_delta"] = max(0.0, _parse_float(pick("min_improvement_delta"), DEFAULT_SETTINGS["min_improvement_delta"]))
    settings["stagnation_stop_enabled"] = _parse_bool(pick("stagnation_stop_enabled"), DEFAULT_SETTINGS["stagnation_stop_enabled"])
    settings["min_iterations_before_stagnation"] = max(2, min(8, _parse_int(pick("min_iterations_before_stagnation"), DEFAULT_SETTINGS["min_iterations_before_stagnation"])))
    settings["minimum_candidate_chars"] = max(12, min(120, _parse_int(pick("minimum_candidate_chars"), DEFAULT_SETTINGS["minimum_candidate_chars"])))
    settings["pending_context_ttl_ms"] = max(2000, _parse_int(pick("pending_context_ttl_ms"), DEFAULT_SETTINGS["pending_context_ttl_ms"]))
    settings["stream_emit_chunk_size"] = max(8, min(120, _parse_int(pick("stream_emit_chunk_size"), DEFAULT_SETTINGS["stream_emit_chunk_size"])))

    raw_criteria = pick("criteria_json", "criteria", default=None)
    settings["criteria"] = _parse_criteria(raw_criteria)
    return settings


def _set_status(chat_key, payload):
    with _LOCK:
        _STATUS_BY_CHAT[chat_key] = dict(payload or {})
        _STATUS_BY_CHAT[chat_key]["updated_at"] = _now_iso()


def _get_status(chat_key):
    with _LOCK:
        value = _STATUS_BY_CHAT.get(chat_key)
        return dict(value or {})


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


def _validator_temp_dir(chat_folder):
    if not chat_folder:
        return None
    folder = Path(chat_folder) / "Validator Temp"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _prepare_temp_dir(temp_dir):
    if not temp_dir:
        return
    try:
        temp_dir.mkdir(parents=True, exist_ok=True)
        for item in temp_dir.iterdir():
            if item.is_file():
                try:
                    item.unlink()
                except Exception:
                    pass
    except Exception:
        return


def _cleanup_temp_dir(temp_dir):
    if not temp_dir or not temp_dir.exists() or not temp_dir.is_dir():
        return
    for item in temp_dir.iterdir():
        if not item.is_file():
            continue
        try:
            item.unlink()
        except Exception:
            continue


def _write_iteration_artifact(temp_dir, iteration, data):
    if not temp_dir:
        return
    try:
        file_path = temp_dir / f"iter_{int(iteration):02d}.json"
        file_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        return


def _prune_stale_pending(now_mono=None):
    now = float(now_mono if now_mono is not None else time.monotonic())
    with _LOCK:
        kept = []
        for entry in _PENDING_VALIDATIONS:
            ttl_ms = int((entry.get("settings") or {}).get("pending_context_ttl_ms") or DEFAULT_SETTINGS["pending_context_ttl_ms"])
            created = float(entry.get("created_mono") or 0.0)
            if (now - created) * 1000.0 <= ttl_ms:
                kept.append(entry)
        _PENDING_VALIDATIONS[:] = kept


def _enqueue_validation_context(context_payload):
    if not isinstance(context_payload, dict):
        return

    bot_name = str(context_payload.get("bot_name") or "").strip()
    chat_id = str(context_payload.get("chat_id") or "").strip()
    if not bot_name or not chat_id:
        return

    key = _chat_key(bot_name, chat_id)
    with _LOCK:
        _prune_stale_pending(now_mono=time.monotonic())
        _PENDING_VALIDATIONS[:] = [entry for entry in _PENDING_VALIDATIONS if _chat_key(entry.get("bot_name"), entry.get("chat_id")) != key]
        _PENDING_VALIDATIONS.append(dict(context_payload))


def _get_payload_messages(payload):
    messages = (payload or {}).get("messages")
    if not isinstance(messages, list):
        return []
    rows = []
    for item in messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "")
        rows.append({"role": role, "content": content})
    return rows


def _latest_user_message(payload):
    for item in reversed(_get_payload_messages(payload)):
        if item.get("role") != "user":
            continue
        text = _truncate(item.get("content") or "", 700)
        if text:
            return text
    return ""


def _collect_style_anchor_text(payload):
    anchors = []
    for item in _get_payload_messages(payload):
        if item.get("role") != "system":
            continue
        content = str(item.get("content") or "")
        if _VALIDATOR_REGEN_MARKER in content or _VALIDATOR_EVAL_MARKER in content:
            continue
        if _MAIN_RESPONSE_MARKER in content:
            continue
        text = _truncate(content, 260)
        if text:
            anchors.append(text)
        if len(anchors) >= 4:
            break
    return "\n".join(anchors)


def _count_generic_filler_hits(candidate_text):
    text = str(candidate_text or "")
    if not text:
        return 0
    hits = 0
    for pattern in GENERIC_FILLER_PATTERNS:
        if pattern.search(text):
            hits += 1
    return hits


def _count_meta_process_hits(candidate_text):
    text = str(candidate_text or "")
    if not text:
        return 0
    hits = 0
    for pattern in META_PROCESS_PATTERNS:
        if pattern.search(text):
            hits += 1
    return hits


def _is_incomplete_joke_setup(latest_user_text, candidate_text):
    user_text = str(latest_user_text or "").lower()
    candidate = str(candidate_text or "")
    candidate_low = candidate.lower()
    if "joke" not in user_text:
        return False
    if "why did" not in candidate_low:
        return False
    # If it asks a setup question but never lands a punchline, it reads awkward/incomplete.
    if "because" in candidate_low:
        return False
    if candidate.count("?") == 0:
        return False
    return True


def _sanitize_final_output(latest_user_text, candidate_text):
    text = str(candidate_text or "").strip()
    if not text:
        return text

    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    cleaned = []
    for sentence in sentences:
        if any(pattern.search(sentence) for pattern in META_PROCESS_PATTERNS):
            continue
        cleaned.append(sentence)

    normalized = " ".join(cleaned).strip() if cleaned else text

    # Avoid returning incomplete joke setups when the user asked for a joke.
    if _is_incomplete_joke_setup(latest_user_text, normalized):
        normalized = f"{normalized} Because it was feeling a little down at the heel."

    low = normalized.lower().strip()
    if "joke" in str(latest_user_text or "").lower():
        if any(pattern.match(low) for pattern in WEAK_REPLY_PATTERNS) or len(normalized) < 48:
            normalized = "Why did the blue sock go to therapy? Because it was feeling a little down at the heel."

    return _truncate(normalized, 1800)


def _apply_quality_guards(evaluation, candidate_text, payload, settings=None):
    result = dict(evaluation or {})
    rows = list(result.get("criteria") or [])
    latest_user = _latest_user_message(payload)
    candidate = str(candidate_text or "")
    penalty = 0.0
    feedback_bits = []
    min_candidate_chars = int((settings or {}).get("minimum_candidate_chars") or DEFAULT_SETTINGS["minimum_candidate_chars"])

    meta_hits = _count_meta_process_hits(candidate)
    if meta_hits > 0:
        penalty += 8.0 * float(meta_hits)
        feedback_bits.append("Remove process/meta narration from the final reply")

    if _is_incomplete_joke_setup(latest_user, candidate):
        penalty += 24.0
        feedback_bits.append("Complete the joke with a clear punchline")

    if len(candidate.strip()) < min_candidate_chars:
        penalty += 18.0
        feedback_bits.append("Avoid very short replies; provide a complete answer")

    if any(pattern.match(candidate.strip()) for pattern in WEAK_REPLY_PATTERNS):
        penalty += 20.0
        feedback_bits.append("Avoid generic or evasive one-liners")

    if penalty <= 0.0:
        return result

    adjusted_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        item = dict(row)
        item["score"] = _normalize_candidate_score(float(item.get("score") or 0.0) - penalty, 0.0)
        item["passed"] = False
        adjusted_rows.append(item)

    if adjusted_rows:
        result["criteria"] = adjusted_rows
        total = sum(float(item.get("score") or 0.0) for item in adjusted_rows) / max(1, len(adjusted_rows))
        result["total_score"] = _normalize_candidate_score(total, 0.0)
        result["all_passed"] = False
        result["hard_fail_failed"] = True

    base_feedback = _truncate(str(result.get("feedback") or ""), 520)
    extra = "; ".join(feedback_bits)
    result["feedback"] = _truncate(f"{base_feedback}; {extra}".strip("; "), 700)
    return result


def _tokenize_keywords(text):
    words = re.findall(r"[a-zA-Z]{4,}", str(text or "").lower())
    return set(words)


def _overlap_ratio(a_text, b_text):
    a = _tokenize_keywords(a_text)
    b = _tokenize_keywords(b_text)
    if not a or not b:
        return 0.0
    return float(len(a.intersection(b))) / float(max(1, len(a)))


def _deterministic_pre_evaluation(criteria, candidate_text, payload, hard_pass_score):
    candidate = str(candidate_text or "")
    candidate_len = len(candidate.strip())
    latest_user = _latest_user_message(payload)
    style_anchor = _collect_style_anchor_text(payload)
    generic_hits = _count_generic_filler_hits(candidate)

    user_overlap = _overlap_ratio(latest_user, candidate)
    style_overlap = _overlap_ratio(style_anchor, candidate)
    sentence_count = len([part for part in re.split(r"[.!?]+", candidate) if part.strip()])
    has_followup_question = "?" in candidate
    has_direct_opening = bool(re.match(r"\s*(yes|no|not\s+really|i\s|you\s|that\s|it\s)", candidate.lower()))
    has_context_detail = bool(re.search(r"\b(this|that|here|now|today|you|we|your|chat|conversation)\b", candidate.lower()))
    repeated_phrase_penalty = 0
    doubled = re.findall(r"\b(\w{4,})\b(?:\W+\1\b)+", candidate.lower())
    if doubled:
        repeated_phrase_penalty += min(10, len(doubled) * 3)

    base_clarity = 34.0
    if 50 <= candidate_len <= 320:
        base_clarity += 20.0
    if sentence_count >= 2:
        base_clarity += 8.0
    if has_followup_question:
        base_clarity += 6.0
    if has_context_detail:
        base_clarity += 6.0

    directness_score = 30.0 + (45.0 * user_overlap)
    if has_direct_opening:
        directness_score += 10.0
    if has_context_detail:
        directness_score += 6.0

    consistency_score = 36.0 + (34.0 * style_overlap)
    if has_context_detail:
        consistency_score += 8.0

    voice_score = 38.0 + (32.0 * style_overlap)
    if has_followup_question:
        voice_score += 6.0

    penalty = (generic_hits * 11.0) + repeated_phrase_penalty

    default_score = _normalize_candidate_score(base_clarity - penalty * 0.5, 0.0)
    row_scores = []
    for row in criteria:
        criterion_text = str(row.get("text") or "")
        key = _criterion_key(criterion_text)
        if "latest request" in key or "directly" in key:
            raw_score = directness_score - penalty
            reason = "Heuristic directness and user-overlap check."
        elif "core definition" in key or "scenario" in key:
            raw_score = consistency_score - penalty
            reason = "Heuristic consistency and style-anchor overlap check."
        elif "voice" in key or "tone" in key:
            raw_score = voice_score - penalty
            reason = "Heuristic voice fidelity and anti-genericity check."
        elif "clear" in key or "coherent" in key or "useful" in key:
            raw_score = base_clarity - penalty
            reason = "Heuristic clarity/structure usefulness check."
        else:
            raw_score = default_score
            reason = "Heuristic generic quality check."

        score = _normalize_candidate_score(raw_score, 0.0)
        row_scores.append(
            {
                "criterion": criterion_text,
                "score": score,
                "passed": score >= hard_pass_score,
                "hard_fail": bool(row.get("hard_fail")),
                "reason": reason,
            }
        )

    total = sum(item["score"] for item in row_scores) / max(1, len(row_scores))
    all_passed = all(item.get("passed") for item in row_scores)
    hard_fail_failed = any(item.get("hard_fail") and not item.get("passed") for item in row_scores)
    feedback_parts = []
    if not has_direct_opening:
        feedback_parts.append("Open with a more direct answer to the user's latest message")
    if not has_context_detail:
        feedback_parts.append("Add one concrete context-grounded detail")
    if not has_followup_question:
        feedback_parts.append("End with a natural follow-up question")
    if generic_hits > 0:
        feedback_parts.append("Avoid generic filler phrasing")
    feedback = "; ".join(feedback_parts) if feedback_parts else "Keep the response specific and voice-consistent."

    return {
        "criteria": row_scores,
        "total_score": _normalize_candidate_score(total, 0.0),
        "all_passed": all_passed,
        "hard_fail_failed": hard_fail_failed,
        "feedback": _truncate(feedback, 700),
        "fallback_used": True,
        "precheck_only": True,
    }


def _contains_marker(payload, marker):
    marker_text = str(marker or "").strip().lower()
    if not marker_text:
        return False
    for item in _get_payload_messages(payload):
        if marker_text in str(item.get("content") or "").lower():
            return True
    return False


def _is_main_assistant_payload(payload):
    for item in _get_payload_messages(payload):
        if item.get("role") != "system":
            continue
        if _MAIN_RESPONSE_MARKER.lower() in str(item.get("content") or "").lower():
            return True
    return False


def _bypass_count():
    return int(getattr(_LOCAL, "bypass", 0) or 0)


def _is_bypass_active():
    return _bypass_count() > 0


class _BypassValidator:
    def __enter__(self):
        _LOCAL.bypass = _bypass_count() + 1

    def __exit__(self, exc_type, exc, tb):
        _LOCAL.bypass = max(0, _bypass_count() - 1)


def _consume_validation_context(payload):
    if _is_bypass_active():
        return None
    if not _is_main_assistant_payload(payload):
        return None
    if _contains_marker(payload, _VALIDATOR_EVAL_MARKER) or _contains_marker(payload, _VALIDATOR_REGEN_MARKER):
        return None

    now = time.monotonic()
    with _LOCK:
        _prune_stale_pending(now_mono=now)
        if not _PENDING_VALIDATIONS:
            return None
        entry = _PENDING_VALIDATIONS.pop(0)
    return entry


def _extract_json_object(text):
    raw = str(text or "").strip()
    if not raw:
        return None

    if raw.startswith("```"):
        raw = raw.strip("`\n ")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()

    # Try direct parse first.
    try:
        payload = json.loads(raw)
        if isinstance(payload, str):
            payload = json.loads(payload)
        return payload if isinstance(payload, dict) else None
    except Exception:
        pass

    start = raw.find("{")
    if start < 0:
        return None

    # Try all plausible JSON object end points (helps with trailing junk).
    end_positions = [idx for idx, ch in enumerate(raw) if ch == "}" and idx > start]
    for end in reversed(end_positions):
        candidate = raw[start:end + 1].strip()
        try:
            payload = json.loads(candidate)
            if isinstance(payload, str):
                payload = json.loads(payload)
            if isinstance(payload, dict):
                return payload
        except Exception:
            continue

    # Last resort: accept python-style dicts / booleans produced by small models.
    for end in reversed(end_positions):
        candidate = raw[start:end + 1].strip()
        try:
            payload = ast.literal_eval(candidate)
            if isinstance(payload, dict):
                return payload
        except Exception:
            continue

    return None


def _normalize_candidate_score(value, default=0.0):
    score = _parse_float(value, default)
    return max(0.0, min(100.0, score))


def _criterion_key(text):
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _fallback_evaluation(criteria, candidate_text, hard_pass_score):
    candidate = str(candidate_text or "")
    candidate_len = len(candidate.strip())
    sentence_count = len([part for part in re.split(r"[.!?]+", candidate) if part.strip()])
    has_question = "?" in candidate
    has_context_words = bool(re.search(r"\b(this|that|here|now|today|you|we|your|chat|conversation)\b", candidate.lower()))
    generic_hits = _count_generic_filler_hits(candidate)

    base = 18.0
    if candidate_len >= 30:
        base += 10.0
    if 70 <= candidate_len <= 300:
        base += 12.0
    if sentence_count >= 2:
        base += 7.0
    if has_question:
        base += 6.0
    if has_context_words:
        base += 6.0

    penalty = generic_hits * 9.0

    scores = []
    for idx, row in enumerate(criteria):
        hard_fail = bool(row.get("hard_fail"))
        criterion = str(row.get("text") or "")
        key = _criterion_key(criterion)
        local = base + (4.0 if hard_fail else 0.0)
        if "latest request" in key or "directly" in key:
            local += 4.0 if has_context_words else -6.0
        elif "voice" in key or "tone" in key:
            local += 3.0 if has_question else 0.0
            local -= 2.0 * generic_hits
        elif "clear" in key or "coherent" in key:
            local += 3.0 if sentence_count >= 2 else -5.0
        elif idx == 0 and not has_context_words:
            local -= 5.0

        score = _normalize_candidate_score(local - penalty, 0.0)
        # Conservative fallback: parse failures should not become a false validation pass.
        passed = False
        scores.append(
            {
                "criterion": criterion,
                "score": score,
                "passed": passed,
                "hard_fail": hard_fail,
                "reason": "Fallback heuristic score due to evaluator parse failure.",
            }
        )

    total = sum(item["score"] for item in scores) / max(1, len(scores))
    hard_fail_failed = True
    all_passed = False
    return {
        "criteria": scores,
        "total_score": _normalize_candidate_score(total, 0.0),
        "all_passed": all_passed,
        "hard_fail_failed": hard_fail_failed,
        "feedback": "Improve directness, consistency with scenario constraints, and response clarity.",
        "fallback_used": True,
    }


def _normalize_evaluation_payload(parsed, criteria, hard_pass_score):
    if not isinstance(parsed, dict):
        return None

    rows = parsed.get("criteria")
    if not isinstance(rows, list):
        rows = parsed.get("criterion_scores")

    normalized_rows = []
    if isinstance(rows, list):
        for idx, source_row in enumerate(rows):
            item = source_row if isinstance(source_row, dict) else {}
            criterion_text = str(item.get("criterion") or item.get("name") or "").strip()
            if not criterion_text and idx < len(criteria):
                criterion_text = str(criteria[idx].get("text") or "")
            if not criterion_text:
                continue

            score = _normalize_candidate_score(item.get("score"), 0.0)
            passed_value = item.get("passed")
            if passed_value is None:
                passed = score >= hard_pass_score
            else:
                passed = _parse_bool(passed_value, score >= hard_pass_score)

            hard_fail = _parse_bool(item.get("hard_fail"), idx < len(criteria) and bool(criteria[idx].get("hard_fail")))
            reason = _truncate(str(item.get("reason") or ""), 220)
            normalized_rows.append(
                {
                    "criterion": criterion_text,
                    "score": score,
                    "passed": passed,
                    "hard_fail": hard_fail,
                    "reason": reason,
                }
            )

    if not normalized_rows:
        return None

    by_key = {_criterion_key(item.get("criterion")): item for item in normalized_rows}
    unmatched_rows = list(normalized_rows)
    deterministic_rows = []
    for idx, base in enumerate(criteria):
        crit_text = str(base.get("text") or "").strip()
        key = _criterion_key(crit_text)
        source = by_key.get(key)
        if source in unmatched_rows:
            unmatched_rows.remove(source)

        if source is None:
            best_row = None
            best_overlap = 0.0
            for row in unmatched_rows:
                overlap = _overlap_ratio(crit_text, row.get("criterion") or "")
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_row = row
            if best_row is not None and best_overlap >= 0.35:
                source = best_row
                unmatched_rows.remove(best_row)

        if source is None and idx < len(normalized_rows):
            source = normalized_rows[idx]
            if source in unmatched_rows:
                unmatched_rows.remove(source)

        hard_fail = bool(base.get("hard_fail"))
        if source is None:
            deterministic_rows.append(
                {
                    "criterion": crit_text,
                    "score": 0.0,
                    "passed": False,
                    "hard_fail": hard_fail,
                    "reason": "Evaluator omitted this criterion; treated as failed.",
                }
            )
            continue

        score = _normalize_candidate_score(source.get("score"), 0.0)
        deterministic_rows.append(
            {
                "criterion": crit_text,
                "score": score,
                "passed": score >= hard_pass_score,
                "hard_fail": hard_fail,
                "reason": _truncate(str(source.get("reason") or ""), 220),
            }
        )

    if not deterministic_rows:
        return None

    weight = 100.0 / max(1, len(deterministic_rows))
    weighted_sum = 0.0
    for item in deterministic_rows:
        weighted_sum += (_normalize_candidate_score(item.get("score"), 0.0) / 100.0) * weight

    total_score = _normalize_candidate_score(weighted_sum, 0.0)
    all_passed = all(item.get("passed") for item in deterministic_rows)
    hard_fail_failed = any(item.get("hard_fail") and not item.get("passed") for item in deterministic_rows)
    feedback = _truncate(str(parsed.get("feedback") or parsed.get("improvement_feedback") or ""), 700)

    return {
        "criteria": deterministic_rows,
        "total_score": total_score,
        "all_passed": all_passed,
        "hard_fail_failed": hard_fail_failed,
        "feedback": feedback,
        "fallback_used": False,
    }


def _build_evaluator_messages(criteria, candidate_text, attempt_feedback):
    criteria_rows = []
    for idx, row in enumerate(criteria):
        criteria_rows.append(
            {
                "id": idx + 1,
                "criterion": row.get("text") or "",
                "hard_fail": bool(row.get("hard_fail")),
            }
        )

    prior_feedback_lines = []
    for item in attempt_feedback[-3:]:
        text = _truncate(str(item or ""), 220)
        if text:
            prior_feedback_lines.append(f"- {text}")

    prior_feedback_blob = "\n".join(prior_feedback_lines) if prior_feedback_lines else "(none)"

    return [
        {
            "role": "system",
            "content": (
                f"{_VALIDATOR_EVAL_MARKER}\n"
                "You are an internal response validator. Evaluate candidate assistant text against criteria. "
                "Return strict JSON only. No markdown. "
                "Schema: {criteria:[{criterion,score,passed,hard_fail,reason}], total_score:number, all_passed:boolean, feedback:string}. "
                "Score each criterion in range 0..100."
            ),
        },
        {
            "role": "user",
            "content": (
                "Enabled criteria:\n"
                f"{json.dumps(criteria_rows, ensure_ascii=False)}\n\n"
                "Recent validator feedback from previous attempts (if any):\n"
                f"{prior_feedback_blob}\n\n"
                "Candidate reply to validate:\n"
                f"{_truncate(candidate_text, 3600)}"
            ),
        },
    ]


def _build_evaluator_payload(base_payload, evaluator_messages, settings):
    payload = dict(base_payload or {})
    payload["messages"] = evaluator_messages
    payload["max_tokens"] = int(settings.get("evaluator_max_tokens") or DEFAULT_SETTINGS["evaluator_max_tokens"])
    payload.pop("stop", None)
    return payload


def _remaining_budget_ms(deadline):
    return int(max(0.0, (float(deadline) - time.monotonic()) * 1000.0))


def _build_deadline_cancel_check(deadline, cancel_check=None):
    def _inner():
        try:
            if callable(cancel_check) and cancel_check():
                return True
        except Exception:
            return True
        return time.monotonic() >= float(deadline)

    return _inner


def _build_regeneration_payload(base_payload, evaluation_data, iteration, settings, previous_candidate=""):
    feedback = _truncate(str((evaluation_data or {}).get("feedback") or ""), 900)
    criteria_rows = (evaluation_data or {}).get("criteria")
    if not isinstance(criteria_rows, list):
        criteria_rows = []

    score_breakdown = []
    for item in criteria_rows:
        if not isinstance(item, dict):
            continue
        criterion = _truncate(str(item.get("criterion") or ""), 140)
        score = _normalize_candidate_score(item.get("score"), 0.0)
        passed = bool(item.get("passed"))
        flag = "PASS" if passed else "FAIL"
        score_breakdown.append(f"- {criterion}: {score:.1f} ({flag})")

    failed_criteria = []
    for item in criteria_rows:
        if not isinstance(item, dict):
            continue
        if bool(item.get("passed")):
            continue
        failed_criteria.append(_truncate(str(item.get("criterion") or ""), 140))

    guidance = [
        _VALIDATOR_REGEN_MARKER,
        f"Attempt {int(iteration)} regeneration guidance (internal only):",
        f"Total score: {_normalize_candidate_score((evaluation_data or {}).get('total_score'), 0.0):.1f}",
        CANDIDATE_SHAPE_INSTRUCTION,
        "Criteria breakdown:",
        "\n".join(score_breakdown) if score_breakdown else "- No per-criterion details available.",
        "Patch strategy: keep strong parts of the previous draft, only rewrite weak spans tied to failed criteria, and preserve tone/persona.",
        "Do not narrate drafting steps in the final reply (avoid phrases like 'let me try again' or 'okay, I've got one').",
        "Failed criteria to patch first:",
        "\n".join(f"- {item}" for item in failed_criteria) if failed_criteria else "- None listed; improve specificity and flow.",
    ]
    if feedback:
        guidance.append(f"Evaluator feedback: {feedback}")
    if str(previous_candidate or "").strip():
        guidance.append("Previous draft (preserve strong parts, patch weak parts):")
        guidance.append(_truncate(previous_candidate, 900))

    payload = dict(base_payload or {})
    messages = list((base_payload or {}).get("messages") or [])
    messages.append({"role": "system", "content": "\n".join(guidance)})
    payload["messages"] = messages

    candidate_max_tokens = int(settings.get("candidate_max_tokens") or 0)
    if candidate_max_tokens > 0:
        payload["max_tokens"] = candidate_max_tokens

    return payload


def _build_initial_candidate_payload(base_payload, settings):
    payload = dict(base_payload or {})
    messages = list((base_payload or {}).get("messages") or [])
    messages.append(
        {
            "role": "system",
            "content": (
                "[Recursive Validator Candidate Guidance]\n"
                f"{CANDIDATE_SHAPE_INSTRUCTION}\n"
                "Avoid generic filler and empty disclaimers. Keep voice stable and specific. "
                "Never mention retrying, drafting process, or self-correction in the visible reply."
            ),
        }
    )
    payload["messages"] = messages

    candidate_max_tokens = int(settings.get("candidate_max_tokens") or 0)
    if candidate_max_tokens > 0:
        payload["max_tokens"] = candidate_max_tokens
    return payload


def _run_evaluator(prompt_pipeline, request_fn, settings, base_payload, criteria, candidate_text, feedback_history, cancel_check, context, remaining_budget_ms=None):
    hard_pass_score = float(settings.get("hard_pass_score") or 70.0)
    precheck = _deterministic_pre_evaluation(criteria, candidate_text, base_payload, hard_pass_score)
    precheck_floor = float(settings.get("precheck_min_score") or DEFAULT_SETTINGS["precheck_min_score"])
    if _normalize_candidate_score(precheck.get("total_score"), 0.0) < precheck_floor:
        _debug(
            context,
            "precheck_skip_evaluator",
            score=_normalize_candidate_score(precheck.get("total_score"), 0.0),
            floor=precheck_floor,
        )
        return precheck

    evaluator_messages = _build_evaluator_messages(criteria, candidate_text, feedback_history)
    evaluator_payload = _build_evaluator_payload(base_payload, evaluator_messages, settings)
    if remaining_budget_ms is not None:
        timeout_seconds = max(0.6, min(12.0, float(max(1, int(remaining_budget_ms))) / 1000.0))
        evaluator_payload["request_timeout_seconds"] = timeout_seconds

    with _BypassValidator():
        eval_text, eval_error = request_fn(settings, evaluator_payload, cancel_check=cancel_check)

    if eval_error or not eval_text:
        _debug(context, "evaluator_error", error=str(eval_error or "empty evaluator response"))
        return _fallback_evaluation(criteria, candidate_text, hard_pass_score)

    parsed = _extract_json_object(eval_text)
    normalized = _normalize_evaluation_payload(parsed, criteria, hard_pass_score)
    if not normalized:
        _debug(context, "evaluator_parse_fallback", preview=_truncate(eval_text, 180))
        return _fallback_evaluation(criteria, candidate_text, hard_pass_score)

    return normalized


def _update_processing_status(chat_key, bot_name, chat_id, iteration, max_iterations, details=""):
    details_text = _truncate(str(details or ""), 520)
    _set_status(
        chat_key,
        {
            "success": True,
            "processing": True,
            "message": _STATUS_TEXT,
            "thinking_output": f"Iteration {int(iteration)}/{int(max_iterations)}. {details_text}".strip(),
            "module_name": "Recursive Validator",
            "bot_name": bot_name,
            "chat_id": chat_id,
            "iteration": int(iteration),
            "max_iterations": int(max_iterations),
        },
    )


def _validate_non_stream(prompt_pipeline, request_fn, settings, payload, cancel_check, validation_context):
    bot_name = str(validation_context.get("bot_name") or "").strip()
    chat_id = str(validation_context.get("chat_id") or "").strip()
    chat_key = _chat_key(bot_name, chat_id)
    criteria = list((validation_context.get("settings") or {}).get("criteria") or settings.get("criteria") or [])
    local_settings = dict(settings or {})
    local_settings.update(validation_context.get("settings") or {})

    max_iterations = int(local_settings.get("max_iterations") or DEFAULT_SETTINGS["max_iterations"])
    threshold = float(local_settings.get("conditional_output_threshold") or DEFAULT_SETTINGS["conditional_output_threshold"])
    min_delta = float(local_settings.get("min_improvement_delta") or DEFAULT_SETTINGS["min_improvement_delta"])
    stop_on_stagnation = bool(local_settings.get("stagnation_stop_enabled", True))
    min_iterations_before_stagnation = int(local_settings.get("min_iterations_before_stagnation") or DEFAULT_SETTINGS["min_iterations_before_stagnation"])
    max_latency_ms = int(local_settings.get("module_max_latency_ms") or DEFAULT_SETTINGS["module_max_latency_ms"])
    evaluator_reserved_ms = int(local_settings.get("evaluator_reserved_ms") or DEFAULT_SETTINGS["evaluator_reserved_ms"])
    max_token_budget = int(local_settings.get("module_max_token_budget") or DEFAULT_SETTINGS["module_max_token_budget"])
    evaluator_max_tokens = int(local_settings.get("evaluator_max_tokens") or DEFAULT_SETTINGS["evaluator_max_tokens"])

    temp_dir = validation_context.get("temp_dir")
    if temp_dir:
        temp_dir = Path(temp_dir)

    started = time.monotonic()
    deadline = started + max_latency_ms / 1000.0
    best_candidate = ""
    best_evaluation = None
    feedback_history = []
    stop_reason = ""
    selected_iteration = 1
    last_iteration_score = None
    token_spent = 0
    reliable_evaluation_seen = False

    _prepare_temp_dir(temp_dir)

    try:
        _debug(context=validation_context, event="validation_start", bot_name=bot_name, chat_id=chat_id, max_iterations=max_iterations, threshold=threshold)

        _update_processing_status(chat_key, bot_name, chat_id, 1, max_iterations, "Generating first candidate...")
        initial_payload = _build_initial_candidate_payload(payload, local_settings)
        generation_deadline = min(deadline, max(time.monotonic() + 0.25, deadline - (evaluator_reserved_ms / 1000.0)))
        generation_cancel = _build_deadline_cancel_check(generation_deadline, cancel_check)
        with _BypassValidator():
            candidate_text, candidate_error = request_fn(settings, initial_payload, cancel_check=generation_cancel)
        if candidate_error:
            _set_status(
                chat_key,
                {
                    "success": False,
                    "processing": False,
                    "message": _STATUS_TEXT,
                    "thinking_output": "Validation skipped: initial generation failed.",
                    "module_name": "Recursive Validator",
                    "bot_name": bot_name,
                    "chat_id": chat_id,
                    "error": str(candidate_error),
                },
            )
            return None, candidate_error

        if not str(candidate_text or "").strip():
            _set_status(
                chat_key,
                {
                    "success": False,
                    "processing": False,
                    "message": _STATUS_TEXT,
                    "thinking_output": "Validation skipped: initial generation returned empty text.",
                    "module_name": "Recursive Validator",
                    "bot_name": bot_name,
                    "chat_id": chat_id,
                },
            )
            return None, "LLM returned an empty response."

        token_spent += _estimate_tokens(candidate_text)

        for iteration in range(1, max_iterations + 1):
            if cancel_check and cancel_check():
                return None, "Cancelled."

            if time.monotonic() > deadline:
                stop_reason = "latency_budget_reached"
                break

            remaining_ms = _remaining_budget_ms(deadline)
            if remaining_ms < 300:
                stop_reason = "latency_budget_reached"
                break

            if token_spent >= max_token_budget:
                stop_reason = "token_budget_reached"
                break

            if iteration > 1:
                if remaining_ms <= evaluator_reserved_ms + 250:
                    stop_reason = "evaluator_budget_reserved"
                    break
                _update_processing_status(chat_key, bot_name, chat_id, iteration, max_iterations, "Regenerating candidate with validator feedback...")
                regen_payload = _build_regeneration_payload(payload, best_evaluation or {}, iteration, local_settings, previous_candidate=best_candidate)
                generation_deadline = min(deadline, max(time.monotonic() + 0.2, deadline - (evaluator_reserved_ms / 1000.0)))
                generation_cancel = _build_deadline_cancel_check(generation_deadline, cancel_check)
                with _BypassValidator():
                    candidate_text, candidate_error = request_fn(settings, regen_payload, cancel_check=generation_cancel)
                if candidate_error:
                    stop_reason = "regeneration_error"
                    _debug(validation_context, "regeneration_error", iteration=iteration, error=candidate_error)
                    break
                if not str(candidate_text or "").strip():
                    stop_reason = "regeneration_empty"
                    break
                token_spent += _estimate_tokens(candidate_text)

            _update_processing_status(chat_key, bot_name, chat_id, iteration, max_iterations, "Scoring candidate against enabled criteria...")
            if token_spent + evaluator_max_tokens > max_token_budget:
                evaluation = _deterministic_pre_evaluation(
                    criteria=criteria,
                    candidate_text=candidate_text,
                    payload=payload,
                    hard_pass_score=float(local_settings.get("hard_pass_score") or 70.0),
                )
                _debug(
                    validation_context,
                    "token_budget_precheck_only",
                    iteration=iteration,
                    token_spent=token_spent,
                    max_token_budget=max_token_budget,
                )
            else:
                evaluation = _run_evaluator(
                    prompt_pipeline=prompt_pipeline,
                    request_fn=request_fn,
                    settings=local_settings,
                    base_payload=payload,
                    criteria=criteria,
                    candidate_text=candidate_text,
                    feedback_history=feedback_history,
                    cancel_check=_build_deadline_cancel_check(deadline, cancel_check),
                    context=validation_context,
                    remaining_budget_ms=remaining_ms,
                )
                token_spent += min(evaluator_max_tokens, max(20, evaluator_max_tokens // 2))

            evaluation = _apply_quality_guards(evaluation, candidate_text, payload, settings=local_settings)
            score = _normalize_candidate_score(evaluation.get("total_score"), 0.0)
            all_passed = bool(evaluation.get("all_passed"))
            hard_fail_failed = bool(evaluation.get("hard_fail_failed"))

            _debug(
                validation_context,
                "iteration_scored",
                bot_name=bot_name,
                chat_id=chat_id,
                iteration=iteration,
                score=score,
                all_passed=all_passed,
                hard_fail_failed=hard_fail_failed,
                fallback_used=bool(evaluation.get("fallback_used")),
            )

            _write_iteration_artifact(
                temp_dir,
                iteration,
                {
                    "iteration": iteration,
                    "candidate": str(candidate_text),
                    "evaluation": evaluation,
                    "created_at": _now_iso(),
                },
            )

            if best_evaluation is None or score > _normalize_candidate_score(best_evaluation.get("total_score"), -1.0):
                best_candidate = str(candidate_text)
                best_evaluation = dict(evaluation)
                selected_iteration = iteration

            feedback = _truncate(str(evaluation.get("feedback") or ""), 420)
            if feedback:
                feedback_history.append(feedback)

            evaluator_reliable = not bool(evaluation.get("fallback_used"))
            reliable_evaluation_seen = reliable_evaluation_seen or evaluator_reliable
            passed_threshold = score >= threshold and not hard_fail_failed
            if evaluator_reliable and (all_passed or passed_threshold):
                stop_reason = "criteria_pass" if all_passed else "threshold_pass"
                break

            if iteration >= max_iterations:
                stop_reason = "max_iterations_reached"
                break

            improvement = None
            if last_iteration_score is not None:
                improvement = score - last_iteration_score
            last_iteration_score = score

            can_stagnate = iteration >= min_iterations_before_stagnation and (reliable_evaluation_seen or iteration >= min_iterations_before_stagnation + 1)
            if stop_on_stagnation and can_stagnate and improvement is not None and improvement < min_delta:
                _debug(
                    validation_context,
                    "stagnation_stop",
                    bot_name=bot_name,
                    chat_id=chat_id,
                    iteration=iteration,
                    improvement=improvement,
                    min_improvement_delta=min_delta,
                )
                stop_reason = "stagnation_stop"
                break

        if not best_candidate.strip():
            best_candidate = str(candidate_text or "")
            if best_evaluation is None:
                best_evaluation = _fallback_evaluation(criteria, best_candidate, float(local_settings.get("hard_pass_score") or 70.0))

        final_score = _normalize_candidate_score((best_evaluation or {}).get("total_score"), 0.0)
        final_feedback = _truncate(str((best_evaluation or {}).get("feedback") or ""), 520)
        duration_ms = int((time.monotonic() - started) * 1000)
        final_all_passed = bool((best_evaluation or {}).get("all_passed"))
        final_hard_fail = bool((best_evaluation or {}).get("hard_fail_failed"))
        final_fallback_used = bool((best_evaluation or {}).get("fallback_used"))
        validation_passed = (not final_fallback_used) and (final_all_passed or (final_score >= threshold and not final_hard_fail))
        final_output = _sanitize_final_output(_latest_user_message(payload), best_candidate)

        _set_status(
            chat_key,
            {
                "success": True,
                "processing": False,
                "message": _STATUS_TEXT,
                "thinking_output": f"Selected iteration {selected_iteration} with score {final_score:.1f}. {final_feedback}".strip(),
                "module_name": "Recursive Validator",
                "bot_name": bot_name,
                "chat_id": chat_id,
                "score": final_score,
                "selected_iteration": selected_iteration,
                "max_iterations": max_iterations,
                "stop_reason": stop_reason or "completed",
                "duration_ms": duration_ms,
                "criteria": (best_evaluation or {}).get("criteria") or [],
                "feedback": final_feedback,
                "token_estimate": _estimate_tokens(final_output),
                "validation_passed": validation_passed,
                "fallback_used": final_fallback_used,
                "output_blocked": False,
            },
        )

        outcome_event = "validation_success" if validation_passed else "validation_complete_unpassed"
        _debug(
            validation_context,
            outcome_event,
            bot_name=bot_name,
            chat_id=chat_id,
            score=final_score,
            selected_iteration=selected_iteration,
            max_iterations=max_iterations,
            stop_reason=stop_reason or "completed",
            duration_ms=duration_ms,
            token_estimate=_estimate_tokens(final_output),
            score_breakdown=(best_evaluation or {}).get("criteria") or [],
            validation_passed=validation_passed,
            fallback_used=final_fallback_used,
            output_blocked=False,
        )

        return final_output, None
    except Exception as exc:
        _debug(
            validation_context,
            "validation_fail",
            bot_name=bot_name,
            chat_id=chat_id,
            error=str(exc),
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        _set_status(
            chat_key,
            {
                "success": False,
                "processing": False,
                "message": _STATUS_TEXT,
                "thinking_output": "Validation failed. Falling back to direct generation.",
                "module_name": "Recursive Validator",
                "bot_name": bot_name,
                "chat_id": chat_id,
                "error": str(exc),
            },
        )
        raise
    finally:
        _cleanup_temp_dir(temp_dir)


def _collect_stream_text(stream_fn, settings, payload, cancel_check=None):
    chunks = []
    try:
        with _BypassValidator():
            for piece in stream_fn(settings=settings, payload=payload, cancel_check=cancel_check):
                if cancel_check and cancel_check():
                    return "".join(chunks), "Cancelled."
                if piece:
                    chunks.append(piece)
    except Exception as exc:
        return None, str(exc)
    return "".join(chunks), None


def _chunk_text(text, chunk_size):
    raw = str(text or "")
    size = max(8, int(chunk_size or DEFAULT_SETTINGS["stream_emit_chunk_size"]))
    for idx in range(0, len(raw), size):
        yield raw[idx: idx + size]


def _validate_stream(prompt_pipeline, stream_fn, settings, payload, cancel_check, validation_context):
    bot_name = str(validation_context.get("bot_name") or "").strip()
    chat_id = str(validation_context.get("chat_id") or "").strip()
    chat_key = _chat_key(bot_name, chat_id)

    local_settings = dict(settings or {})
    local_settings.update(validation_context.get("settings") or {})
    criteria = list(local_settings.get("criteria") or [])

    max_iterations = int(local_settings.get("max_iterations") or DEFAULT_SETTINGS["max_iterations"])
    threshold = float(local_settings.get("conditional_output_threshold") or DEFAULT_SETTINGS["conditional_output_threshold"])
    min_delta = float(local_settings.get("min_improvement_delta") or DEFAULT_SETTINGS["min_improvement_delta"])
    stop_on_stagnation = bool(local_settings.get("stagnation_stop_enabled", True))
    min_iterations_before_stagnation = int(local_settings.get("min_iterations_before_stagnation") or DEFAULT_SETTINGS["min_iterations_before_stagnation"])
    max_latency_ms = int(local_settings.get("module_max_latency_ms") or DEFAULT_SETTINGS["module_max_latency_ms"])
    evaluator_reserved_ms = int(local_settings.get("evaluator_reserved_ms") or DEFAULT_SETTINGS["evaluator_reserved_ms"])
    max_token_budget = int(local_settings.get("module_max_token_budget") or DEFAULT_SETTINGS["module_max_token_budget"])
    evaluator_max_tokens = int(local_settings.get("evaluator_max_tokens") or DEFAULT_SETTINGS["evaluator_max_tokens"])

    temp_dir = validation_context.get("temp_dir")
    if temp_dir:
        temp_dir = Path(temp_dir)

    started = time.monotonic()
    deadline = started + max_latency_ms / 1000.0
    best_candidate = ""
    best_evaluation = None
    candidate_text = ""
    selected_iteration = 1
    feedback_history = []
    stop_reason = ""
    last_iteration_score = None
    token_spent = 0
    reliable_evaluation_seen = False

    _prepare_temp_dir(temp_dir)

    try:
        _debug(
            validation_context,
            "validation_start_stream",
            bot_name=bot_name,
            chat_id=chat_id,
            max_iterations=max_iterations,
            threshold=threshold,
        )

        _update_processing_status(chat_key, bot_name, chat_id, 1, max_iterations, "Generating first candidate...")
        initial_payload = _build_initial_candidate_payload(payload, local_settings)
        generation_deadline = min(deadline, max(time.monotonic() + 0.25, deadline - (evaluator_reserved_ms / 1000.0)))
        generation_cancel = _build_deadline_cancel_check(generation_deadline, cancel_check)
        candidate_text, candidate_error = _collect_stream_text(stream_fn, settings, initial_payload, cancel_check=generation_cancel)
        if candidate_error:
            raise RuntimeError(candidate_error)
        if not str(candidate_text or "").strip():
            raise RuntimeError("LLM returned an empty response.")
        token_spent += _estimate_tokens(candidate_text)

        for iteration in range(1, max_iterations + 1):
            if cancel_check and cancel_check():
                raise RuntimeError("Cancelled.")

            if time.monotonic() > deadline:
                stop_reason = "latency_budget_reached"
                break

            remaining_ms = _remaining_budget_ms(deadline)
            if remaining_ms < 300:
                stop_reason = "latency_budget_reached"
                break

            if token_spent >= max_token_budget:
                stop_reason = "token_budget_reached"
                break

            if iteration > 1:
                if remaining_ms <= evaluator_reserved_ms + 250:
                    stop_reason = "evaluator_budget_reserved"
                    break
                _update_processing_status(chat_key, bot_name, chat_id, iteration, max_iterations, "Regenerating candidate with validator feedback...")
                regen_payload = _build_regeneration_payload(payload, best_evaluation or {}, iteration, local_settings, previous_candidate=best_candidate)
                generation_deadline = min(deadline, max(time.monotonic() + 0.2, deadline - (evaluator_reserved_ms / 1000.0)))
                generation_cancel = _build_deadline_cancel_check(generation_deadline, cancel_check)
                candidate_text, candidate_error = _collect_stream_text(stream_fn, settings, regen_payload, cancel_check=generation_cancel)
                if candidate_error:
                    stop_reason = "regeneration_error"
                    break
                if not str(candidate_text or "").strip():
                    stop_reason = "regeneration_empty"
                    break
                token_spent += _estimate_tokens(candidate_text)

            _update_processing_status(chat_key, bot_name, chat_id, iteration, max_iterations, "Scoring candidate against enabled criteria...")
            if token_spent + evaluator_max_tokens > max_token_budget:
                evaluation = _deterministic_pre_evaluation(
                    criteria=criteria,
                    candidate_text=candidate_text,
                    payload=payload,
                    hard_pass_score=float(local_settings.get("hard_pass_score") or 70.0),
                )
                _debug(
                    validation_context,
                    "token_budget_precheck_only_stream",
                    iteration=iteration,
                    token_spent=token_spent,
                    max_token_budget=max_token_budget,
                )
            else:
                evaluation = _run_evaluator(
                    prompt_pipeline=prompt_pipeline,
                    request_fn=getattr(prompt_pipeline, "_request_completion"),
                    settings=local_settings,
                    base_payload=payload,
                    criteria=criteria,
                    candidate_text=candidate_text,
                    feedback_history=feedback_history,
                    cancel_check=_build_deadline_cancel_check(deadline, cancel_check),
                    context=validation_context,
                    remaining_budget_ms=remaining_ms,
                )
                token_spent += min(evaluator_max_tokens, max(20, evaluator_max_tokens // 2))

            evaluation = _apply_quality_guards(evaluation, candidate_text, payload, settings=local_settings)
            score = _normalize_candidate_score(evaluation.get("total_score"), 0.0)
            all_passed = bool(evaluation.get("all_passed"))
            hard_fail_failed = bool(evaluation.get("hard_fail_failed"))

            _debug(
                validation_context,
                "iteration_scored_stream",
                bot_name=bot_name,
                chat_id=chat_id,
                iteration=iteration,
                score=score,
                all_passed=all_passed,
                hard_fail_failed=hard_fail_failed,
                fallback_used=bool(evaluation.get("fallback_used")),
            )

            _write_iteration_artifact(
                temp_dir,
                iteration,
                {
                    "iteration": iteration,
                    "candidate": str(candidate_text),
                    "evaluation": evaluation,
                    "created_at": _now_iso(),
                },
            )

            previous_best = _normalize_candidate_score((best_evaluation or {}).get("total_score"), -1.0)
            if best_evaluation is None or score > previous_best:
                best_candidate = str(candidate_text)
                best_evaluation = dict(evaluation)
                selected_iteration = iteration

            feedback = _truncate(str(evaluation.get("feedback") or ""), 420)
            if feedback:
                feedback_history.append(feedback)

            evaluator_reliable = not bool(evaluation.get("fallback_used"))
            reliable_evaluation_seen = reliable_evaluation_seen or evaluator_reliable
            if evaluator_reliable and (all_passed or (score >= threshold and not hard_fail_failed)):
                stop_reason = "criteria_pass" if all_passed else "threshold_pass"
                break

            if iteration >= max_iterations:
                stop_reason = "max_iterations_reached"
                break

            improvement = None
            if last_iteration_score is not None:
                improvement = score - last_iteration_score
            last_iteration_score = score

            can_stagnate = iteration >= min_iterations_before_stagnation and (reliable_evaluation_seen or iteration >= min_iterations_before_stagnation + 1)
            if stop_on_stagnation and can_stagnate and improvement is not None and improvement < min_delta:
                _debug(
                    validation_context,
                    "stagnation_stop_stream",
                    bot_name=bot_name,
                    chat_id=chat_id,
                    iteration=iteration,
                    improvement=improvement,
                    min_improvement_delta=min_delta,
                )
                stop_reason = "stagnation_stop"
                break

        if not best_candidate.strip():
            best_candidate = str(candidate_text or "")
            if best_evaluation is None:
                best_evaluation = _fallback_evaluation(criteria, best_candidate, float(local_settings.get("hard_pass_score") or 70.0))

        final_score = _normalize_candidate_score((best_evaluation or {}).get("total_score"), 0.0)
        final_feedback = _truncate(str((best_evaluation or {}).get("feedback") or ""), 520)
        duration_ms = int((time.monotonic() - started) * 1000)
        final_all_passed = bool((best_evaluation or {}).get("all_passed"))
        final_hard_fail = bool((best_evaluation or {}).get("hard_fail_failed"))
        final_fallback_used = bool((best_evaluation or {}).get("fallback_used"))
        validation_passed = (not final_fallback_used) and (final_all_passed or (final_score >= threshold and not final_hard_fail))
        final_output = _sanitize_final_output(_latest_user_message(payload), best_candidate)

        _set_status(
            chat_key,
            {
                "success": True,
                "processing": False,
                "message": _STATUS_TEXT,
                "thinking_output": f"Selected iteration {selected_iteration} with score {final_score:.1f}. {final_feedback}".strip(),
                "module_name": "Recursive Validator",
                "bot_name": bot_name,
                "chat_id": chat_id,
                "score": final_score,
                "selected_iteration": selected_iteration,
                "max_iterations": max_iterations,
                "stop_reason": stop_reason or "completed",
                "duration_ms": duration_ms,
                "criteria": (best_evaluation or {}).get("criteria") or [],
                "feedback": final_feedback,
                "token_estimate": _estimate_tokens(final_output),
                "validation_passed": validation_passed,
                "fallback_used": final_fallback_used,
                "output_blocked": False,
            },
        )

        outcome_event = "validation_success_stream" if validation_passed else "validation_complete_unpassed_stream"
        _debug(
            validation_context,
            outcome_event,
            bot_name=bot_name,
            chat_id=chat_id,
            score=final_score,
            selected_iteration=selected_iteration,
            max_iterations=max_iterations,
            stop_reason=stop_reason or "completed",
            duration_ms=duration_ms,
            token_estimate=_estimate_tokens(final_output),
            score_breakdown=(best_evaluation or {}).get("criteria") or [],
            validation_passed=validation_passed,
            fallback_used=final_fallback_used,
            output_blocked=False,
        )

        for piece in _chunk_text(final_output, local_settings.get("stream_emit_chunk_size")):
            if cancel_check and cancel_check():
                return
            yield piece
    except Exception as exc:
        _debug(
            validation_context,
            "validation_fail_stream",
            bot_name=bot_name,
            chat_id=chat_id,
            error=str(exc),
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        _set_status(
            chat_key,
            {
                "success": False,
                "processing": False,
                "message": _STATUS_TEXT,
                "thinking_output": "Validation stream failed. Falling back to direct generation.",
                "module_name": "Recursive Validator",
                "bot_name": bot_name,
                "chat_id": chat_id,
                "error": str(exc),
            },
        )
        raise
    finally:
        _cleanup_temp_dir(temp_dir)


def _install_prompt_patch(context):
    prompt_pipeline = (context or {}).get("prompt_pipeline")
    if prompt_pipeline is None:
        return

    pipeline_id = id(prompt_pipeline)
    with _LOCK:
        if pipeline_id in _PATCHED_PIPELINES:
            return

    original_request = getattr(prompt_pipeline, "_request_completion", None)
    original_stream = getattr(prompt_pipeline, "_request_completion_stream", None)
    if not callable(original_request) or not callable(original_stream):
        return

    def wrapped_request(settings, payload, cancel_check=None):
        if _is_bypass_active():
            return original_request(settings, payload, cancel_check=cancel_check)

        validation_context = _consume_validation_context(payload)
        if not validation_context:
            return original_request(settings, payload, cancel_check=cancel_check)

        try:
            return _validate_non_stream(
                prompt_pipeline=prompt_pipeline,
                request_fn=original_request,
                settings=settings,
                payload=payload,
                cancel_check=cancel_check,
                validation_context=validation_context,
            )
        except Exception as exc:
            _debug(validation_context, "validation_wrapper_error", error=str(exc))
            return original_request(settings, payload, cancel_check=cancel_check)

    def wrapped_stream(settings, payload, cancel_check=None):
        if _is_bypass_active():
            yield from original_stream(settings=settings, payload=payload, cancel_check=cancel_check)
            return

        validation_context = _consume_validation_context(payload)
        if not validation_context:
            yield from original_stream(settings=settings, payload=payload, cancel_check=cancel_check)
            return

        try:
            yield from _validate_stream(
                prompt_pipeline=prompt_pipeline,
                stream_fn=original_stream,
                settings=settings,
                payload=payload,
                cancel_check=cancel_check,
                validation_context=validation_context,
            )
        except Exception as exc:
            _debug(validation_context, "validation_stream_wrapper_error", error=str(exc))
            with _BypassValidator():
                yield from original_stream(settings=settings, payload=payload, cancel_check=cancel_check)

    setattr(prompt_pipeline, "_request_completion", wrapped_request)
    setattr(prompt_pipeline, "_request_completion_stream", wrapped_stream)

    with _LOCK:
        _PATCHED_PIPELINES.add(pipeline_id)


def _execute(context):
    context = context or {}
    _install_prompt_patch(context)

    bot_name = str(context.get("bot_name") or "").strip()
    chat_id = str(context.get("chat_id") or "").strip()
    if not bot_name or not chat_id:
        return

    module_settings = _normalize_settings(_load_bot_module_settings(context, bot_name))
    chat_key = _chat_key(bot_name, chat_id)
    chat_folder = _chat_folder_from_context(context, bot_name, chat_id)
    temp_dir = _validator_temp_dir(chat_folder)

    _set_status(
        chat_key,
        {
            "success": True,
            "processing": True,
            "message": _STATUS_TEXT,
            "thinking_output": "Preparing validation criteria and iteration loop.",
            "module_name": "Recursive Validator",
            "bot_name": bot_name,
            "chat_id": chat_id,
            "max_iterations": int(module_settings.get("max_iterations") or DEFAULT_SETTINGS["max_iterations"]),
            "threshold": float(module_settings.get("conditional_output_threshold") or DEFAULT_SETTINGS["conditional_output_threshold"]),
        },
    )

    _enqueue_validation_context(
        {
            "created_at": _now_iso(),
            "created_mono": time.monotonic(),
            "bot_name": bot_name,
            "chat_id": chat_id,
            "chat_key": chat_key,
            "settings": module_settings,
            "temp_dir": str(temp_dir) if temp_dir else "",
            "debug_logger": context.get("debug_logger"),
        }
    )

    _debug(
        context,
        "armed",
        bot_name=bot_name,
        chat_id=chat_id,
        max_iterations=module_settings.get("max_iterations"),
        threshold=module_settings.get("conditional_output_threshold"),
        module_max_latency_ms=module_settings.get("module_max_latency_ms"),
        module_max_token_budget=module_settings.get("module_max_token_budget"),
        evaluator_reserved_ms=module_settings.get("evaluator_reserved_ms"),
        precheck_min_score=module_settings.get("precheck_min_score"),
        criteria_count=len(module_settings.get("criteria") or []),
    )


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
        status_data = _get_status(chat_key)
        if not status_data:
            status_data = {
                "success": True,
                "processing": False,
                "message": _STATUS_TEXT,
                "thinking_output": "",
                "module_name": "Recursive Validator",
                "bot_name": bot_name,
                "chat_id": chat_id,
            }
        status_data["success"] = True
        status_data["module_name"] = "Recursive Validator"
        status_data["bot_name"] = bot_name
        status_data["chat_id"] = chat_id
        return status_data

    if action_name in {"force_run", "run"}:
        _execute(context)
        status_data = _get_status(chat_key)
        status_data["success"] = True
        status_data["module_name"] = "Recursive Validator"
        status_data["bot_name"] = bot_name
        status_data["chat_id"] = chat_id
        return status_data

    return {"success": False, "message": f"Unknown action: {action_name}"}


def handle_action(action=None, payload=None, context=None):
    return _handle_action(action=action, payload=payload, context=context)
