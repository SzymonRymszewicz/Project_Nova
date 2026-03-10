import json
import re
import threading
from datetime import datetime
from pathlib import Path
import time

_LOCK = threading.RLock()
_PATCHED_PIPELINES = set()
_ACTIVE_RUNS = set()

DEFAULT_SETTINGS = {
	"messages_per_event": 10,
	"max_events": 10,
	"context_max_events": 4,
	"inject_top_k_events": 3,
	"context_max_chars": 900,
	"summary_max_chars": 380,
	"module_max_latency_ms": 9000,
	"llm_max_tokens": 260,
	"llm_max_retries": 1,
	"question_timeline_summary": "Write one detailed timeline summary that captures what happened, important dynamics, and continuity-relevant outcomes.",
}

ALLOWED_PRIORITY_TAGS = {"critical", "relationship", "location", "objective"}


def _now_iso():
	return datetime.now().isoformat()


def _debug(context, event, **details):
	logger = (context or {}).get("debug_logger")
	if logger is None:
		return
	try:
		if callable(logger):
			logger(f"event_tracking.{event}", **details)
			return
		if hasattr(logger, "log_event") and callable(getattr(logger, "log_event")):
			logger.log_event(f"event_tracking.{event}", **details)
	except Exception:
		return


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


def _safe_read_json(path):
	if not path.exists() or not path.is_file():
		return None
	try:
		payload = json.loads(path.read_text(encoding="utf-8"))
		return payload if isinstance(payload, dict) else None
	except Exception:
		return None


def _atomic_write_json(path, payload):
	path.parent.mkdir(parents=True, exist_ok=True)
	temp_path = path.with_suffix(path.suffix + ".tmp")
	temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
	temp_path.replace(path)


def _parse_settings_kv_text(raw_text):
	result = {}
	for raw_line in str(raw_text or "").splitlines():
		line = str(raw_line or "").strip()
		if not line or line.startswith("#") or line.startswith(";"):
			continue
		if "=" in line:
			key, value = line.split("=", 1)
		elif ":" in line:
			key, value = line.split(":", 1)
		else:
			continue
		key_text = str(key or "").strip()
		if not key_text:
			continue
		result[key_text] = str(value or "").strip()
	return result


def _load_bot_module_settings(context, bot_name):
	bot_manager = (context or {}).get("bot_manager")
	if not bot_manager or not bot_name:
		return {}

	# Read per-bot module settings directly to avoid repeated BotManager.load_bot
	# during status polling, which can look like an app loop in console output.
	try:
		bots_folder = Path(getattr(bot_manager, "bots_folder", ""))
		if not bots_folder:
			return {}
		settings_path = bots_folder / bot_name / "ModuleSettings" / "settings_event_tracking.txt"
		if not settings_path.exists() or not settings_path.is_file():
			return {}
		parsed = _parse_settings_kv_text(settings_path.read_text(encoding="utf-8"))
		return parsed if isinstance(parsed, dict) else {}
	except Exception:
		return {}
	return {}


def _normalize_settings(raw):
	source = {str(k).strip().lower(): raw[k] for k in (raw or {}) if str(k).strip()}

	def pick(*keys, default=None):
		for key in keys:
			if key in source:
				return source[key]
		return default

	settings = dict(DEFAULT_SETTINGS)
	settings["messages_per_event"] = max(1, _parse_int(pick("messages_per_event"), DEFAULT_SETTINGS["messages_per_event"]))
	settings["max_events"] = max(1, _parse_int(pick("max_events"), DEFAULT_SETTINGS["max_events"]))
	settings["context_max_events"] = max(1, _parse_int(pick("context_max_events"), DEFAULT_SETTINGS["context_max_events"]))
	settings["inject_top_k_events"] = max(1, _parse_int(pick("inject_top_k_events"), DEFAULT_SETTINGS["inject_top_k_events"]))
	settings["context_max_chars"] = max(120, _parse_int(pick("context_max_chars"), DEFAULT_SETTINGS["context_max_chars"]))
	settings["summary_max_chars"] = max(120, _parse_int(pick("summary_max_chars"), DEFAULT_SETTINGS["summary_max_chars"]))
	settings["module_max_latency_ms"] = max(100, _parse_int(pick("module_max_latency_ms"), DEFAULT_SETTINGS["module_max_latency_ms"]))
	settings["llm_max_tokens"] = max(64, _parse_int(pick("llm_max_tokens"), DEFAULT_SETTINGS["llm_max_tokens"]))
	settings["llm_max_retries"] = max(0, _parse_int(pick("llm_max_retries"), DEFAULT_SETTINGS["llm_max_retries"]))

	for key in (
		"question_timeline_summary",
	):
		value = str(pick(key, default=settings[key]) or "").strip()
		if value:
			settings[key] = value

	return settings


def _estimate_tokens(text):
	raw = str(text or "")
	if not raw.strip():
		return 0
	return max(1, int(round(len(raw) / 4)))


def _normalize_relevance_score(value, default=0.5):
	score = _parse_float(value, default)
	if score > 1.0:
		score = score / 100.0
	return max(0.0, min(1.0, score))


def _normalize_priority_tags(value):
	if not isinstance(value, list):
		return []
	result = []
	for item in value:
		tag = str(item or "").strip().lower()
		if tag not in ALLOWED_PRIORITY_TAGS or tag in result:
			continue
		result.append(tag)
	return result[:4]


