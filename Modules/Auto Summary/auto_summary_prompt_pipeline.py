import json
import re
import threading
from datetime import datetime
from pathlib import Path

CORE_MARKER = "[[AUTO_SUMMARY_CORE]]"
HIDDEN_MARKER = "[[AUTO_SUMMARY_HIDDEN]]"
PHASE1_MARKER = "[[AUTO_SUMMARY_PHASE1]]"
PHASE2_MARKER = "[[AUTO_SUMMARY_PHASE2]]"
PHASE3_MARKER = "[[AUTO_SUMMARY_PHASE3]]"

_LOCK = threading.RLock()
_CHAT_LOCKS = {}
_RUNTIME_STORE = {
    "metadata": {},
    "status": {},
    "diagnostics": {},
}


def _get_chat_lock(bot_name, chat_id):
    key = f"{bot_name}::{chat_id}"
    with _LOCK:
        if key not in _CHAT_LOCKS:
            _CHAT_LOCKS[key] = threading.RLock()
        return _CHAT_LOCKS[key]


def _safe_name(value):
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", str(value or "unknown").strip())


def _runtime_key(bot_name, chat_id):
    return f"{_safe_name(bot_name)}::{_safe_name(chat_id)}"


def _metadata_key(bot_name, chat_id):
    return _runtime_key(bot_name, chat_id)


def _status_key(bot_name, chat_id):
    return _runtime_key(bot_name, chat_id)


def _diagnostic_key(bot_name, chat_id):
    return _runtime_key(bot_name, chat_id)


def _clone_payload(payload, fallback):
    try:
        return json.loads(json.dumps(payload))
    except Exception:
        return json.loads(json.dumps(fallback))


def _load_metadata(bot_name, chat_id):
    key = _metadata_key(bot_name, chat_id)
    with _LOCK:
        payload = _RUNTIME_STORE["metadata"].get(key)
    if not isinstance(payload, dict):
        return {"items": {}, "state": {}}
    data = _clone_payload(payload, {"items": {}, "state": {}})
    data.setdefault("items", {})
    data.setdefault("state", {})
    return data


def _save_metadata(bot_name, chat_id, payload):
    key = _metadata_key(bot_name, chat_id)
    data = _clone_payload(payload, {"items": {}, "state": {}})
    with _LOCK:
        _RUNTIME_STORE["metadata"][key] = data


def _save_status(bot_name, chat_id, data):
    key = _status_key(bot_name, chat_id)
    payload = _clone_payload(data, {"phase3_active": False, "message": "", "updated_at": ""})
    with _LOCK:
        _RUNTIME_STORE["status"][key] = payload


def _save_diagnostics(bot_name, chat_id, data):
    key = _diagnostic_key(bot_name, chat_id)
    payload = _clone_payload(data, {})
    with _LOCK:
        _RUNTIME_STORE["diagnostics"][key] = payload


def get_runtime_status_by_safe_names(safe_bot_name, safe_chat_id):
    key = f"{_safe_name(safe_bot_name)}::{_safe_name(safe_chat_id)}"
    fallback = {"phase3_active": False, "message": "", "updated_at": ""}
    with _LOCK:
        payload = _RUNTIME_STORE["status"].get(key)
    if not isinstance(payload, dict):
        return dict(fallback)
    data = _clone_payload(payload, fallback)
    data.setdefault("phase3_active", False)
    data.setdefault("message", "")
    data.setdefault("updated_at", "")
    return data


def _estimate_tokens(text):
    raw = str(text or "")
    if not raw.strip():
        return 0
    return max(1, int(round(len(raw) / 4)))


def _parse_bool(value, default=False):
    if isinstance(value, bool):
        return value
    txt = str(value or "").strip().lower()
    if txt in {"1", "true", "yes", "on"}:
        return True
    if txt in {"0", "false", "no", "off"}:
        return False
    return default


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


def _normalize_ratio(value, default):
    raw = _parse_float(value, default)
    if raw > 1.0:
        raw = raw / 100.0
    return max(0.0, raw)


def _debug(context, event, **details):
    logger = (context or {}).get("debug_logger")
    if logger is None:
        return
    try:
        if callable(logger):
            logger(f"auto_summary.{event}", **details)
            return
        if hasattr(logger, "log_event") and callable(getattr(logger, "log_event")):
            logger.log_event(f"auto_summary.{event}", **details)
    except Exception:
        return


