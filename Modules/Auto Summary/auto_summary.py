"""
Auto Summary module for BlueNovaAI.

This module maintains context length using three summary phases and supports
protected "Core Memory" IAM tags.
"""

MODULE_PROMPT = """
Auto Summary Module (Internal)
- Older IAM messages may be compressed into progressively shorter summaries to keep context within budget.
- Messages tagged as Core Memory are never summarized.
- Summary transformations preserve chronological ordering and source lineage.
""".strip()


_ENGINE_MODULE = None


def _load_engine_module():
    global _ENGINE_MODULE
    if _ENGINE_MODULE is not None:
        return _ENGINE_MODULE

    try:
        import importlib.util
        from pathlib import Path

        engine_path = Path(__file__).with_name("auto_summary_prompt_pipeline.py")
        spec = importlib.util.spec_from_file_location("auto_summary_engine_runtime", engine_path)
        if not spec or not spec.loader:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _ENGINE_MODULE = module
        return _ENGINE_MODULE
    except Exception:
        return None


def extend(context=None):
    context = context or {}
    engine = _load_engine_module()
    if not engine:
        return

    runner = getattr(engine, "_execute", None)
    if callable(runner):
        try:
            runner(context)
        except Exception:
            return