def _derive_priority_tags_from_text(text):
	raw = str(text or "").lower()
	tags = []
	if any(token in raw for token in ("goal", "objective", "plan", "mission", "quest", "task")):
		tags.append("objective")
	if any(token in raw for token in ("trust", "bond", "argue", "conflict", "feel", "emotion", "relationship")):
		tags.append("relationship")
	if any(token in raw for token in ("arrive", "left", "room", "place", "location", "city", "forest", "time", "day", "night")):
		tags.append("location")
	if any(token in raw for token in ("must", "urgent", "danger", "critical", "immediately", "now")):
		tags.append("critical")
	if not tags:
		tags.append("objective")
	return tags[:3]


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
			"content": str(content),
			"order": order_num,
			"timestamp": str(payload.get("timestamp") or ""),
		})

	rows.sort(key=lambda item: (item.get("order", 0), item.get("file", "")))
	return rows


def _events_dir_from_context(context, bot_name, chat_id):
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
	events_dir = folder / "Events"
	events_dir.mkdir(parents=True, exist_ok=True)
	return events_dir


def _meta_path(events_dir):
	return events_dir / "events_meta.json"


def _status_path(events_dir):
	return events_dir / "event_tracking_status.json"


def _event_file(events_dir, event_id):
	return events_dir / f"{event_id}.json"


def _load_meta(events_dir):
	payload = _safe_read_json(_meta_path(events_dir))
	if not isinstance(payload, dict):
		payload = {}
	payload.setdefault("last_processed_count", 0)
	payload.setdefault("next_event_index", 1)
	payload.setdefault("auto_event_creation_enabled", True)
	payload.setdefault("last_created_event_id", "")
	payload.setdefault("last_created_at", "")
	payload.setdefault("updated_at", "")
	return payload


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


def _save_meta(events_dir, meta):
	meta["updated_at"] = _now_iso()
	_atomic_write_json(_meta_path(events_dir), meta)


def _write_status(events_dir, payload):
	payload = dict(payload or {})
	payload["updated_at"] = _now_iso()
	_atomic_write_json(_status_path(events_dir), payload)


def _extract_json_object(text):
	raw = str(text or "").strip()
	if not raw:
		return None

	if raw.startswith("```"):
		raw = raw.strip("`\n ")
		if raw.lower().startswith("json"):
			raw = raw[4:].strip()

	start = raw.find("{")
	end = raw.rfind("}")
	if start >= 0 and end > start:
		raw = raw[start:end + 1]

	try:
		payload = json.loads(raw)
		if isinstance(payload, str):
			payload = json.loads(payload)
		return payload if isinstance(payload, dict) else None
	except Exception:
		return None


def _extract_plain_text(value, max_chars):
	if value is None:
		return ""
	if isinstance(value, str):
		return _truncate(value, max_chars)
	if isinstance(value, (int, float, bool)):
		return _truncate(str(value), max_chars)
	if isinstance(value, dict):
		preferred_keys = [
			"timeline_summary",
			"summary",
			"details",
			"detail",
			"topic",
			"outcome",
			"result",
			"situation",
			"change",
			"relationship",
		]
		parts = []
		for key in preferred_keys:
			if key in value:
				text = _extract_plain_text(value.get(key), max_chars)
				if text:
					parts.append(text)
		if not parts:
			for key, item in value.items():
				text = _extract_plain_text(item, max_chars)
				if text:
					parts.append(text)
				if len(parts) >= 3:
					break
		return _truncate(" | ".join(parts), max_chars)
	if isinstance(value, list):
		parts = []
		for item in value[:4]:
			text = _extract_plain_text(item, max_chars)
			if text:
				parts.append(text)
		return _truncate(" | ".join(parts), max_chars)
	return _truncate(str(value), max_chars)


def _sanitize_timeline_summary_text(value, max_chars):
	raw = str(value or "")
	if not raw:
		return ""

	cleaned = raw.strip()
	# Remove markdown fences and formatting artifacts that occasionally leak from LLM output.
	cleaned = re.sub(r"^```(?:json|text|md|markdown)?\\s*", "", cleaned, flags=re.IGNORECASE)
	cleaned = re.sub(r"\\s*```$", "", cleaned)
	cleaned = cleaned.replace("```", " ")
	cleaned = cleaned.strip("` \n\r\t")
	cleaned = _truncate(cleaned, max_chars)

	invalid_values = {
		"",
		"n/a",
		"na",
		"none",
		"null",
		"undefined",
		"no summary",
		"no event",
	}
	if cleaned.lower() in invalid_values:
		return ""

	return cleaned


def _looks_like_json_blob(text):
	raw = str(text or "").strip()
	if not raw:
		return False
	if raw.startswith("{") or raw.startswith("["):
		return True
	brace_count = raw.count("{") + raw.count("}") + raw.count("[") + raw.count("]")
	quote_colon_pairs = raw.count('":')
	if brace_count >= 4 and quote_colon_pairs >= 2:
		return True
	return False


