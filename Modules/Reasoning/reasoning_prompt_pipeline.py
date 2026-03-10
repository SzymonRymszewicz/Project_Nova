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
_REASONING_BY_CHAT = {}

DEFAULT_QUESTIONS = [
	"What does the user want right now?",
	"What does the user likely expect from me next?",
	"What response strategy best satisfies that while respecting core/scenario?",
]

DEFAULT_SETTINGS = {
	"reasoning_context_max_chars": 800,
	"module_max_latency_ms": 2200,
	"module_max_token_budget": 220,
	"llm_max_tokens": 220,
	"llm_max_retries": 1,
	"skip_trivial_enabled": True,
	"skip_max_chars": 24,
	"skip_regex": r"^(hi|hello|hey|ok|okay|thanks|thank you|yo|sup|cool|k|kk|nice)[!. ]*$",
}

_REASONING_MAX_AGE_SECONDS = 180


def _now_iso():
	return datetime.now().isoformat()


def _debug(context, event, **details):
	logger = (context or {}).get("debug_logger")
	if logger is None:
		return
	try:
		if callable(logger):
			logger(f"reasoning.{event}", **details)
			return
		if hasattr(logger, "log_event") and callable(getattr(logger, "log_event")):
			logger.log_event(f"reasoning.{event}", **details)
	except Exception:
		return


def _chat_key(bot_name, chat_id):
	return f"{str(bot_name or '').strip()}::{str(chat_id or '').strip()}"


def _parse_int(value, default):
	try:
		return int(float(str(value).strip()))
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


def _safe_read_json(path):
	if not path.exists() or not path.is_file():
		return None
	try:
		payload = json.loads(path.read_text(encoding="utf-8"))
		return payload if isinstance(payload, dict) else None
	except Exception:
		return None


def _estimate_tokens(text):
	raw = str(text or "")
	if not raw.strip():
		return 0
	return max(1, int(round(len(raw) / 4)))


def _truncate(text, max_chars):
	raw = re.sub(r"\s+", " ", str(text or "")).strip()
	if len(raw) <= max_chars:
		return raw
	trimmed = raw[:max_chars]
	if " " in trimmed:
		trimmed = trimmed.rsplit(" ", 1)[0]
	return trimmed.strip()


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

	for key in ("Reasoning", "reasoning", "Reasoning_Module", "reasoning_module"):
		value = module_settings.get(key)
		if isinstance(value, dict):
			return value
	return {}


def _parse_questions(raw):
	if isinstance(raw, list):
		values = raw
	else:
		values = []
		if isinstance(raw, str) and raw.strip():
			text = raw.strip()
			if text in {"[", "]"} or (text.startswith("[") and "]" not in text):
				text = ""
			try:
				loaded = json.loads(text)
				if isinstance(loaded, list):
					values = loaded
			except Exception:
				values = [
					line.strip().strip("'\" ").rstrip(",")
					for line in text.split("\n")
					if line.strip() and line.strip() not in {"[", "]"}
				]

	questions = []
	for item in values:
		question = str(item or "").strip()
		if not question or question in questions:
			continue
		questions.append(question)

	if not questions:
		questions = list(DEFAULT_QUESTIONS)
	return questions[:10]


