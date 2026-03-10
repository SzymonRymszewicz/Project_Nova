import importlib.util
import re
import sys
import threading
from pathlib import Path


class ModuleExtensionManager:
    EXTENSION_CALLABLE_NAMES = ("extend", "process")
    READ_ONLY_ACTIONS = {"list", "get", "status", "health", "fetch"}

    def __init__(self, modules_root, debug_logger=None):
        self.modules_root = Path(modules_root)
        self.debug_logger = debug_logger
        self._extension_file_cache = {}
        self._execution_cache = set()
        self._lock = threading.RLock()

    def _normalize_module_name(self, module_name):
        return str(module_name or "").strip()

    def _normalized_payload_dict(self, payload):
        return payload if isinstance(payload, dict) else {}

    def _build_per_file_context(self, base_context, module_name, target_name, file_path, **extra):
        context = dict(base_context or {})
        context.update(
            {
                "module_name": module_name,
                "target": target_name,
                "extension_file": str(file_path),
            }
        )
        if extra:
            context.update(extra)
        return context

    def _debug(self, event, **details):
        if callable(self.debug_logger):
            try:
                self.debug_logger(f"module_extension.{event}", **details)
            except Exception:
                pass

    def _discover_extension_files(self, module_name):
        name = self._normalize_module_name(module_name)
        if not name:
            return []

        cache_key = name.lower()
        with self._lock:
            cached = self._extension_file_cache.get(cache_key)
            if cached is not None:
                return list(cached)

        module_folder = self.modules_root / name
        if not module_folder.exists() or not module_folder.is_dir():
            with self._lock:
                self._extension_file_cache[cache_key] = []
            return []

        file_prefixes = self._module_prefix_variants(name)
        extension_files = []

        seen_paths = set()
        for file_prefix in file_prefixes:
            root_file = module_folder / f"{file_prefix}.py"
            root_file_key = str(root_file.resolve())
            if root_file.exists() and root_file.is_file() and root_file_key not in seen_paths:
                extension_files.append(root_file)
                seen_paths.add(root_file_key)

            for path in sorted(module_folder.glob(f"{file_prefix}_*.py")):
                path_key = str(path.resolve())
                if path_key in seen_paths:
                    continue
                extension_files.append(path)
                seen_paths.add(path_key)

        with self._lock:
            self._extension_file_cache[cache_key] = list(extension_files)

        return extension_files

    def _module_prefix_variants(self, module_name):
        base = self._normalize_module_name(module_name).lower()
        if not base:
            return []

        variants = [
            base,
            re.sub(r"[\s-]+", "_", base),
            re.sub(r"[\s_]+", "-", base),
            re.sub(r"[\s_-]+", "", base),
        ]

        unique = []
        for item in variants:
            token = str(item or "").strip()
            if not token or token in unique:
                continue
            unique.append(token)
        return unique

    def _resolve_target_name(self, module_name, file_path):
        file_stem = file_path.stem.lower()
        module_prefixes = self._module_prefix_variants(module_name)
        if not module_prefixes:
            return "unknown"

        for module_prefix in module_prefixes:
            if file_stem == module_prefix:
                return "main"

            prefix = f"{module_prefix}_"
            if file_stem.startswith(prefix):
                return file_stem[len(prefix):]

        return "unknown"

    def _load_extension_module(self, module_name, file_path):
        cache_key = f"bluenova.extension.{str(module_name).lower()}.{file_path.stem.lower()}"
        loaded = sys.modules.get(cache_key)
        if loaded is not None:
            return loaded

        spec = importlib.util.spec_from_file_location(cache_key, file_path)
        if not spec or not spec.loader:
            return None

        module = importlib.util.module_from_spec(spec)
        sys.modules[cache_key] = module
        spec.loader.exec_module(module)
        return module

    def _call_extension(self, module_obj, context):
        for function_name in self.EXTENSION_CALLABLE_NAMES:
            if not hasattr(module_obj, function_name):
                continue
            extension_callable = getattr(module_obj, function_name)
            if not callable(extension_callable):
                continue
            try:
                extension_callable(context)
            except TypeError:
                extension_callable()
            return True
        return False

    def _call_module_action(self, module_obj, action, payload, context):
        if not hasattr(module_obj, "handle_action"):
            return False, None

        action_callable = getattr(module_obj, "handle_action")
        if not callable(action_callable):
            return False, None

        try:
            result = action_callable(action=action, payload=payload, context=context)
        except TypeError:
            try:
                result = action_callable(action, payload, context)
            except TypeError:
                try:
                    result = action_callable(action, payload)
                except TypeError:
                    result = action_callable(action)

        return True, result

    def execute_module_extensions(self, module_name, context=None):
        extension_context = dict(context or {})
        module_name = self._normalize_module_name(module_name)
        if not module_name:
            return []

        chat_id = str(extension_context.get("chat_id") or "__global__")
        executed_targets = []

        for file_path in self._discover_extension_files(module_name):
            target_name = self._resolve_target_name(module_name, file_path)
            skip_repeated = target_name != "main"
            execution_key = (module_name.lower(), chat_id, file_path.name.lower())

            if skip_repeated:
                with self._lock:
                    if execution_key in self._execution_cache:
                        continue

            try:
                module_obj = self._load_extension_module(module_name, file_path)
                if module_obj is None:
                    continue

                per_file_context = self._build_per_file_context(
                    extension_context,
                    module_name,
                    target_name,
                    file_path,
                )

                called = self._call_extension(module_obj, per_file_context)
                if not called:
                    continue

                if skip_repeated:
                    with self._lock:
                        self._execution_cache.add(execution_key)

                executed_targets.append(target_name)
                self._debug(
                    "executed",
                    module_name=module_name,
                    target=target_name,
                    extension_file=file_path.name,
                    chat_id=chat_id
                )
            except Exception as exc:
                self._debug(
                    "execution_error",
                    module_name=module_name,
                    target=target_name,
                    extension_file=file_path.name,
                    error=str(exc)
                )

        return executed_targets

    def execute_module_action(self, module_name, action, payload=None, context=None):
        extension_context = dict(context or {})
        module_name = self._normalize_module_name(module_name)
        action_name = self._normalize_module_name(action)
        if not module_name or not action_name:
            return {
                "success": False,
                "handled": False,
                "result": None,
                "targets": []
            }

        payload_dict = self._normalized_payload_dict(payload)

        executed_targets = []
        handled = False
        action_result = None

        for file_path in self._discover_extension_files(module_name):
            target_name = self._resolve_target_name(module_name, file_path)
            try:
                module_obj = self._load_extension_module(module_name, file_path)
                if module_obj is None:
                    continue

                per_file_context = self._build_per_file_context(
                    extension_context,
                    module_name,
                    target_name,
                    file_path,
                    module_action=action_name,
                    module_action_payload=payload_dict,
                )

                is_handled, result = self._call_module_action(
                    module_obj,
                    action_name,
                    payload_dict,
                    per_file_context
                )
                if not is_handled:
                    continue

                handled = True
                executed_targets.append(target_name)
                if result is not None:
                    action_result = result

                if action_name.lower() not in self.READ_ONLY_ACTIONS:
                    self._debug(
                        "action_executed",
                        module_name=module_name,
                        target=target_name,
                        extension_file=file_path.name,
                        action=action_name
                    )
            except Exception as exc:
                self._debug(
                    "action_execution_error",
                    module_name=module_name,
                    target=target_name,
                    extension_file=file_path.name,
                    action=action_name,
                    error=str(exc)
                )

        return {
            "success": handled,
            "handled": handled,
            "result": action_result,
            "targets": executed_targets
        }