def _clean_summary_payload(summary_data, batch_messages, settings):
	data = dict(summary_data or {})

	timeline_summary = _extract_plain_text(data.get("timeline_summary"), settings["summary_max_chars"])
	timeline_summary = _sanitize_timeline_summary_text(timeline_summary, settings["summary_max_chars"])
	if not timeline_summary:
		legacy_parts = [
			_extract_plain_text(data.get("summary"), settings["summary_max_chars"]),
			_extract_plain_text(data.get("what_was_going_on"), settings["summary_max_chars"]),
			_extract_plain_text(data.get("character_dynamics"), settings["summary_max_chars"]),
			_extract_plain_text(data.get("time_place"), settings["summary_max_chars"]),
			_extract_plain_text(data.get("key_outcome"), settings["summary_max_chars"]),
		]
		legacy_parts = [part for part in legacy_parts if part]
		timeline_summary = _truncate(" ".join(legacy_parts), settings["summary_max_chars"])
		timeline_summary = _sanitize_timeline_summary_text(timeline_summary, settings["summary_max_chars"])

	if _looks_like_json_blob(timeline_summary):
		timeline_summary = ""

	if not timeline_summary:
		timeline_summary = _deterministic_summary(batch_messages, settings).get("timeline_summary", "")
		timeline_summary = _sanitize_timeline_summary_text(timeline_summary, settings["summary_max_chars"])

	cleaned = {
		"timeline_summary": _truncate(timeline_summary, settings["summary_max_chars"]),
	}

	priority_tags = _normalize_priority_tags(data.get("priority_tags"))
	if not priority_tags:
		priority_tags = _derive_priority_tags_from_text(
			cleaned["timeline_summary"]
		)

	cleaned["priority_tags"] = priority_tags
	cleaned["relevance_score"] = _normalize_relevance_score(data.get("relevance_score"), 0.6)
	return cleaned


def _coerce_summary_from_text(raw_text, settings, batch_messages):
	text = str(raw_text or "")
	if not text.strip():
		return None

	def pick(labels):
		for label in labels:
			pattern = rf"(?im)^\s*{re.escape(label)}\s*:\s*(.+)$"
			match = re.search(pattern, text)
			if match:
				value = _truncate(match.group(1).strip(), settings["summary_max_chars"])
				if value:
					return value
		return ""

	timeline_summary = pick(["timeline_summary", "timeline summary", "summary"])
	if not timeline_summary:
		timeline_summary = _truncate(text.splitlines()[0] if text.splitlines() else text, settings["summary_max_chars"])
	timeline_summary = _sanitize_timeline_summary_text(timeline_summary, settings["summary_max_chars"])

	if not timeline_summary:
		return None

	relevance_match = re.search(r"(?i)relevance(?:_score)?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)", text)
	relevance_raw = relevance_match.group(1) if relevance_match else 0.6

	priority_tags = []
	tags_match = re.search(r"(?i)priority(?:_tags)?\s*[:=]\s*([^\n]+)", text)
	if tags_match:
		raw_tags = re.split(r"[,;|]", tags_match.group(1))
		priority_tags = _normalize_priority_tags(raw_tags)

	if not priority_tags:
		priority_tags = _derive_priority_tags_from_text(timeline_summary)

	result = {
		"timeline_summary": _truncate(timeline_summary, settings["summary_max_chars"]),
		"priority_tags": priority_tags,
		"relevance_score": _normalize_relevance_score(relevance_raw, 0.6),
	}
	return _clean_summary_payload(result, batch_messages, settings)


def _truncate(text, max_chars):
	raw = re.sub(r"\s+", " ", str(text or "")).strip()
	if len(raw) <= max_chars:
		return raw
	trimmed = raw[:max_chars]
	if " " in trimmed:
		trimmed = trimmed.rsplit(" ", 1)[0]
	return trimmed.strip()


def _build_detail_hints_from_batch(batch_messages, max_items=3):
	hints = []
	for row in (batch_messages or []):
		role = str(row.get("role") or "").strip().lower()
		content = _truncate(str(row.get("content") or "").strip(), 120)
		if not content:
			continue
		prefix = "User" if role == "user" else "Assistant"
		hints.append(f"{prefix}: {content}")
		if len(hints) >= max_items:
			break
	return hints


def _enforce_what_was_going_on_detail(value, batch_messages, settings):
	raw = _truncate(value or "", settings["summary_max_chars"])
	low_value_markers = (
		"casual conversation",
		"normal conversation",
		"just chatting",
		"chat",
		"discussion",
		"talking",
	)
	is_low_value = (not raw) or len(raw) < 42 or any(marker in raw.lower() for marker in low_value_markers)
	if not is_low_value:
		return raw

	hints = _build_detail_hints_from_batch(batch_messages, max_items=3)
	if not hints:
		return raw or "Conversation progressed with specific user requests and assistant responses."

	if raw:
		improved = f"{raw} Details: {' | '.join(hints)}"
	else:
		improved = f"Conversation details: {' | '.join(hints)}"
	return _truncate(improved, settings["summary_max_chars"])


