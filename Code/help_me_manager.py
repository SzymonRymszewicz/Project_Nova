from pathlib import Path
import json
import re


class HelpMeManager:
	ROOT_TITLE = "Help me"
	DEFAULT_ORDER = 1_000_000
	README_CANDIDATES = ("README", "README.md", "README.txt", "readme", "readme.md", "readme.txt")

	def __init__(self):
		self._helpme_dir = Path(__file__).resolve().parent.parent / "HelpMe"

	def get_docs_tree(self):
		if not self._helpme_dir.exists() or not self._helpme_dir.is_dir():
			return self._empty_docs_tree()

		root_nodes = [self._build_node(child_dir, [child_dir.name]) for child_dir in self._iter_child_dirs(self._helpme_dir)]
		root_nodes = self._sort_nodes(root_nodes, {})

		flat_nodes = []
		self._flatten_nodes(root_nodes, flat_nodes)
		default_node_id = self._find_default_node_id(flat_nodes)

		return {
			"available": True,
			"root_title": self.ROOT_TITLE,
			"tree": root_nodes,
			"flat": flat_nodes,
			"default_node_id": default_node_id,
		}

	def _empty_docs_tree(self):
		return {
			"available": False,
			"root_title": self.ROOT_TITLE,
			"tree": [],
			"flat": [],
			"default_node_id": None,
		}

	def _iter_child_dirs(self, folder_path):
		for child_path in folder_path.iterdir():
			if child_path.is_dir():
				yield child_path

	def _find_default_node_id(self, flat_nodes):
		for node in flat_nodes:
			if node.get("has_content"):
				return node.get("id")
		if flat_nodes:
			return flat_nodes[0].get("id")
		return None

	def _build_node(self, folder_path, path_parts):
		metadata = self._load_metadata(folder_path)
		readme_name, readme_content = self._read_readme(folder_path)

		title = str(metadata.get("title") or "").strip() or self._folder_title(folder_path.name)
		description = str(metadata.get("description") or "").strip()

		node = {
			"id": self._build_node_id(path_parts),
			"path": "/".join(path_parts),
			"title": title,
			"folder_name": folder_path.name,
			"description": description,
			"readme_file": readme_name,
			"content": readme_content,
			"has_content": bool(readme_content.strip()),
			"order": self._parse_order(metadata.get("order")),
			"children": [],
		}

		child_nodes = [self._build_node(child_dir, path_parts + [child_dir.name]) for child_dir in self._iter_child_dirs(folder_path)]
		node["children"] = self._sort_nodes(child_nodes, metadata)
		return node

	def _load_metadata(self, folder_path):
		json_candidates = [path for path in folder_path.iterdir() if path.is_file() and path.suffix.lower() == ".json"]
		if not json_candidates:
			return {}

		folder_token = self._slugify(folder_path.name)
		json_candidates.sort(key=lambda path: path.name.lower())

		selected = json_candidates[0]
		for candidate in json_candidates:
			if self._slugify(candidate.stem) == folder_token:
				selected = candidate
				break

		try:
			payload = json.loads(selected.read_text(encoding="utf-8", errors="ignore") or "{}")
			return payload if isinstance(payload, dict) else {}
		except Exception:
			return {}

	def _read_readme(self, folder_path):
		for file_name in self.README_CANDIDATES:
			candidate = folder_path / file_name
			if candidate.exists() and candidate.is_file():
				return candidate.name, candidate.read_text(encoding="utf-8", errors="ignore")

		for candidate in folder_path.iterdir():
			if candidate.is_file() and candidate.stem.lower() == "readme":
				return candidate.name, candidate.read_text(encoding="utf-8", errors="ignore")

		return None, ""

	def _sort_nodes(self, nodes, parent_metadata):
		if not nodes:
			return []

		child_order = parent_metadata.get("children")
		if not isinstance(child_order, list):
			child_order = parent_metadata.get("child_order")
		if not isinstance(child_order, list):
			child_order = []

		child_order_map = {}
		for index, entry in enumerate(child_order):
			token = self._slugify(entry)
			if token and token not in child_order_map:
				child_order_map[token] = index

		def _node_order_index(node):
			candidates = [
				node.get("folder_name"),
				node.get("title"),
				node.get("path", "").split("/")[-1],
			]
			best = None
			for candidate in candidates:
				token = self._slugify(candidate)
				if token in child_order_map:
					position = child_order_map[token]
					if best is None or position < best:
						best = position
			return best if best is not None else self.DEFAULT_ORDER

		nodes.sort(
			key=lambda node: (
				_node_order_index(node),
				node.get("order", self.DEFAULT_ORDER),
				str(node.get("title") or "").lower(),
			)
		)
		return nodes

	def _flatten_nodes(self, nodes, bucket):
		for node in nodes:
			bucket.append(
				{
					"id": node.get("id"),
					"path": node.get("path"),
					"title": node.get("title"),
					"description": node.get("description"),
					"content": node.get("content"),
					"has_content": node.get("has_content", False),
				}
			)
			self._flatten_nodes(node.get("children") or [], bucket)

	def _folder_title(self, folder_name):
		cleaned = re.sub(r"[_-]+", " ", str(folder_name or "").strip())
		return " ".join(word.capitalize() if word else "" for word in cleaned.split()) or "Untitled"

	def _build_node_id(self, parts):
		normalized = [self._slugify(part) for part in parts if str(part or "").strip()]
		return "/".join(segment for segment in normalized if segment)

	def _slugify(self, value):
		text = str(value or "").strip().lower()
		text = re.sub(r"[^a-z0-9\s_-]", "", text)
		text = re.sub(r"[\s_]+", "-", text)
		text = re.sub(r"-+", "-", text)
		return text.strip("-")

	def _parse_order(self, value):
		try:
			if value is None or value == "":
				return self.DEFAULT_ORDER
			return int(value)
		except Exception:
			return self.DEFAULT_ORDER
