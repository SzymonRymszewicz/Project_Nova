import json
import re
import uuid
from datetime import datetime
from pathlib import Path


class DatasetManager:
	"""Manage global datasets used for prompt-time context injection."""

	def __init__(self, datasets_folder="../Datasets"):
		self.datasets_folder = (Path(__file__).parent / datasets_folder).resolve()
		self._migrate_legacy_bot_scoped_datasets()

	def _migrate_legacy_bot_scoped_datasets(self):
		global_path = self._datasets_file()
		try:
			if global_path.exists() and global_path.is_file():
				existing = json.loads(global_path.read_text(encoding="utf-8"))
				if isinstance(existing, dict) and isinstance(existing.get("datasets"), list) and existing.get("datasets"):
					return
		except Exception:
			pass

		bots_root = (Path(__file__).parent.parent / "Bots").resolve()
		if not bots_root.exists() or not bots_root.is_dir():
			return

		collected = []
		seen_ids = set()
		for bot_dir in bots_root.iterdir():
			if not bot_dir.is_dir() or bot_dir.name.startswith('.') or bot_dir.name == '__pycache__':
				continue
			legacy_path = bot_dir / "Datasets" / "datasets.json"
			if not legacy_path.exists() or not legacy_path.is_file():
				continue
			try:
				legacy_payload = json.loads(legacy_path.read_text(encoding="utf-8"))
			except Exception:
				continue
			legacy_rows = legacy_payload.get("datasets") if isinstance(legacy_payload, dict) else None
			if not isinstance(legacy_rows, list):
				continue

			for row in legacy_rows:
				if not isinstance(row, dict):
					continue
				dataset = dict(row)
				dataset_id = self._safe_text(dataset.get("id")) or f"dataset_{uuid.uuid4().hex}"
				if dataset_id in seen_ids:
					dataset_id = f"dataset_{uuid.uuid4().hex}"
				seen_ids.add(dataset_id)
				dataset["id"] = dataset_id
				if not self._safe_text(dataset.get("name")):
					dataset["name"] = f"{bot_dir.name} Dataset"
				collected.append(dataset)

		if not collected:
			return

		payload = self._normalize_payload({"datasets": collected})
		try:
			global_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
		except Exception:
			return

	def _iso_now(self):
		return datetime.utcnow().isoformat() + "Z"

	def _safe_text(self, value, fallback=""):
		return str(value if value is not None else fallback).strip()

	def _datasets_file(self):
		self.datasets_folder.mkdir(parents=True, exist_ok=True)
		return self.datasets_folder / "datasets.json"

	def _empty_payload(self):
		return {"datasets": []}

	def _read_payload(self, bot_name=None):
		path = self._datasets_file()
		if not path.exists() or not path.is_file():
			return self._empty_payload()
		try:
			payload = json.loads(path.read_text(encoding="utf-8"))
		except Exception:
			return self._empty_payload()
		if not isinstance(payload, dict):
			return self._empty_payload()
		datasets = payload.get("datasets")
		if not isinstance(datasets, list):
			datasets = []
		return {"datasets": datasets}

	def _write_payload(self, bot_name=None, payload=None):
		path = self._datasets_file()
		safe_payload = payload if isinstance(payload, dict) else self._empty_payload()
		if not isinstance(safe_payload.get("datasets"), list):
			safe_payload["datasets"] = []
		try:
			path.write_text(json.dumps(safe_payload, indent=2, ensure_ascii=False), encoding="utf-8")
			return True
		except Exception:
			return False

	def _normalize_keywords(self, raw_keywords):
		if isinstance(raw_keywords, list):
			items = raw_keywords
		else:
			text = self._safe_text(raw_keywords)
			items = [item.strip() for item in text.split(",")] if text else []
		out = []
		seen = set()
		for item in items:
			token = self._safe_text(item).lower()
			if not token or token in seen:
				continue
			seen.add(token)
			out.append(token)
		return out[:24]

	def _normalize_entry(self, row, order_index=0):
		row = row if isinstance(row, dict) else {}
		mode = self._safe_text(row.get("mode") or "static").lower()
		if mode not in {"static", "dynamic", "inactive"}:
			mode = "static"
		entry_id = self._safe_text(row.get("id")) or f"entry_{uuid.uuid4().hex}"
		entry_name = self._safe_text(row.get("name"))
		context_text = self._safe_text(row.get("context"))
		collapsed = bool(row.get("collapsed", False))
		created_at = self._safe_text(row.get("created_at")) or self._iso_now()
		updated_at = self._safe_text(row.get("updated_at")) or self._iso_now()
		prompt_enabled = bool(row.get("prompt_enabled", True))
		if not prompt_enabled:
			# Backward compatibility: legacy prompt toggle off maps to explicit inactive mode.
			mode = "inactive"

		try:
			order_value = int(row.get("order"))
		except Exception:
			order_value = int(order_index)

		return {
			"id": entry_id,
			"name": entry_name,
			"context": context_text,
			"collapsed": collapsed,
			"mode": mode,
			"keywords": self._normalize_keywords(row.get("keywords")),
			"prompt_enabled": prompt_enabled,
			"order": max(0, order_value),
			"created_at": created_at,
			"updated_at": updated_at,
		}

	def _normalize_dataset(self, row, order_index=0):
		row = row if isinstance(row, dict) else {}
		dataset_id = self._safe_text(row.get("id")) or f"dataset_{uuid.uuid4().hex}"
		name = self._safe_text(row.get("name") or "Untitled Dataset")
		description = self._safe_text(row.get("description"))
		created_at = self._safe_text(row.get("created_at")) or self._iso_now()
		updated_at = self._safe_text(row.get("updated_at")) or self._iso_now()

		entries = row.get("entries") if isinstance(row.get("entries"), list) else []
		normalized_entries = []
		for index, entry in enumerate(entries):
			normalized_entries.append(self._normalize_entry(entry, order_index=index))
		normalized_entries.sort(key=lambda item: int(item.get("order", 0)))
		for index, entry in enumerate(normalized_entries):
			entry["order"] = index

		try:
			order_value = int(row.get("order"))
		except Exception:
			order_value = int(order_index)

		return {
			"id": dataset_id,
			"name": name,
			"description": description,
			"order": max(0, order_value),
			"created_at": created_at,
			"updated_at": updated_at,
			"entries": normalized_entries,
		}

	def _normalize_payload(self, payload):
		payload = payload if isinstance(payload, dict) else self._empty_payload()
		datasets = payload.get("datasets") if isinstance(payload.get("datasets"), list) else []
		normalized = [self._normalize_dataset(item, order_index=index) for index, item in enumerate(datasets)]
		normalized.sort(key=lambda item: int(item.get("order", 0)))
		for index, dataset in enumerate(normalized):
			dataset["order"] = index
		return {"datasets": normalized}

	def _load_normalized_payload(self, bot_name=None):
		payload = self._read_payload(bot_name=bot_name)
		return self._normalize_payload(payload)

	def _find_dataset(self, payload, dataset_id):
		dataset_id = self._safe_text(dataset_id)
		if not dataset_id:
			return None
		datasets = payload.get("datasets") if isinstance(payload, dict) else None
		if not isinstance(datasets, list):
			return None
		for dataset in datasets:
			if self._safe_text(dataset.get("id")) == dataset_id:
				return dataset
		return None

	def _find_entry(self, dataset, entry_id):
		entry_id = self._safe_text(entry_id)
		if not entry_id:
			return None
		entries = dataset.get("entries") if isinstance(dataset, dict) else None
		if not isinstance(entries, list):
			return None
		for entry in entries:
			if self._safe_text(entry.get("id")) == entry_id:
				return entry
		return None

	def _save_normalized_payload(self, bot_name=None, payload=None):
		safe_payload = self._normalize_payload(payload)
		return self._write_payload(bot_name=bot_name, payload=safe_payload)

	def list_datasets(self, bot_name=None):
		payload = self._load_normalized_payload(bot_name)
		datasets = payload.get("datasets") if isinstance(payload.get("datasets"), list) else []
		return {
			"success": True,
			"scope": "global",
			"datasets": datasets,
		}

	def create_dataset(self, bot_name, name, description=""):
		payload = self._load_normalized_payload(bot_name)
		datasets = payload.get("datasets")
		now = self._iso_now()
		new_dataset = {
			"id": f"dataset_{uuid.uuid4().hex}",
			"name": self._safe_text(name) or "Untitled Dataset",
			"description": self._safe_text(description),
			"order": len(datasets),
			"created_at": now,
			"updated_at": now,
			"entries": [],
		}
		datasets.append(new_dataset)
		if not self._save_normalized_payload(bot_name, payload):
			return {"success": False, "message": "Failed to save dataset."}
		return self.list_datasets(bot_name)

	def update_dataset(self, bot_name, dataset_id, name=None, description=None):
		payload = self._load_normalized_payload(bot_name)
		dataset = self._find_dataset(payload, dataset_id)
		if dataset is None:
			return {"success": False, "message": "Dataset not found."}
		if name is not None:
			dataset["name"] = self._safe_text(name) or dataset.get("name") or "Untitled Dataset"
		if description is not None:
			dataset["description"] = self._safe_text(description)
		dataset["updated_at"] = self._iso_now()
		if not self._save_normalized_payload(bot_name, payload):
			return {"success": False, "message": "Failed to save dataset."}
		return self.list_datasets(bot_name)

	def delete_dataset(self, bot_name, dataset_id):
		payload = self._load_normalized_payload(bot_name)
		datasets = payload.get("datasets")
		before = len(datasets)
		datasets[:] = [row for row in datasets if self._safe_text(row.get("id")) != self._safe_text(dataset_id)]
		if len(datasets) == before:
			return {"success": False, "message": "Dataset not found."}
		if not self._save_normalized_payload(bot_name, payload):
			return {"success": False, "message": "Failed to save dataset."}
		return self.list_datasets(bot_name)

	def create_entry(self, bot_name, dataset_id, entry_payload):
		payload = self._load_normalized_payload(bot_name)
		dataset = self._find_dataset(payload, dataset_id)
		if dataset is None:
			return {"success": False, "message": "Dataset not found."}

		entry_payload = entry_payload if isinstance(entry_payload, dict) else {}
		now = self._iso_now()
		entry = {
			"id": f"entry_{uuid.uuid4().hex}",
			"name": self._safe_text(entry_payload.get("name")),
			"context": self._safe_text(entry_payload.get("context")),
			"collapsed": bool(entry_payload.get("collapsed", False)),
			"mode": self._safe_text(entry_payload.get("mode") or "static").lower(),
			"keywords": self._normalize_keywords(entry_payload.get("keywords")),
			"prompt_enabled": bool(entry_payload.get("prompt_enabled", True)),
			"order": len(dataset.get("entries") or []),
			"created_at": now,
			"updated_at": now,
		}
		if entry["mode"] not in {"static", "dynamic", "inactive"}:
			entry["mode"] = "static"
		entry["prompt_enabled"] = entry["mode"] != "inactive"

		dataset.setdefault("entries", []).append(entry)
		dataset["updated_at"] = now
		if not self._save_normalized_payload(bot_name, payload):
			return {"success": False, "message": "Failed to save entry."}
		return self.list_datasets(bot_name)

	def update_entry(self, bot_name, dataset_id, entry_id, entry_payload):
		payload = self._load_normalized_payload(bot_name)
		dataset = self._find_dataset(payload, dataset_id)
		if dataset is None:
			return {"success": False, "message": "Dataset not found."}
		entry = self._find_entry(dataset, entry_id)
		if entry is None:
			return {"success": False, "message": "Entry not found."}

		entry_payload = entry_payload if isinstance(entry_payload, dict) else {}
		if "context" in entry_payload:
			entry["context"] = self._safe_text(entry_payload.get("context"))
		if "name" in entry_payload:
			entry["name"] = self._safe_text(entry_payload.get("name"))
		if "collapsed" in entry_payload:
			entry["collapsed"] = bool(entry_payload.get("collapsed"))
		if "mode" in entry_payload:
			mode = self._safe_text(entry_payload.get("mode") or "static").lower()
			entry["mode"] = mode if mode in {"static", "dynamic", "inactive"} else "static"
		if "keywords" in entry_payload:
			entry["keywords"] = self._normalize_keywords(entry_payload.get("keywords"))
		if "prompt_enabled" in entry_payload:
			# Legacy compatibility with old checkbox payloads.
			entry["mode"] = "inactive" if not bool(entry_payload.get("prompt_enabled")) else (entry.get("mode") or "static")

		entry["prompt_enabled"] = self._safe_text(entry.get("mode") or "static").lower() != "inactive"

		entry["updated_at"] = self._iso_now()
		dataset["updated_at"] = self._iso_now()
		if not self._save_normalized_payload(bot_name, payload):
			return {"success": False, "message": "Failed to save entry."}
		return self.list_datasets(bot_name)

	def delete_entry(self, bot_name, dataset_id, entry_id):
		payload = self._load_normalized_payload(bot_name)
		dataset = self._find_dataset(payload, dataset_id)
		if dataset is None:
			return {"success": False, "message": "Dataset not found."}

		entries = dataset.get("entries") if isinstance(dataset.get("entries"), list) else []
		before = len(entries)
		entries[:] = [row for row in entries if self._safe_text(row.get("id")) != self._safe_text(entry_id)]
		if len(entries) == before:
			return {"success": False, "message": "Entry not found."}

		for index, row in enumerate(entries):
			row["order"] = index
		dataset["updated_at"] = self._iso_now()
		if not self._save_normalized_payload(bot_name, payload):
			return {"success": False, "message": "Failed to save entry changes."}
		return self.list_datasets(bot_name)

	def reorder_entries(self, bot_name, dataset_id, ordered_entry_ids):
		payload = self._load_normalized_payload(bot_name)
		dataset = self._find_dataset(payload, dataset_id)
		if dataset is None:
			return {"success": False, "message": "Dataset not found."}

		entries = dataset.get("entries") if isinstance(dataset.get("entries"), list) else []
		id_order = [self._safe_text(item) for item in (ordered_entry_ids or []) if self._safe_text(item)]
		by_id = {self._safe_text(item.get("id")): item for item in entries}
		reordered = []
		seen = set()

		for entry_id in id_order:
			row = by_id.get(entry_id)
			if row is None or entry_id in seen:
				continue
			reordered.append(row)
			seen.add(entry_id)

		for row in entries:
			row_id = self._safe_text(row.get("id"))
			if row_id in seen:
				continue
			reordered.append(row)
			seen.add(row_id)

		for index, row in enumerate(reordered):
			row["order"] = index

		dataset["entries"] = reordered
		dataset["updated_at"] = self._iso_now()
		if not self._save_normalized_payload(bot_name, payload):
			return {"success": False, "message": "Failed to save entry order."}
		return self.list_datasets(bot_name)

	def _keyword_matches(self, keyword, context_text):
		safe_keyword = self._safe_text(keyword).lower()
		if not safe_keyword:
			return False
		if len(safe_keyword) >= 3:
			pattern = rf"\b{re.escape(safe_keyword)}\b"
			if re.search(pattern, context_text):
				return True
		return safe_keyword in context_text

	def _normalize_injection_persistence(self, value):
		try:
			parsed = int(value)
		except Exception:
			parsed = 6
		return max(0, parsed)

	def _build_user_turn_texts(self, latest_user_message, history_messages):
		turns = []
		for row in (history_messages or []):
			if not isinstance(row, dict):
				continue
			if self._safe_text(row.get("role")).lower() != "user":
				continue
			content = self._safe_text(row.get("content"))
			if not content:
				continue
			turns.append(content)

		latest_text = self._safe_text(latest_user_message)
		if latest_text:
			if not turns or turns[-1] != latest_text:
				turns.append(latest_text)

		return turns

	def _resolve_dynamic_entry_state(self, keywords, latest_user_text, user_turn_texts, persistence_turns):
		keyword_list = [self._safe_text(keyword) for keyword in (keywords or []) if self._safe_text(keyword)]
		if not keyword_list:
			return {
				"include": False,
				"matched_keywords": [],
				"trigger_reason": "",
				"turns_since_trigger": None,
				"turns_remaining": None,
			}

		direct_matches = [
			keyword
			for keyword in keyword_list
			if self._keyword_matches(keyword, latest_user_text)
		]
		if direct_matches:
			return {
				"include": True,
				"matched_keywords": direct_matches,
				"trigger_reason": "mode:dynamic keyword_match",
				"turns_since_trigger": 0,
				"turns_remaining": persistence_turns,
			}

		if persistence_turns <= 0:
			return {
				"include": False,
				"matched_keywords": [],
				"trigger_reason": "",
				"turns_since_trigger": None,
				"turns_remaining": None,
			}

		if len(user_turn_texts) <= 1:
			return {
				"include": False,
				"matched_keywords": [],
				"trigger_reason": "",
				"turns_since_trigger": None,
				"turns_remaining": None,
			}

		for reverse_index, turn_text in enumerate(reversed(user_turn_texts[:-1]), start=1):
			matched = [
				keyword
				for keyword in keyword_list
				if self._keyword_matches(keyword, turn_text)
			]
			if not matched:
				continue
			if reverse_index <= persistence_turns:
				return {
					"include": True,
					"matched_keywords": matched,
					"trigger_reason": "mode:dynamic persistence_window",
					"turns_since_trigger": reverse_index,
					"turns_remaining": max(0, persistence_turns - reverse_index),
				}
			break

		return {
			"include": False,
			"matched_keywords": [],
			"trigger_reason": "",
			"turns_since_trigger": None,
			"turns_remaining": None,
		}

	def resolve_injections(self, bot_name, latest_user_message, history_messages=None, dataset_id=None, injection_persistence=None):
		payload = self._load_normalized_payload(bot_name)
		datasets = payload.get("datasets") if isinstance(payload.get("datasets"), list) else []
		target_dataset_id = self._safe_text(dataset_id)
		if target_dataset_id:
			datasets = [
				row for row in datasets
				if self._safe_text((row or {}).get("id")) == target_dataset_id
			]
		history_messages = history_messages if isinstance(history_messages, list) else []
		latest_user_text = self._safe_text(latest_user_message).lower()
		persistence_turns = self._normalize_injection_persistence(injection_persistence)
		user_turn_texts = [item.lower() for item in self._build_user_turn_texts(latest_user_message, history_messages)]

		resolved = []
		for dataset in datasets:
			dataset_name = self._safe_text(dataset.get("name") or "Dataset")
			entries = dataset.get("entries") if isinstance(dataset.get("entries"), list) else []
			entries = sorted(entries, key=lambda row: int(row.get("order", 0)))
			for entry in entries:
				mode = self._safe_text(entry.get("mode") or "static").lower()
				if mode not in {"static", "dynamic", "inactive"}:
					mode = "static"
				if mode == "inactive":
					continue
				if not bool(entry.get("prompt_enabled", True)):
					continue

				matched_keywords = []
				trigger_reason = "mode:static"
				turns_since_trigger = None
				turns_remaining = None

				if mode == "dynamic":
					keywords = entry.get("keywords") if isinstance(entry.get("keywords"), list) else []
					entry_state = self._resolve_dynamic_entry_state(
						keywords=keywords,
						latest_user_text=latest_user_text,
						user_turn_texts=user_turn_texts,
						persistence_turns=persistence_turns,
					)
					if not entry_state.get("include"):
						continue
					matched_keywords = entry_state.get("matched_keywords") or []
					trigger_reason = self._safe_text(entry_state.get("trigger_reason")) or "mode:dynamic keyword_match"
					turns_since_trigger = entry_state.get("turns_since_trigger")
					turns_remaining = entry_state.get("turns_remaining")

				context_value = self._safe_text(entry.get("context"))
				if not context_value:
					continue

				resolved.append(
					{
						"dataset_id": self._safe_text(dataset.get("id")),
						"dataset_name": dataset_name,
						"entry_id": self._safe_text(entry.get("id")),
						"entry_name": self._safe_text(entry.get("name")),
						"mode": mode,
						"trigger_reason": trigger_reason,
						"matched_keywords": matched_keywords,
						"turns_since_trigger": turns_since_trigger,
						"turns_remaining": turns_remaining,
						"injection_persistence": persistence_turns,
						"context": context_value,
						"order": int(entry.get("order", 0)),
					}
				)

		return resolved