def _deterministic_summary(batch_messages, settings):
	if not batch_messages:
		return {
			"timeline_summary": "No significant continuity event could be extracted from this window.",
		}

	roles = {"user": 0, "assistant": 0}
	for row in batch_messages:
		role = str(row.get("role") or "").lower()
		if role in roles:
			roles[role] += 1

	first = _truncate(batch_messages[0].get("content") or "", 160)
	last = _truncate(batch_messages[-1].get("content") or "", 180)
	details = _enforce_what_was_going_on_detail(
		first or "Conversation progressed through a short exchange.",
		batch_messages,
		settings,
	)
	timeline_summary = _truncate(
		f"Window with {len(batch_messages)} messages ({roles['user']} user / {roles['assistant']} assistant). {details} Key continuity outcome: {last or 'A new conversational state was established.'}",
		settings["summary_max_chars"],
	)

	return {
		"timeline_summary": timeline_summary,
		"priority_tags": _derive_priority_tags_from_text(f"{first} {last}"),
		"relevance_score": 0.55,
	}


def _llm_summarize_event(context, settings, event_id, from_index, to_index, batch_messages, timeout_ms=None):
	prompt_pipeline = (context or {}).get("prompt_pipeline")
	settings_manager = (context or {}).get("settings_manager")
	if not prompt_pipeline or not settings_manager:
		return None
	if not hasattr(prompt_pipeline, "_build_request_payload") or not hasattr(prompt_pipeline, "_request_completion"):
		return None

	lines = []
	for row in batch_messages:
		role = str(row.get("role") or "").upper()
		content = _truncate(row.get("content") or "", 320)
		lines.append(f"{role}: {content}")

	question_block = f"- {settings['question_timeline_summary']}"

	messages = [
		{
			"role": "system",
			"content": (
				"You are an event extraction engine for roleplay chat continuity. "
				"Return strict JSON only (no markdown, no prose). "
				"Create one detailed timeline summary grounded in source messages. "
				"Timeline summary must include concrete actions/topics and continuity-relevant outcome(s). "
				"Allowed priority_tags: critical, relationship, location, objective. "
				"relevance_score must be a number in range 0..1."
			),
		},
		{
			"role": "user",
			"content": (
				f"Create an event object for id {event_id} and range {from_index}..{to_index}.\n"
				"Required JSON keys: timeline_summary, priority_tags, relevance_score.\n"
				f"Questions to answer:\n{question_block}\n\n"
				"Messages:\n"
				+ "\n".join(lines)
			),
		},
	]

	all_settings = settings_manager.get_all() if hasattr(settings_manager, "get_all") else {}
	payload = prompt_pipeline._build_request_payload(all_settings, messages)
	payload["max_tokens"] = settings["llm_max_tokens"]

	max_retries = int(settings.get("llm_max_retries") or 0)
	call_timeout_ms = int(timeout_ms or settings.get("module_max_latency_ms") or 9000)
	call_timeout_ms = max(400, call_timeout_ms)
	payload["request_timeout_seconds"] = max(1.0, call_timeout_ms / 1000.0)
	attempt = 0
	while attempt <= max_retries:
		attempt += 1
		text, error = prompt_pipeline._request_completion(all_settings, payload)
		if error and ("timeout" in str(error).lower() or "timed out" in str(error).lower()):
			_debug(context, "llm_timeout", event_id=event_id, timeout_ms=call_timeout_ms, attempt=attempt)
		if error or not text:
			continue

		parsed = _extract_json_object(text)
		if not isinstance(parsed, dict):
			coerced = _coerce_summary_from_text(text, settings, batch_messages)
			if isinstance(coerced, dict):
				return coerced
			continue

		result = {
			"timeline_summary": _truncate(parsed.get("timeline_summary") or parsed.get("summary") or "", settings["summary_max_chars"]),
		}
		if not result["timeline_summary"]:
			continue

		result["priority_tags"] = _normalize_priority_tags(parsed.get("priority_tags"))
		result["relevance_score"] = _normalize_relevance_score(parsed.get("relevance_score"), 0.6)
		return _clean_summary_payload(result, batch_messages, settings)

	return None


def _list_event_files(events_dir):
	items = []
	for path in events_dir.glob("evt_*.json"):
		if not path.is_file():
			continue
		payload = _safe_read_json(path)
		if not isinstance(payload, dict):
			continue
		upgraded, changed = _upgrade_legacy_event_payload(payload)
		if changed:
			try:
				_atomic_write_json(path, upgraded)
			except Exception:
				pass
		payload = upgraded
		items.append((path, payload))
	items.sort(key=lambda item: item[0].name.lower())
	return items


def _upgrade_legacy_event_payload(payload):
	if not isinstance(payload, dict):
		return {}, False

	current = dict(payload)
	changed = False
	max_chars = int(DEFAULT_SETTINGS.get("summary_max_chars") or 380)

	timeline = _sanitize_timeline_summary_text(current.get("timeline_summary") or "", max_chars)
	if not timeline:
		legacy_parts = [
			_truncate(current.get("summary") or "", max_chars),
			_truncate(current.get("what_was_going_on") or "", max_chars),
			_truncate(current.get("character_dynamics") or "", max_chars),
			_truncate(current.get("time_place") or "", max_chars),
			_truncate(current.get("key_outcome") or "", max_chars),
		]
		timeline = _truncate(" ".join([part for part in legacy_parts if part]), max_chars)
		timeline = _sanitize_timeline_summary_text(timeline, max_chars)
		if timeline:
			changed = True

	if not timeline:
		timeline = "No continuity summary available for this event window."
		changed = True

	current["timeline_summary"] = timeline

	for key in ("summary", "what_was_going_on", "character_dynamics", "time_place", "key_outcome"):
		if key in current:
			current.pop(key, None)
			changed = True

	return current, changed