def _normalize_settings(raw):
	source = {str(k).strip().lower(): raw[k] for k in (raw or {}) if str(k).strip()}

	def pick(*keys, default=None):
		for key in keys:
			if key in source:
				return source[key]
		return default

	settings = dict(DEFAULT_SETTINGS)
	settings["reasoning_context_max_chars"] = max(220, _parse_int(pick("reasoning_context_max_chars"), DEFAULT_SETTINGS["reasoning_context_max_chars"]))
	settings["module_max_latency_ms"] = max(100, _parse_int(pick("module_max_latency_ms"), DEFAULT_SETTINGS["module_max_latency_ms"]))
	settings["module_max_token_budget"] = max(32, _parse_int(pick("module_max_token_budget"), DEFAULT_SETTINGS["module_max_token_budget"]))
	settings["llm_max_tokens"] = max(64, _parse_int(pick("llm_max_tokens"), DEFAULT_SETTINGS["llm_max_tokens"]))
	settings["llm_max_retries"] = max(0, _parse_int(pick("llm_max_retries"), DEFAULT_SETTINGS["llm_max_retries"]))
	settings["skip_trivial_enabled"] = _parse_bool(pick("skip_trivial_enabled"), DEFAULT_SETTINGS["skip_trivial_enabled"])
	settings["skip_max_chars"] = max(1, _parse_int(pick("skip_max_chars"), DEFAULT_SETTINGS["skip_max_chars"]))
	settings["skip_regex"] = str(pick("skip_regex", default=DEFAULT_SETTINGS["skip_regex"]) or DEFAULT_SETTINGS["skip_regex"]).strip()

	raw_questions = pick("reasoning_questions_json", "questions_json", "reasoning_questions", default=None)
	if raw_questions is None:
		question_lines = []
		for key in sorted(source.keys()):
			if key.startswith("question_"):
				question_lines.append(str(source[key] or "").strip())
		raw_questions = [line for line in question_lines if line]
	settings["questions"] = _parse_questions(raw_questions)
	return settings


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


def _load_iam_messages(chat_folder, max_items=12):
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
			"role": role,
			"content": str(content),
			"order": order_num,
		})

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


def _extract_latest_user_message(messages):
	for row in reversed(messages or []):
		if str(row.get("role") or "").strip().lower() == "user":
			text = str(row.get("content") or "").strip()
			if text:
				return text
	return ""


def _is_trivial_turn(user_text, settings):
	text = str(user_text or "").strip()
	if not text:
		return True
	if not settings.get("skip_trivial_enabled", True):
		return False

	if len(text) <= int(settings.get("skip_max_chars") or 24):
		if re.fullmatch(r"[\w\s!?.',-]+", text):
			return True

	pattern = str(settings.get("skip_regex") or "").strip()
	if pattern:
		try:
			if re.match(pattern, text, flags=re.IGNORECASE):
				return True
		except Exception:
			pass
	return False


def _compact_history_for_reasoning(messages, max_items=8):
	rows = []
	for row in (messages or [])[-max_items:]:
		role = str(row.get("role") or "").strip().lower()
		content = _truncate(row.get("content") or "", 220)
		if role not in {"user", "assistant"} or not content:
			continue
		label = "USER" if role == "user" else "ASSISTANT"
		rows.append(f"{label}: {content}")
	return "\n".join(rows)


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
		parsed = json.loads(raw)
		if isinstance(parsed, str):
			parsed = json.loads(parsed)
		return parsed if isinstance(parsed, dict) else None
	except Exception:
		return None


def _normalize_json_plan(data, settings):
	if not isinstance(data, dict):
		return None

	intent = _truncate(str(data.get("intent") or "").strip(), 220)
	strategy = _truncate(str(data.get("strategy") or "").strip(), 260)
	if not intent or not strategy:
		return None

	constraints_raw = data.get("constraints")
	risks_raw = data.get("risks")
	if not isinstance(constraints_raw, list):
		constraints_raw = [constraints_raw] if constraints_raw else []
	if not isinstance(risks_raw, list):
		risks_raw = [risks_raw] if risks_raw else []

	constraints = []
	for item in constraints_raw:
		text = _truncate(str(item or "").strip(), 140)
		if text and text not in constraints:
			constraints.append(text)

	risks = []
	for item in risks_raw:
		text = _truncate(str(item or "").strip(), 140)
		if text and text not in risks:
			risks.append(text)

	if not constraints:
		constraints = ["Respect Definition/Core and Rules/Scenario."]
	if not risks:
		risks = ["Avoid exposing internal reasoning in final reply."]

	plan = {
		"intent": intent,
		"constraints": constraints[:4],
		"strategy": strategy,
		"risks": risks[:4],
	}

	if _estimate_tokens(json.dumps(plan)) > int(settings.get("module_max_token_budget") or 220):
		plan["constraints"] = plan["constraints"][:2]
		plan["risks"] = plan["risks"][:2]
		plan["strategy"] = _truncate(plan["strategy"], 160)

	return plan