def _extract_key_facts(text):
    raw = str(text or "")
    dates = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", raw)
    numbers = re.findall(r"\b\d+(?:\.\d+)?\b", raw)
    capitals = re.findall(r"\b[A-Z][a-zA-Z]{2,}\b", raw)
    facts = []
    for token in dates + numbers + capitals:
        if token not in facts:
            facts.append(token)
        if len(facts) >= 12:
            break
    return facts


def _validate_summary(summary_text, source_entries, max_chars=1200):
    text = str(summary_text or "").strip()
    if not text:
        return None

    source_blob = " ".join(_strip_marker_prefixes(item.get("content") or "") for item in (source_entries or []))
    source_facts = _extract_key_facts(source_blob)
    lowered = text.lower()
    missing = [fact for fact in source_facts if fact.lower() not in lowered][:4]
    if missing:
        text = f"{text} Key facts: {', '.join(missing)}."

    max_len = max(220, int(max_chars or 1200))
    if len(text) > max_len:
        text = text[:max_len].rsplit(" ", 1)[0].strip()

    return text if text else None


def _phase_gate_allowed(state, phase_name, metric_value, trigger, margin, cooldown_turns):
    phase_key = str(phase_name or "phase")
    armed_key = f"{phase_key}_armed"
    last_tick_key = f"{phase_key}_last_tick"
    tick = _parse_int(state.get("run_tick"), 0)

    armed = bool(state.get(armed_key, False))
    reset_threshold = max(0.0, float(trigger) - max(0.0, float(margin)))
    if armed and float(metric_value) <= reset_threshold:
        state[armed_key] = False
        armed = False

    if armed:
        return False

    last_tick = _parse_int(state.get(last_tick_key), -10**9)
    if int(cooldown_turns or 0) > 0 and (tick - last_tick) < int(cooldown_turns):
        return False

    return True


def _mark_phase_triggered(state, phase_name):
    phase_key = str(phase_name or "phase")
    state[f"{phase_key}_armed"] = True
    state[f"{phase_key}_last_tick"] = _parse_int(state.get("run_tick"), 0)


def _normalize_settings(raw):
    source = {str(k).strip().lower(): raw[k] for k in (raw or {}) if str(k).strip()}

    def pick(*keys, default=None):
        for key in keys:
            if key in source:
                return source[key]
        return default

    return {
        "phase1_trigger": _normalize_ratio(pick("phase1_trigger", "phase1_trigger_percent", "phase1_trigger_pct"), 0.30),
        "phase2_trigger": _normalize_ratio(pick("phase2_trigger"), 0.90),
        "phase2_goal": _normalize_ratio(pick("phase2_goal"), 0.50),
        "phase2_iam_count": max(2, _parse_int(pick("phase2_iam_count"), 5)),
        "phase3_trigger": _normalize_ratio(pick("phase3_trigger"), 0.90),
        "phase3_goal": _normalize_ratio(pick("phase3_goal"), 0.50),
        "phase3_iam_count": max(2, _parse_int(pick("phase3_iam_count", "phase3_count"), 3)),
        "hysteresis_margin": _normalize_ratio(pick("hysteresis_margin"), 0.05),
        "phase_cooldown_turns": max(0, _parse_int(pick("phase_cooldown_turns"), 0)),
        "phase3_max_passes": max(1, _parse_int(pick("phase3_max_passes"), 8)),
        "phase1_max_passes": max(1, _parse_int(pick("phase1_max_passes"), 24)),
        "phase2_max_passes": max(1, _parse_int(pick("phase2_max_passes"), 24)),
        "keep_lineage": _parse_bool(pick("keep_lineage"), True),
        "llm_max_tokens": max(64, _parse_int(pick("llm_max_tokens"), 220)),
        "llm_max_chars": max(240, _parse_int(pick("llm_max_chars"), 1000)),
    }


def _load_bot_module_settings(context, bot_name):
    bot_manager = context.get("bot_manager")
    if not bot_manager or not bot_name:
        return {}

    bot = None
    try:
        bot = bot_manager.load_bot(bot_name)
    except Exception:
        bot = None
    if not isinstance(bot, dict):
        return {}

    module_settings = bot.get("module_settings") or {}
    if not isinstance(module_settings, dict):
        return {}

    for key in ("Auto_Summary", "auto_summary", "AutoSummary"):
        value = module_settings.get(key)
        if isinstance(value, dict):
            return value
    return {}