def _prune_old_events(events_dir, max_events):
	rows = _list_event_files(events_dir)
	if len(rows) <= max_events:
		return 0
	to_delete = rows[:max(0, len(rows) - max_events)]
	deleted = 0
	for path, _payload in to_delete:
		try:
			path.unlink(missing_ok=True)
			deleted += 1
		except Exception:
			continue
	return deleted


def _build_prompt_context(events_dir, settings):
	rows = _list_event_files(events_dir)
	if not rows:
		return ""

	selected = _select_events_for_injection(rows, settings)
	max_chars = settings["context_max_chars"]

	lines = []
	for payload in selected:
		timeline_summary = str(payload.get("timeline_summary") or "").strip()
		if not timeline_summary:
			legacy_parts = [
				str(payload.get("summary") or "").strip(),
				str(payload.get("what_was_going_on") or "").strip(),
				str(payload.get("character_dynamics") or "").strip(),
				str(payload.get("time_place") or "").strip(),
				str(payload.get("key_outcome") or "").strip(),
			]
			timeline_summary = _truncate(" ".join([part for part in legacy_parts if part]), 260)

		if not timeline_summary:
			continue
		lines.append(f"- timeline: {_truncate(timeline_summary, 260)}")

	if not lines:
		return ""

	joined = "\n".join(lines)
	return _truncate(joined, max_chars)


def _priority_bonus(tags):
	tag_set = set(_normalize_priority_tags(tags))
	bonus = 0.0
	if "critical" in tag_set:
		bonus += 0.18
	if "objective" in tag_set:
		bonus += 0.10
	if "relationship" in tag_set:
		bonus += 0.07
	if "location" in tag_set:
		bonus += 0.05
	return min(0.25, bonus)


def _select_events_for_injection(rows, settings):
	if not rows:
		return []

	context_max_events = max(1, int(settings.get("context_max_events") or 1))
	inject_top_k = max(1, int(settings.get("inject_top_k_events") or 1))
	candidates = rows[-context_max_events:]
	total = len(candidates)
	if not total:
		return []

	scored = []
	for index, (_path, payload) in enumerate(candidates):
		relevance = _normalize_relevance_score(payload.get("relevance_score"), 0.5)
		recency = (index + 1) / total
		score = (relevance * 0.65) + (recency * 0.35) + _priority_bonus(payload.get("priority_tags"))
		scored.append((score, index, payload))

	scored.sort(key=lambda item: item[0], reverse=True)
	selected = scored[:min(inject_top_k, len(scored))]
	selected.sort(key=lambda item: item[1])
	return [item[2] for item in selected]


def _resolve_module_prompt_key(prompt_order, module_name="Event Tracking"):
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
				key = _resolve_module_prompt_key(prompt_order, module_name="Event Tracking")
				if key and key in sections:
					active_context = module_context if isinstance(module_context, dict) else {}
					bot_name = active_context.get("bot_name")
					chat_id = active_context.get("chat_id")
					snapshot = _load_event_context_snapshot(context, bot_name, chat_id)
					if snapshot:
						sections[key] = (
							f"{sections[key]}\n\n"
							f"Event Timeline (Internal)\n"
							f"{snapshot}"
						)
			except Exception:
				return sections
			return sections

		setattr(prompt_pipeline, "_build_module_sections", wrapped_build_module_sections)
		_PATCHED_PIPELINES.add(pipeline_id)


def _load_event_context_snapshot(context, bot_name, chat_id):
	if not bot_name or not chat_id:
		return ""
	events_dir = _events_dir_from_context(context, bot_name, chat_id)
	if not events_dir:
		return ""
	settings = _normalize_settings(_load_bot_module_settings(context, bot_name))
	return _build_prompt_context(events_dir, settings)


def _create_event_payload(event_id, from_index, to_index, summary_data):
	return {
		"id": event_id,
		"created_at": _now_iso(),
		"range": {"from_index": int(from_index), "to_index": int(to_index)},
		"timeline_summary": str(summary_data.get("timeline_summary") or ""),
		"priority_tags": _normalize_priority_tags(summary_data.get("priority_tags")),
		"relevance_score": _normalize_relevance_score(summary_data.get("relevance_score"), 0.6),
	}


def _build_thinking_output(event_id, from_index, to_index, summary_data, max_chars=220):
	if not isinstance(summary_data, dict):
		return ""
	timeline_summary = _truncate(summary_data.get("timeline_summary") or "", max_chars)
	rows = [
		f"event_id: {event_id}",
		f"range: {int(from_index)}..{int(to_index)}",
	]
	if timeline_summary:
		rows.append(f"timeline_summary: {timeline_summary}")
	return "\n".join(rows)