def _fallback_plan(user_message, bot_core, bot_scenario):
	intent = _truncate(user_message or "Respond to the user request.", 180)
	constraints = []
	if str(bot_core or "").strip():
		constraints.append("Stay aligned with Definition/Core.")
	if str(bot_scenario or "").strip():
		constraints.append("Follow Rules/Scenario constraints.")
	if not constraints:
		constraints.append("Keep response consistent and helpful.")

	return {
		"intent": intent,
		"constraints": constraints[:3],
		"strategy": "Answer the latest user request directly, keep continuity with recent chat, and be concise.",
		"risks": ["Misreading user intent or tone.", "Accidentally exposing internal planning."],
	}


def _llm_reasoning_plan(context, settings, user_message, history_blob, bot_core, bot_scenario, timeout_ms=None):
	prompt_pipeline = (context or {}).get("prompt_pipeline")
	settings_manager = (context or {}).get("settings_manager")
	if not prompt_pipeline or not settings_manager:
		return None
	if not hasattr(prompt_pipeline, "_build_request_payload") or not hasattr(prompt_pipeline, "_request_completion"):
		return None

	questions = settings.get("questions") or DEFAULT_QUESTIONS
	question_block = "\n".join([f"- {q}" for q in questions])

	messages = [
		{
			"role": "system",
			"content": (
				"You are an internal reasoning planner. Return strict JSON only. "
				"Do not include markdown or extra prose. "
				"Required schema: {intent:string, constraints:string[], strategy:string, risks:string[]}. "
				"Keep plan compact and actionable. "
				"Never write final assistant reply text."
			),
		},
		{
			"role": "user",
			"content": (
				"Build one-turn hidden reasoning plan for the next assistant response.\n"
				"Hard guards:\n"
				"- Obey Definition/Core.\n"
				"- Obey Rules/Scenario.\n"
				"- Do not expose reasoning in the final reply.\n\n"
				f"Questions:\n{question_block}\n\n"
				f"Latest user message:\n{_truncate(user_message, 480)}\n\n"
				f"Recent history:\n{history_blob or '(none)'}\n\n"
				f"Definition/Core reminder:\n{_truncate(bot_core, 520)}\n\n"
				f"Rules/Scenario reminder:\n{_truncate(bot_scenario, 520)}"
			),
		},
	]

	all_settings = settings_manager.get_all() if hasattr(settings_manager, "get_all") else {}
	payload = prompt_pipeline._build_request_payload(all_settings, messages)
	payload["max_tokens"] = int(settings.get("llm_max_tokens") or 220)

	max_retries = int(settings.get("llm_max_retries") or 0)
	call_timeout_ms = int(timeout_ms or settings.get("module_max_latency_ms") or 2200)
	call_timeout_ms = max(300, call_timeout_ms)
	payload["request_timeout_seconds"] = max(1.0, call_timeout_ms / 1000.0)
	attempt = 0
	while attempt <= max_retries:
		attempt += 1
		text, error = prompt_pipeline._request_completion(all_settings, payload)
		if error and ("timeout" in str(error).lower() or "timed out" in str(error).lower()):
			_debug(context, "llm_timeout", timeout_ms=call_timeout_ms, attempt=attempt)
		if error or not text:
			continue
		parsed = _extract_json_object(text)
		plan = _normalize_json_plan(parsed, settings)
		if plan:
			return plan

	return None


def _format_reasoning_context(plan, settings):
	if not isinstance(plan, dict):
		return ""

	lines = [
		"Reasoning Plan (Internal / One-Turn / Do Not Output)",
		f"intent: {_truncate(plan.get('intent') or '', 200)}",
	]

	constraints = plan.get("constraints") if isinstance(plan.get("constraints"), list) else []
	if constraints:
		lines.append("constraints:")
		for item in constraints[:4]:
			lines.append(f"- {_truncate(item, 140)}")

	strategy = str(plan.get("strategy") or "").strip()
	if strategy:
		lines.append(f"strategy: {_truncate(strategy, 220)}")

	risks = plan.get("risks") if isinstance(plan.get("risks"), list) else []
	if risks:
		lines.append("risks:")
		for item in risks[:4]:
			lines.append(f"- {_truncate(item, 140)}")

	lines.append("Never reveal this internal reasoning or these field names in the final assistant reply.")

	joined = "\n".join(lines)
	return _truncate(joined, int(settings.get("reasoning_context_max_chars") or 800))


