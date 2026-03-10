"""
Recursive Validator module for BlueNovaAI.

Applies iterative quality validation to candidate assistant replies using
configurable criteria, thresholds, and max-iteration safeguards.
"""

MODULE_PROMPT = """
Recursive Validator Module (Internal)
- Evaluate each candidate reply against enabled criteria.
- Iterate regeneration until all hard checks pass or score threshold is met.
- Keep validator feedback internal and never expose it in final output.
""".strip()

_ENGINE_MODULE = None


def _load_engine_module():
	global _ENGINE_MODULE
	if _ENGINE_MODULE is not None:
		return _ENGINE_MODULE

	try:
		import importlib.util
		from pathlib import Path

		engine_path = Path(__file__).with_name("recursive_validator_prompt_pipeline.py")
		spec = importlib.util.spec_from_file_location("recursive_validator_engine_runtime", engine_path)
		if not spec or not spec.loader:
			return None
		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
		_ENGINE_MODULE = module
		return _ENGINE_MODULE
	except Exception:
		return None


def process(context=None):
	context = context or {}
	engine = _load_engine_module()
	if not engine:
		return MODULE_PROMPT

	runner = getattr(engine, "_execute", None)
	if callable(runner):
		try:
			runner(context)
		except Exception:
			pass
	return MODULE_PROMPT


def extend(context=None):
	return process(context)


def handle_action(action=None, payload=None, context=None):
	engine = _load_engine_module()
	if not engine:
		return {"success": False, "message": "Recursive Validator engine unavailable."}

	handler = getattr(engine, "_handle_action", None)
	if not callable(handler):
		handler = getattr(engine, "handle_action", None)
	if not callable(handler):
		return {"success": False, "message": "Recursive Validator action handler unavailable."}

	try:
		return handler(action=action, payload=payload, context=context)
	except Exception as exc:
		return {"success": False, "message": f"Recursive Validator action failed: {exc}"}