def _normalize_manual_event_input(event_id, payload):
	summary_data = payload if isinstance(payload, dict) else {}
	from_index = _parse_int(summary_data.get("from_index"), -1)
	to_index = _parse_int(summary_data.get("to_index"), -1)
	if from_index < 0:
		from_index = 0
	if to_index < 0:
		to_index = from_index
	if to_index < from_index:
		from_index, to_index = to_index, from_index

	normalized = _create_event_payload(event_id, from_index, to_index, {
		"timeline_summary": _truncate(
			summary_data.get("timeline_summary")
			or summary_data.get("summary")
			or "Manual continuity timeline event.",
			380,
		),
		"priority_tags": summary_data.get("priority_tags"),
		"relevance_score": summary_data.get("relevance_score"),
	})
	if not normalized.get("priority_tags"):
		normalized["priority_tags"] = _derive_priority_tags_from_text(
			normalized.get("timeline_summary", "")
		)
	return normalized


def _next_event_id(meta):
	next_index = int(meta.get("next_event_index") or 1)
	event_id = f"evt_{next_index:04d}"
	meta["next_event_index"] = next_index + 1
	return event_id


def _upsert_manual_event(events_dir, meta, body):
	raw_event_id = str(body.get("event_id") or "").strip()
	if not raw_event_id:
		raw_event_id = _next_event_id(meta)

	event_id = raw_event_id if raw_event_id.startswith("evt_") else f"evt_{raw_event_id}"
	event_path = _event_file(events_dir, event_id)
	payload = _normalize_manual_event_input(event_id, body)
	if event_path.exists() and event_path.is_file():
		existing = _safe_read_json(event_path) or {}
		if isinstance(existing, dict):
			payload["created_at"] = str(existing.get("created_at") or payload.get("created_at") or _now_iso())

	_atomic_write_json(event_path, payload)
	meta["last_created_event_id"] = event_id
	meta["last_created_at"] = _now_iso()
	return payload


def _delete_event(events_dir, event_id):
	path = _event_file(events_dir, event_id)
	if not path.exists() or not path.is_file():
		return False
	try:
		path.unlink(missing_ok=True)
		return True
	except Exception:
		return False