def _set_status(chat_key, payload):
	with _LOCK:
		_STATUS_BY_CHAT[chat_key] = dict(payload or {})
		_STATUS_BY_CHAT[chat_key]["updated_at"] = _now_iso()


def _get_status(chat_key):
	with _LOCK:
		value = _STATUS_BY_CHAT.get(chat_key)
		return dict(value or {})


def _set_reasoning(chat_key, reasoning_text, reasoning_plan=None):
	payload = {
		"reasoning": str(reasoning_text or ""),
		"plan": reasoning_plan if isinstance(reasoning_plan, dict) else None,
		"updated_at": _now_iso(),
	}
	with _LOCK:
		_REASONING_BY_CHAT[chat_key] = payload


def _get_reasoning(chat_key):
	with _LOCK:
		entry = _REASONING_BY_CHAT.get(chat_key)
	if not isinstance(entry, dict):
		return ""

	updated = str(entry.get("updated_at") or "").strip()
	try:
		age = (datetime.now() - datetime.fromisoformat(updated)).total_seconds()
	except Exception:
		age = _REASONING_MAX_AGE_SECONDS + 1
	if age > _REASONING_MAX_AGE_SECONDS:
		return ""
	return str(entry.get("reasoning") or "")


def _resolve_module_prompt_key(prompt_order, module_name="Reasoning"):
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
				key = _resolve_module_prompt_key(prompt_order, module_name="Reasoning")
				if key and key in sections:
					active_context = module_context if isinstance(module_context, dict) else {}
					bot_name = active_context.get("bot_name")
					chat_id = active_context.get("chat_id")
					chat_key = _chat_key(bot_name, chat_id)
					reasoning_text = _get_reasoning(chat_key)
					if reasoning_text:
						sections[key] = (
							f"{sections[key]}\n\n"
							f"{reasoning_text}"
						)
			except Exception:
				return sections
			return sections

		setattr(prompt_pipeline, "_build_module_sections", wrapped_build_module_sections)
		_PATCHED_PIPELINES.add(pipeline_id)