def _load_iam_entries(chat_folder):
    iam_folder = Path(chat_folder) / "IAM"
    iam_folder.mkdir(parents=True, exist_ok=True)
    entries = []

    for iam_file in sorted(iam_folder.glob("*.txt")):
        try:
            payload = json.loads(iam_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue

        role = str(payload.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue

        content = str(payload.get("content") or "")
        entries.append({
            "file": iam_file,
            "file_name": iam_file.name,
            "role": role,
            "content": content,
            "timestamp": payload.get("timestamp") or datetime.now().isoformat(),
            "order": _parse_int(payload.get("order"), 0),
        })

    entries.sort(key=lambda item: (item.get("order", 0), item.get("file_name", "")))
    return entries


def _write_entry(entry):
    payload = {
        "role": entry.get("role") or "assistant",
        "content": entry.get("content") or "",
        "timestamp": entry.get("timestamp") or datetime.now().isoformat(),
        "order": int(entry.get("order") or 0),
    }
    Path(entry["file"]).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _strip_marker_prefixes(text):
    result = str(text or "")
    for marker in (CORE_MARKER, HIDDEN_MARKER, PHASE1_MARKER, PHASE2_MARKER, PHASE3_MARKER):
        result = result.replace(marker, " ")
    return re.sub(r"\s+", " ", result).strip()


def _ensure_prefix(text, marker):
    raw = str(text or "")
    if marker in raw:
        return raw
    return f"{marker} {raw}".strip()


def _compress_light(text):
    raw = _strip_marker_prefixes(text)
    if not raw:
        return raw
    filler_words = {
        "just", "really", "very", "actually", "basically", "literally", "kind", "sort",
        "maybe", "perhaps", "quite", "simply", "honestly", "totally", "definitely"
    }

    words = re.split(r"\s+", raw)
    compact = []
    for word in words:
        clean = re.sub(r"[^a-zA-Z]", "", word).lower()
        if clean and clean in filler_words:
            continue
        compact.append(word)

    out = " ".join(compact)
    out = re.sub(r"\s+", " ", out).strip()
    if len(out) > 900:
        out = out[:900].rsplit(" ", 1)[0].strip()
    return out or raw


def _summarize_group_deterministic(entries, phase_name):
    lines = []
    for item in entries:
        role = str(item.get("role") or "assistant").upper()
        txt = _strip_marker_prefixes(item.get("content") or "")
        if txt:
            lines.append(f"{role}: {txt}")

    merged = " ".join(lines)
    merged = re.sub(r"\s+", " ", merged).strip()
    if len(merged) > 1200:
        merged = merged[:1200].rsplit(" ", 1)[0].strip()

    title = "Phase2" if phase_name == "phase2" else "Phase3"
    if not merged:
        return f"{title} summary: (no content)"
    return f"{title} summary: {merged}"


def _llm_summarize_group(context, summary_settings, entries):
    prompt_pipeline = context.get("prompt_pipeline")
    settings_manager = context.get("settings_manager")
    if not prompt_pipeline or not settings_manager:
        return None

    if not hasattr(prompt_pipeline, "_build_request_payload") or not hasattr(prompt_pipeline, "_request_completion"):
        return None

    source_text = []
    for entry in entries:
        role = str(entry.get("role") or "assistant").upper()
        content = _strip_marker_prefixes(entry.get("content") or "")
        if content:
            source_text.append(f"{role}: {content}")

    if not source_text:
        return None

    settings = settings_manager.get_all() if hasattr(settings_manager, "get_all") else {}
    messages = [
        {
            "role": "system",
            "content": (
                "You summarize old chat context for memory compression. "
                "Preserve factual details, names, commitments, dates, and preferences. "
                "Do not invent information. Output concise plain text."
            )
        },
        {
            "role": "user",
            "content": (
                f"Create a concise context summary under {summary_settings.get('llm_max_chars', 1000)} characters.\n\n"
                + "\n".join(source_text)
            )
        }
    ]

    payload = prompt_pipeline._build_request_payload(settings, messages)
    payload["max_tokens"] = max(96, _parse_int(summary_settings.get("llm_max_tokens"), 220))

    text, error = prompt_pipeline._request_completion(settings, payload)
    if error or not isinstance(text, str) or not text.strip():
        return None

    out = text.strip()
    max_chars = max(300, _parse_int(summary_settings.get("llm_max_chars"), 1000))
    if len(out) > max_chars:
        out = out[:max_chars].rsplit(" ", 1)[0].strip()
    return out


def _context_usage(entries, max_tokens):
    total = 0
    phase0 = 0
    for item in entries:
        tokens = _estimate_tokens(item.get("content") or "")
        total += tokens
        if int(item.get("phase", 0)) == 0:
            phase0 += tokens
    max_val = max(1, int(max_tokens or 1))
    return {
        "usage": total / max_val,
        "unmodified_usage": phase0 / max_val,
        "total_tokens": total,
        "phase0_tokens": phase0,
    }


def _refresh_meta_for_entries(meta_payload, entries):
    items = meta_payload.setdefault("items", {})
    for entry in entries:
        key = entry["file_name"]
        existing = items.get(key) if isinstance(items.get(key), dict) else {}
        existing.setdefault("iam_id", key)
        existing.setdefault("phase", 0)
        existing.setdefault("summarized_phase1", False)
        existing.setdefault("summarized_phase2", False)
        existing.setdefault("protected_core", False)
        existing.setdefault("hidden_from_chat", False)
        existing.setdefault("merged_out", False)
        existing.setdefault("source_iam_ids", [])
        existing.setdefault("created_at", datetime.now().isoformat())

        if CORE_MARKER in str(entry.get("content") or ""):
            existing["protected_core"] = True

        existing["updated_at"] = datetime.now().isoformat()
        existing["token_count"] = _estimate_tokens(entry.get("content") or "")
        items[key] = existing

    known = {entry["file_name"] for entry in entries}
    for file_name in list(items.keys()):
        if file_name not in known:
            items.pop(file_name, None)


def _phase1_select(entries, meta_items):
    for entry in entries:
        meta = meta_items.get(entry["file_name"], {})
        if meta.get("merged_out"):
            continue
        if meta.get("protected_core"):
            continue
        if int(meta.get("phase", 0)) != 0:
            continue
        return entry, meta
    return None, None


def _phase2_candidates(entries, meta_items):
    output = []
    for entry in entries:
        meta = meta_items.get(entry["file_name"], {})
        if meta.get("merged_out") or meta.get("protected_core"):
            continue
        if int(meta.get("phase", 0)) == 1:
            output.append((entry, meta))
    return output


def _phase3_candidates(entries, meta_items):
    output = []
    for entry in entries:
        meta = meta_items.get(entry["file_name"], {})
        if meta.get("merged_out") or meta.get("protected_core"):
            continue
        if int(meta.get("phase", 0)) in (1, 2):
            output.append((entry, meta))
    return output


def _mark_hidden_phase(entry, marker, phase_value):
    cleaned = _strip_marker_prefixes(entry.get("content") or "")
    entry["content"] = _ensure_prefix(cleaned, marker)
    entry["content"] = _ensure_prefix(entry["content"], HIDDEN_MARKER)
    entry["phase"] = phase_value


def _run_phase1(entries, meta_payload, settings):
    items = meta_payload["items"]
    max_passes = settings["phase1_max_passes"]
    applied = 0

    while applied < max_passes:
        usage = _context_usage(entries, settings["max_tokens"])
        if usage["unmodified_usage"] <= settings["phase1_trigger"]:
            break

        entry, meta = _phase1_select(entries, items)
        if not entry:
            break

        compressed = _compress_light(entry.get("content") or "")
        entry["content"] = _ensure_prefix(compressed, PHASE1_MARKER)
        entry["content"] = _ensure_prefix(entry["content"], HIDDEN_MARKER)

        meta["phase"] = 1
        meta["summarized_phase1"] = True
        meta["hidden_from_chat"] = True
        meta["token_count"] = _estimate_tokens(entry["content"])
        meta["updated_at"] = datetime.now().isoformat()

        _write_entry(entry)
        applied += 1

    return applied


def _run_phase2(entries, meta_payload, settings):
    items = meta_payload["items"]
    applied = 0
    max_passes = settings["phase2_max_passes"]

    while applied < max_passes:
        usage = _context_usage(entries, settings["max_tokens"])
        candidates = _phase2_candidates(entries, items)
        if usage["usage"] <= settings["phase2_trigger"]:
            break
        if usage["usage"] <= settings["phase2_goal"]:
            break
        if len(candidates) < (settings["phase2_iam_count"] + 1):
            break

        group_pairs = candidates[: settings["phase2_iam_count"]]
        group = [pair[0] for pair in group_pairs]
        summary = _summarize_group_deterministic(group, "phase2")
        summary = _validate_summary(summary, group, max_chars=settings.get("llm_max_chars", 1000))
        if not summary:
            break

        first_entry, first_meta = group_pairs[0]
        first_entry["content"] = _ensure_prefix(summary, PHASE2_MARKER)
        first_entry["content"] = _ensure_prefix(first_entry["content"], HIDDEN_MARKER)
        first_meta["phase"] = 2
        first_meta["summarized_phase2"] = True
        first_meta["hidden_from_chat"] = True
        first_meta["source_iam_ids"] = [item[0]["file_name"] for item in group_pairs] if settings.get("keep_lineage", True) else []
        first_meta["updated_at"] = datetime.now().isoformat()

        _write_entry(first_entry)

        for other_entry, other_meta in group_pairs[1:]:
            other_entry["content"] = _ensure_prefix("Merged into newer summary.", HIDDEN_MARKER)
            other_meta["phase"] = 2
            other_meta["merged_out"] = True
            other_meta["hidden_from_chat"] = True
            other_meta["updated_at"] = datetime.now().isoformat()
            _write_entry(other_entry)

        applied += 1

    return applied


def _run_phase3(entries, meta_payload, settings, context, bot_name, chat_id):
    items = meta_payload["items"]
    applied = 0
    max_passes = settings["phase3_max_passes"]

    phase_started = False

    try:
        while applied < max_passes:
            usage = _context_usage(entries, settings["max_tokens"])
            if usage["usage"] <= settings["phase3_trigger"]:
                break
            if usage["usage"] <= settings["phase3_goal"]:
                break

            phase2_ready = _phase2_candidates(entries, items)
            if len(phase2_ready) >= (settings["phase2_iam_count"] + 1):
                break

            candidates = _phase3_candidates(entries, items)
            if not candidates:
                break

            group_pairs = candidates[: settings["phase3_iam_count"]]
            group = [pair[0] for pair in group_pairs]

            llm_summary = _llm_summarize_group(context, settings, group)
            summary = llm_summary or _summarize_group_deterministic(group, "phase3")
            summary = _validate_summary(summary, group, max_chars=settings.get("llm_max_chars", 1000))
            if not summary:
                break

            if not phase_started:
                phase_started = True
                _save_status(bot_name, chat_id, {
                    "phase3_active": True,
                    "message": "Summarizing chat history. This might take a while...",
                    "updated_at": datetime.now().isoformat(),
                })

            first_entry, first_meta = group_pairs[0]
            first_entry["content"] = _ensure_prefix(summary, PHASE3_MARKER)
            first_entry["content"] = _ensure_prefix(first_entry["content"], HIDDEN_MARKER)
            first_meta["phase"] = 3
            first_meta["hidden_from_chat"] = True
            first_meta["source_iam_ids"] = [item[0]["file_name"] for item in group_pairs] if settings.get("keep_lineage", True) else []
            first_meta["updated_at"] = datetime.now().isoformat()
            _write_entry(first_entry)

            for other_entry, other_meta in group_pairs[1:]:
                other_entry["content"] = _ensure_prefix("Merged into phase3 summary.", HIDDEN_MARKER)
                other_meta["phase"] = 3
                other_meta["merged_out"] = True
                other_meta["hidden_from_chat"] = True
                other_meta["updated_at"] = datetime.now().isoformat()
                _write_entry(other_entry)

            applied += 1
            _save_status(bot_name, chat_id, {
                "phase3_active": True,
                "message": "Summarizing chat history. This might take a while...",
                "pass": applied,
                "updated_at": datetime.now().isoformat(),
            })
    finally:
        if phase_started:
            _save_status(bot_name, chat_id, {
                "phase3_active": False,
                "message": "",
                "updated_at": datetime.now().isoformat(),
            })

    return applied


def _execute(context):
    bot_name = context.get("bot_name")
    chat_id = context.get("chat_id")
    chat_manager = context.get("chat_manager")

    if not bot_name or not chat_id or chat_manager is None:
        return

    module_settings = _load_bot_module_settings(context, bot_name)
    settings = _normalize_settings(module_settings)
    settings["max_tokens"] = max(1, _parse_int(context.get("settings_manager").get("max_tokens", 10000) if context.get("settings_manager") else 10000, 10000))

    lock = _get_chat_lock(bot_name, chat_id)
    with lock:
        try:
            chat_folder = chat_manager._get_chat_folder(chat_id, bot_name)
        except Exception:
            chat_folder = None

        if not chat_folder:
            return

        entries = _load_iam_entries(chat_folder)
        if not entries:
            return

        meta_payload = _load_metadata(bot_name, chat_id)
        _refresh_meta_for_entries(meta_payload, entries)
        state = meta_payload.setdefault("state", {})
        state["run_tick"] = _parse_int(state.get("run_tick"), 0) + 1

        usage_before = _context_usage(entries, settings["max_tokens"])
        _debug(
            context,
            "run_begin",
            bot_name=bot_name,
            chat_id=chat_id,
            usage=round(usage_before["usage"], 4),
            unmodified_usage=round(usage_before["unmodified_usage"], 4),
            total_tokens=usage_before["total_tokens"],
        )
        _debug(
            context,
            "settings_effective",
            phase1_trigger=round(settings["phase1_trigger"], 4),
            phase2_trigger=round(settings["phase2_trigger"], 4),
            phase2_goal=round(settings["phase2_goal"], 4),
            phase2_iam_count=settings["phase2_iam_count"],
            phase3_trigger=round(settings["phase3_trigger"], 4),
            phase3_goal=round(settings["phase3_goal"], 4),
            phase3_iam_count=settings["phase3_iam_count"],
            hysteresis_margin=round(settings["hysteresis_margin"], 4),
            phase_cooldown_turns=settings["phase_cooldown_turns"],
            max_tokens=settings["max_tokens"],
        )

        phase2_candidates_initial = len(_phase2_candidates(entries, meta_payload.get("items", {})))
        phase3_candidates_initial = len(_phase3_candidates(entries, meta_payload.get("items", {})))

        phase1_ready = _phase_gate_allowed(
            state,
            "phase1",
            usage_before["unmodified_usage"],
            settings["phase1_trigger"],
            settings["hysteresis_margin"],
            settings["phase_cooldown_turns"],
        ) and (usage_before["unmodified_usage"] > settings["phase1_trigger"])

        if not phase1_ready:
            reason = "below_trigger"
            if not _phase_gate_allowed(
                dict(state),
                "phase1",
                usage_before["unmodified_usage"],
                settings["phase1_trigger"],
                settings["hysteresis_margin"],
                settings["phase_cooldown_turns"],
            ):
                reason = "gate_blocked"
            _debug(context, "phase1_skipped", reason=reason, unmodified_usage=round(usage_before["unmodified_usage"], 4))

        phase1_count = 0
        if phase1_ready:
            before = _context_usage(entries, settings["max_tokens"])
            phase1_count = _run_phase1(entries, meta_payload, settings)
            after = _context_usage(entries, settings["max_tokens"])
            if phase1_count > 0:
                _mark_phase_triggered(state, "phase1")
            _debug(
                context,
                "phase1_complete",
                applied=phase1_count,
                token_delta=(after["total_tokens"] - before["total_tokens"]),
                usage_after=round(after["usage"], 4),
            )

        phase2_count = 0
        usage_mid = _context_usage(entries, settings["max_tokens"])
        phase2_gate_ok = _phase_gate_allowed(
            state,
            "phase2",
            usage_mid["usage"],
            settings["phase2_trigger"],
            settings["hysteresis_margin"],
            settings["phase_cooldown_turns"],
        )
        phase2_ready = phase2_gate_ok and usage_mid["usage"] > settings["phase2_trigger"] and phase2_candidates_initial >= (settings["phase2_iam_count"] + 1)

        if not phase2_ready:
            reason = "below_trigger"
            if not phase2_gate_ok:
                reason = "gate_blocked"
            elif phase2_candidates_initial < (settings["phase2_iam_count"] + 1):
                reason = "insufficient_phase1_candidates"
            _debug(
                context,
                "phase2_skipped",
                reason=reason,
                usage=round(usage_mid["usage"], 4),
                candidates=phase2_candidates_initial,
                required=(settings["phase2_iam_count"] + 1),
            )

        if phase2_ready:
            before = _context_usage(entries, settings["max_tokens"])
            phase2_count = _run_phase2(entries, meta_payload, settings)
            after = _context_usage(entries, settings["max_tokens"])
            if phase2_count > 0:
                _mark_phase_triggered(state, "phase2")
            _debug(
                context,
                "phase2_complete",
                applied=phase2_count,
                token_delta=(after["total_tokens"] - before["total_tokens"]),
                usage_after=round(after["usage"], 4),
            )

        phase3_count = 0
        usage_late = _context_usage(entries, settings["max_tokens"])
        phase3_gate_ok = _phase_gate_allowed(
            state,
            "phase3",
            usage_late["usage"],
            settings["phase3_trigger"],
            settings["hysteresis_margin"],
            settings["phase_cooldown_turns"],
        )
        phase2_candidates_late = len(_phase2_candidates(entries, meta_payload.get("items", {})))
        phase3_candidates_late = len(_phase3_candidates(entries, meta_payload.get("items", {})))
        phase3_ready = phase3_gate_ok and usage_late["usage"] > settings["phase3_trigger"] and phase2_candidates_late < (settings["phase2_iam_count"] + 1) and phase3_candidates_late > 0

        if not phase3_ready:
            reason = "below_trigger"
            if not phase3_gate_ok:
                reason = "gate_blocked"
            elif phase2_candidates_late >= (settings["phase2_iam_count"] + 1):
                reason = "phase2_still_possible"
            elif phase3_candidates_late <= 0:
                reason = "no_phase3_candidates"
            _debug(
                context,
                "phase3_skipped",
                reason=reason,
                usage=round(usage_late["usage"], 4),
                phase2_candidates=phase2_candidates_late,
                phase3_candidates=phase3_candidates_late,
            )

        if phase3_ready:
            before = _context_usage(entries, settings["max_tokens"])
            phase3_count = _run_phase3(entries, meta_payload, settings, context, bot_name, chat_id)
            after = _context_usage(entries, settings["max_tokens"])
            if phase3_count > 0:
                _mark_phase_triggered(state, "phase3")
            _debug(
                context,
                "phase3_complete",
                applied=phase3_count,
                token_delta=(after["total_tokens"] - before["total_tokens"]),
                usage_after=round(after["usage"], 4),
            )

        state.update({
            "last_run_at": datetime.now().isoformat(),
            "last_phase1_changes": phase1_count,
            "last_phase2_changes": phase2_count,
            "last_phase3_changes": phase3_count,
        })

        _refresh_meta_for_entries(meta_payload, entries)
        _save_metadata(bot_name, chat_id, meta_payload)
        usage_final = _context_usage(entries, settings["max_tokens"])
        diagnostics = {
            "updated_at": datetime.now().isoformat(),
            "bot_name": bot_name,
            "chat_id": chat_id,
            "run_tick": _parse_int(state.get("run_tick"), 0),
            "effective_settings": {
                "phase1_trigger": settings["phase1_trigger"],
                "phase2_trigger": settings["phase2_trigger"],
                "phase2_goal": settings["phase2_goal"],
                "phase2_iam_count": settings["phase2_iam_count"],
                "phase3_trigger": settings["phase3_trigger"],
                "phase3_goal": settings["phase3_goal"],
                "phase3_iam_count": settings["phase3_iam_count"],
                "hysteresis_margin": settings["hysteresis_margin"],
                "phase_cooldown_turns": settings["phase_cooldown_turns"],
                "max_tokens": settings["max_tokens"],
            },
            "usage": {
                "before": usage_before,
                "final": usage_final,
            },
            "candidates": {
                "phase2_initial": phase2_candidates_initial,
                "phase3_initial": phase3_candidates_initial,
                "phase2_late": phase2_candidates_late,
                "phase3_late": phase3_candidates_late,
            },
            "phase_runs": {
                "phase1_applied": phase1_count,
                "phase2_applied": phase2_count,
                "phase3_applied": phase3_count,
            },
        }
        _save_diagnostics(bot_name, chat_id, diagnostics)
        _debug(
            context,
            "run_complete",
            bot_name=bot_name,
            chat_id=chat_id,
            usage=round(usage_final["usage"], 4),
            total_tokens=usage_final["total_tokens"],
            phase1=phase1_count,
            phase2=phase2_count,
            phase3=phase3_count,
        )


def extend(context=None):
    context = context or {}
    try:
        _execute(context)
    except Exception:
        return