def _execute(context, force_create_partial=False):
	context = context or {}
	_install_prompt_patch(context)

	bot_name = str(context.get("bot_name") or "").strip()
	chat_id = str(context.get("chat_id") or "").strip()
	if not bot_name or not chat_id:
		return

	events_dir = _events_dir_from_context(context, bot_name, chat_id)
	if not events_dir:
		return

	settings = _normalize_settings(_load_bot_module_settings(context, bot_name))
	module_started = time.monotonic()
	_debug(context, "run_start", bot_name=bot_name, chat_id=chat_id)
	run_key = f"{bot_name}::{chat_id}"

	with _LOCK:
		if run_key in _ACTIVE_RUNS:
			_debug(context, "run_skip_already_active", bot_name=bot_name, chat_id=chat_id)
			return
		_ACTIVE_RUNS.add(run_key)

	try:
		with _LOCK:
			meta = _load_meta(events_dir)
			messages = _load_iam_messages(events_dir.parent)
			message_count = len(messages)
			auto_enabled = _parse_bool(meta.get("auto_event_creation_enabled"), True)
			_write_status(events_dir, {
				"success": True,
				"processing": True,
				"message": "Keeping a track on things",
				"thinking_output": "Scanning recent messages for continuity events.",
				"module_name": "Event Tracking",
				"bot_name": bot_name,
				"chat_id": chat_id,
				"message_count": message_count,
				"auto_event_creation_enabled": auto_enabled,
			})

		created_ids = []
		last_thinking_output = ""
		start_index = max(0, _parse_int(meta.get("last_processed_count"), 0))
		window_size = settings["messages_per_event"]
		llm_calls = 0
		fallback_calls = 0
		total_event_tokens = 0
		pruned = 0

		if auto_enabled:
			while (message_count - start_index) >= window_size:
				from_index = start_index
				to_index = start_index + window_size - 1
				batch = messages[from_index:to_index + 1]
				event_id = _next_event_id(meta)

				elapsed_ms = int((time.monotonic() - module_started) * 1000)
				max_latency_ms = int(settings.get("module_max_latency_ms") or 9000)
				remaining_ms = max_latency_ms - elapsed_ms
				budget_exceeded = remaining_ms <= 120

				summary_data = None
				if not budget_exceeded:
					summary_data = _llm_summarize_event(
						context,
						settings,
						event_id,
						from_index,
						to_index,
						batch,
						timeout_ms=remaining_ms,
					)
					if summary_data:
						llm_calls += 1

				if not summary_data:
					summary_data = _deterministic_summary(batch, settings)
					fallback_calls += 1

				event_payload = _create_event_payload(event_id, from_index, to_index, summary_data)
				event_payload["priority_tags"] = event_payload.get("priority_tags") or _derive_priority_tags_from_text(
					event_payload.get("timeline_summary", "")
				)
				_atomic_write_json(_event_file(events_dir, event_id), event_payload)
				last_thinking_output = _build_thinking_output(
					event_id,
					from_index,
					to_index,
					event_payload,
					max_chars=settings["summary_max_chars"],
				)

				created_ids.append(event_id)
				start_index = to_index + 1
				total_event_tokens += _estimate_tokens(event_payload.get("timeline_summary"))

				_write_status(events_dir, {
					"success": True,
					"processing": True,
					"message": "Keeping a track on things",
					"thinking_output": last_thinking_output,
					"module_name": "Event Tracking",
					"bot_name": bot_name,
					"chat_id": chat_id,
					"message_count": message_count,
					"created_count": len(created_ids),
					"created_ids": list(created_ids),
					"llm_calls": llm_calls,
					"fallback_calls": fallback_calls,
					"auto_event_creation_enabled": auto_enabled,
				})

				_debug(
					context,
					"event_created",
					event_id=event_id,
					from_index=from_index,
					to_index=to_index,
					tags=event_payload.get("priority_tags") or [],
					relevance_score=event_payload.get("relevance_score"),
					token_estimate=_estimate_tokens(event_payload.get("summary")),
				)

			meta["last_processed_count"] = start_index
		else:
			meta["last_processed_count"] = message_count

		# Force-pass should still create an event from remaining messages even if
		# the window is smaller than messages_per_event.
		if force_create_partial:
			# Force pass uses the latest full window when possible, even if it overlaps
			# with previously processed ranges.
			partial_to = message_count - 1
			partial_from = max(0, partial_to - max(1, window_size) + 1)

			if message_count > 0 and partial_to >= partial_from:
				batch = messages[partial_from:partial_to + 1]
				event_id = _next_event_id(meta)

				elapsed_ms = int((time.monotonic() - module_started) * 1000)
				max_latency_ms = int(settings.get("module_max_latency_ms") or 9000)
				remaining_ms = max_latency_ms - elapsed_ms
				budget_exceeded = remaining_ms <= 120

				summary_data = None
				if not budget_exceeded:
					summary_data = _llm_summarize_event(
						context,
						settings,
						event_id,
						partial_from,
						partial_to,
						batch,
						timeout_ms=remaining_ms,
					)
					if summary_data:
						llm_calls += 1

				if not summary_data:
					summary_data = _deterministic_summary(batch, settings)
					fallback_calls += 1

				event_payload = _create_event_payload(event_id, partial_from, partial_to, summary_data)
				event_payload["priority_tags"] = event_payload.get("priority_tags") or _derive_priority_tags_from_text(
					event_payload.get("timeline_summary", "")
				)
				_atomic_write_json(_event_file(events_dir, event_id), event_payload)
				last_thinking_output = _build_thinking_output(
					event_id,
					partial_from,
					partial_to,
					event_payload,
					max_chars=settings["summary_max_chars"],
				)

				created_ids.append(event_id)
				total_event_tokens += _estimate_tokens(event_payload.get("timeline_summary"))

				meta["last_processed_count"] = message_count
				_debug(
					context,
					"event_created_force_partial",
					event_id=event_id,
					from_index=partial_from,
					to_index=partial_to,
					tags=event_payload.get("priority_tags") or [],
					relevance_score=event_payload.get("relevance_score"),
				)

		if created_ids:
			meta["last_created_event_id"] = created_ids[-1]
			meta["last_created_at"] = _now_iso()

		pruned = _prune_old_events(events_dir, settings["max_events"])
		_save_meta(events_dir, meta)

		latest_events = _list_event_files(events_dir)
		selected_for_status = _select_events_for_injection(latest_events, settings)

		_write_status(events_dir, {
			"success": True,
			"processing": False,
			"message": "Keeping a track on things",
			"thinking_output": "",
			"module_name": "Event Tracking",
			"bot_name": bot_name,
			"chat_id": chat_id,
			"message_count": message_count,
			"created_count": len(created_ids),
			"created_ids": created_ids,
			"pruned_count": pruned,
			"last_created_event_id": str(meta.get("last_created_event_id") or ""),
			"events": selected_for_status,
			"llm_calls": llm_calls,
			"fallback_calls": fallback_calls,
			"token_estimate": total_event_tokens,
			"auto_event_creation_enabled": _parse_bool(meta.get("auto_event_creation_enabled"), True),
		})

		duration_ms = int((time.monotonic() - module_started) * 1000)
		_debug(
			context,
			"run_success",
			bot_name=bot_name,
			chat_id=chat_id,
			message_count=message_count,
			created_count=len(created_ids),
			pruned_count=pruned,
			duration_ms=duration_ms,
			llm_calls=llm_calls,
			fallback_calls=fallback_calls,
			token_estimate=total_event_tokens,
		)
	except Exception as exc:
		duration_ms = int((time.monotonic() - module_started) * 1000)
		_write_status(events_dir, {
			"success": False,
			"processing": False,
			"message": "Keeping a track on things",
			"thinking_output": "",
			"module_name": "Event Tracking",
			"bot_name": bot_name,
			"chat_id": chat_id,
			"error": str(exc),
		})
		_debug(
			context,
			"run_fail",
			bot_name=bot_name,
			chat_id=chat_id,
			error=str(exc),
			duration_ms=duration_ms,
		)
	finally:
		with _LOCK:
			_ACTIVE_RUNS.discard(run_key)


def _resolve_action_context(action_context, payload):
	context = action_context if isinstance(action_context, dict) else {}
	body = payload if isinstance(payload, dict) else {}

	bot_name = str(body.get("bot_name") or context.get("bot_name") or "").strip()
	chat_id = str(body.get("chat_id") or context.get("chat_id") or "").strip()
	return context, body, bot_name, chat_id