def _execute(context):
	context = context or {}
	_install_prompt_patch(context)

	bot_name = str(context.get("bot_name") or "").strip()
	chat_id = str(context.get("chat_id") or "").strip()
	if not bot_name or not chat_id:
		return

	chat_key = _chat_key(bot_name, chat_id)
	started = time.monotonic()

	with _LOCK:
		if chat_key in _ACTIVE_RUNS:
			_debug(context, "run_skip_already_active", bot_name=bot_name, chat_id=chat_id)
			return
		_ACTIVE_RUNS.add(chat_key)

	_set_status(chat_key, {
		"success": True,
		"processing": True,
		"message": "Reasoning",
		"thinking_output": "Collecting recent context and preparing an internal response plan.",
		"module_name": "Reasoning",
		"bot_name": bot_name,
		"chat_id": chat_id,
	})
	_debug(context, "run_start", bot_name=bot_name, chat_id=chat_id)

	try:
		settings = _normalize_settings(_load_bot_module_settings(context, bot_name))
		chat_folder = _chat_folder_from_context(context, bot_name, chat_id)
		messages = _load_iam_messages(chat_folder, max_items=12) if chat_folder else []
		latest_user = _extract_latest_user_message(messages)

		if not latest_user:
			_set_reasoning(chat_key, "", None)
			_set_status(chat_key, {
				"success": True,
				"processing": False,
				"message": "Reasoning",
				"thinking_output": "Skipped: no user message available for reasoning.",
				"module_name": "Reasoning",
				"bot_name": bot_name,
				"chat_id": chat_id,
				"skipped": True,
				"skip_reason": "no_user_message",
				"token_estimate": 0,
			})
			return

		if _is_trivial_turn(latest_user, settings):
			_set_reasoning(chat_key, "", None)
			_set_status(chat_key, {
				"success": True,
				"processing": False,
				"message": "Reasoning",
				"thinking_output": "Skipped: trivial user turn.",
				"module_name": "Reasoning",
				"bot_name": bot_name,
				"chat_id": chat_id,
				"skipped": True,
				"skip_reason": "trivial_turn",
				"token_estimate": 0,
			})
			_debug(context, "run_skip_trivial", bot_name=bot_name, chat_id=chat_id)
			return

		bot_manager = context.get("bot_manager")
		bot = bot_manager.load_bot(bot_name) if bot_manager else {}
		core_data = str((bot or {}).get("core_data") or "")
		scenario_data = str((bot or {}).get("scenario_data") or "")
		history_blob = _compact_history_for_reasoning(messages, max_items=8)

		elapsed_ms = int((time.monotonic() - started) * 1000)
		plan = None
		llm_used = False
		max_latency_ms = int(settings.get("module_max_latency_ms") or 2200)
		if elapsed_ms <= max_latency_ms:
			remaining_ms = max(250, max_latency_ms - elapsed_ms)
			plan = _llm_reasoning_plan(
				context,
				settings,
				latest_user,
				history_blob,
				core_data,
				scenario_data,
				timeout_ms=remaining_ms,
			)
			llm_used = plan is not None

		if not plan:
			plan = _fallback_plan(latest_user, core_data, scenario_data)

		reasoning_text = _format_reasoning_context(plan, settings)
		token_estimate = _estimate_tokens(reasoning_text)
		if token_estimate > int(settings.get("module_max_token_budget") or 220):
			reasoning_text = _truncate(reasoning_text, max(180, int(settings.get("reasoning_context_max_chars") or 800) // 2))
			token_estimate = _estimate_tokens(reasoning_text)

		_set_reasoning(chat_key, reasoning_text, plan)
		duration_ms = int((time.monotonic() - started) * 1000)
		_debug(
			context,
			"plan_output",
			bot_name=bot_name,
			chat_id=chat_id,
			llm_used=llm_used,
			token_estimate=token_estimate,
			reasoning_output=reasoning_text,
			reasoning_plan=(plan if isinstance(plan, dict) else {}),
		)
		_set_status(chat_key, {
			"success": True,
			"processing": False,
			"message": "Reasoning",
			"thinking_output": reasoning_text,
			"module_name": "Reasoning",
			"bot_name": bot_name,
			"chat_id": chat_id,
			"skipped": False,
			"llm_used": llm_used,
			"duration_ms": duration_ms,
			"token_estimate": token_estimate,
			"questions": settings.get("questions") or [],
			"preview": _truncate(str((plan or {}).get("intent") or ""), 140),
		})
		_debug(
			context,
			"run_success",
			bot_name=bot_name,
			chat_id=chat_id,
			duration_ms=duration_ms,
			llm_used=llm_used,
			token_estimate=token_estimate,
		)
	except Exception as exc:
		duration_ms = int((time.monotonic() - started) * 1000)
		_set_reasoning(chat_key, "", None)
		_set_status(chat_key, {
			"success": False,
			"processing": False,
			"message": "Reasoning",
			"thinking_output": "",
			"module_name": "Reasoning",
			"bot_name": bot_name,
			"chat_id": chat_id,
			"error": str(exc),
			"duration_ms": duration_ms,
		})
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


def handle_action(action=None, payload=None, context=None):
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
				"message": "Reasoning",
				"thinking_output": "",
				"module_name": "Reasoning",
				"bot_name": bot_name,
				"chat_id": chat_id,
				"skipped": False,
			}
		elif "thinking_output" not in status_data:
			status_data["thinking_output"] = _get_reasoning(chat_key)
		elif not str(status_data.get("thinking_output") or "").strip():
			cached_reasoning = _get_reasoning(chat_key)
			if str(cached_reasoning or "").strip():
				status_data["thinking_output"] = cached_reasoning
		status_data["bot_name"] = bot_name
		status_data["chat_id"] = chat_id
		status_data["success"] = True
		return status_data

	if action_name in {"force_run", "run"}:
		_execute(context)
		status_data = _get_status(chat_key)
		status_data["bot_name"] = bot_name
		status_data["chat_id"] = chat_id
		status_data["success"] = True
		return status_data

	return {"success": False, "message": f"Unknown action: {action_name}"}
