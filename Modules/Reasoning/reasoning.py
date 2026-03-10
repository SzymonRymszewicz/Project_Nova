"""
Reasoning module for BlueNovaAI.

Generates one-turn hidden reasoning context to improve response quality.
The reasoning plan is transient and never persisted to chat history.
"""

MODULE_PROMPT = """
Reasoning Module (Internal)
- Build one-turn hidden reasoning plan before response generation.
- Keep reasoning private and never reveal it in final assistant output.
- Obey Definition/Core and Rules/Scenario while deciding response strategy.
""".strip()

_ENGINE_MODULE = None


def _load_engine_module():
	global _ENGINE_MODULE
	if _ENGINE_MODULE is not None:
		return _ENGINE_MODULE

	try:
		import importlib.util
		from pathlib import Path

		engine_path = Path(__file__).with_name("reasoning_prompt_pipeline.py")
		spec = importlib.util.spec_from_file_location("reasoning_engine_runtime", engine_path)
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
		return {"success": False, "message": "Reasoning engine unavailable."}

	handler = getattr(engine, "handle_action", None)
	if not callable(handler):
		return {"success": False, "message": "Reasoning action handler unavailable."}

	try:
		return handler(action=action, payload=payload, context=context)
	except Exception as exc:
		return {"success": False, "message": f"Reasoning action failed: {exc}"}