def _status_payload(events_dir, meta, settings):
	status_data = _safe_read_json(_status_path(events_dir)) or {}
	if not isinstance(status_data, dict):
		status_data = {}

	if "processing" not in status_data:
		status_data["processing"] = False
	status_data.setdefault("module_name", "Event Tracking")
	status_data.setdefault("message", "Keeping a track on things")
	status_data.setdefault("thinking_output", "")
	status_data.setdefault("last_created_event_id", str(meta.get("last_created_event_id") or ""))
	status_data.setdefault("created_count", 0)
	status_data.setdefault("pruned_count", 0)

	rows = _list_event_files(events_dir)
	status_data["events"] = _select_events_for_injection(rows, settings)
	status_data["all_events"] = [payload for _path, payload in rows]
	status_data["total_events"] = len(rows)
	status_data["last_processed_count"] = int(meta.get("last_processed_count") or 0)
	status_data["next_event_index"] = int(meta.get("next_event_index") or 1)
	status_data["auto_event_creation_enabled"] = _parse_bool(meta.get("auto_event_creation_enabled"), True)
	if not status_data.get("processing"):
		status_data["thinking_output"] = ""
	status_data["success"] = True
	return status_data


def _handle_action(action=None, payload=None, context=None):
	action_name = str(action or "").strip().lower()
	context, body, bot_name, chat_id = _resolve_action_context(context, payload)
	if not bot_name or not chat_id:
		return {"success": False, "message": "Missing bot_name or chat_id"}

	events_dir = _events_dir_from_context(context, bot_name, chat_id)
	if not events_dir:
		return {"success": False, "message": "Unable to resolve events directory"}

	settings = _normalize_settings(_load_bot_module_settings(context, bot_name))

	with _LOCK:
		meta = _load_meta(events_dir)

		if action_name in {"status", "health", "get", "fetch"}:
			payload = _status_payload(events_dir, meta, settings)
			payload["bot_name"] = bot_name
			payload["chat_id"] = chat_id
			return payload

		if action_name in {"list", "events"}:
			rows = _list_event_files(events_dir)
			items = [payload for _path, payload in rows]
			return {
				"success": True,
				"bot_name": bot_name,
				"chat_id": chat_id,
				"events": items,
				"count": len(items),
			}

		if action_name in {"set_auto_creation", "set_auto", "auto_creation"}:
			enabled = _parse_bool(body.get("enabled"), True)
			meta["auto_event_creation_enabled"] = enabled
			if not enabled:
				messages = _load_iam_messages(events_dir.parent)
				meta["last_processed_count"] = len(messages)
			_save_meta(events_dir, meta)
			payload = _status_payload(events_dir, meta, settings)
			payload["bot_name"] = bot_name
			payload["chat_id"] = chat_id
			payload["success"] = True
			return payload

		if action_name in {"create_event", "create", "manual_create"}:
			event_payload = _upsert_manual_event(events_dir, meta, body)
			pruned = _prune_old_events(events_dir, settings["max_events"])
			_save_meta(events_dir, meta)
			_debug(context, "manual_event_create", event_id=event_payload.get("id"), pruned_count=pruned)
			status_data = _status_payload(events_dir, meta, settings)
			status_data["bot_name"] = bot_name
			status_data["chat_id"] = chat_id
			status_data["event"] = event_payload
			status_data["success"] = True
			return status_data

		if action_name in {"update_event", "update", "manual_update"}:
			event_id = str(body.get("event_id") or "").strip()
			if not event_id:
				return {"success": False, "message": "Missing event_id"}
			event_path = _event_file(events_dir, event_id)
			if not event_path.exists() or not event_path.is_file():
				return {"success": False, "message": f"Event not found: {event_id}"}
			event_payload = _upsert_manual_event(events_dir, meta, body)
			_save_meta(events_dir, meta)
			_debug(context, "manual_event_update", event_id=event_payload.get("id"))
			status_data = _status_payload(events_dir, meta, settings)
			status_data["bot_name"] = bot_name
			status_data["chat_id"] = chat_id
			status_data["event"] = event_payload
			status_data["success"] = True
			return status_data

		if action_name in {"delete_event", "delete", "manual_delete"}:
			event_id = str(body.get("event_id") or "").strip()
			if not event_id:
				return {"success": False, "message": "Missing event_id"}
			deleted = _delete_event(events_dir, event_id)
			if not deleted:
				return {"success": False, "message": f"Event not found: {event_id}"}
			if str(meta.get("last_created_event_id") or "").strip() == event_id:
				rows = _list_event_files(events_dir)
				meta["last_created_event_id"] = str(rows[-1][1].get("id") if rows else "")
			_save_meta(events_dir, meta)
			_debug(context, "manual_event_delete", event_id=event_id)
			status_data = _status_payload(events_dir, meta, settings)
			status_data["bot_name"] = bot_name
			status_data["chat_id"] = chat_id
			status_data["success"] = True
			return status_data

		if action_name == "force_run":
			# Release lock during execution to avoid nested lock contention.
			pass
		else:
			return {"success": False, "message": f"Unknown action: {action_name}"}

	_execute(context, force_create_partial=(action_name == "force_run"))
	with _LOCK:
		meta = _load_meta(events_dir)
		status_data = _status_payload(events_dir, meta, settings)
		status_data["bot_name"] = bot_name
		status_data["chat_id"] = chat_id
		status_data["success"] = True
		return status_data
