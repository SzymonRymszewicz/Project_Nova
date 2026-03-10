"""
Developer Tools Manager
Provides debugging and development utilities accessible only when debug mode is enabled.
"""

import os
import sys
from pathlib import Path
from datetime import datetime


class DevManager:
    DEBUG_LOG_GLOB = "debug_session_*.txt"
    DEBUG_LOG_LIMIT = 10

    def __init__(self, settings_manager, debug_manager):
        self.settings_manager = settings_manager
        self.debug_manager = debug_manager
        self.project_root = Path(__file__).parent.parent

    def _get_debug_folder(self):
        return self.project_root / "Debug"

    def _iter_debug_log_files(self):
        debug_folder = self._get_debug_folder()
        if not debug_folder.exists():
            return []
        return sorted(debug_folder.glob(self.DEBUG_LOG_GLOB), reverse=True)
        
    def is_debug_mode_enabled(self):
        """Check if debug mode is currently enabled"""
        return bool(self.settings_manager.get("debug_mode", False))
    
    def get_system_info(self):
        """Get system and environment information"""
        return {
            "python_version": sys.version,
            "platform": sys.platform,
            "executable": sys.executable,
            "project_root": str(self.project_root),
            "working_directory": os.getcwd()
        }
    
    def get_debug_logs_summary(self):
        """Get summary of recent debug logs"""
        log_files = self._iter_debug_log_files()
        if not log_files:
            return {"available": False, "logs": []}

        logs = []

        for log_file in log_files[: self.DEBUG_LOG_LIMIT]:
            try:
                stat = log_file.stat()
                logs.append({
                    "name": log_file.name,
                    "size": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
                })
            except Exception:
                pass
        
        return {"available": True, "logs": logs}
    
    def delete_debug_logs(self):
        """Delete all debug log files."""
        log_files = self._iter_debug_log_files()
        if not log_files:
            return {"success": True, "deleted": 0}

        deleted = 0
        failed = []
        for log_file in log_files:
            try:
                log_file.unlink()
                deleted += 1
            except Exception as exc:
                failed.append(f"{log_file.name}: {exc}")

        if failed:
            return {
                "success": False,
                "deleted": deleted,
                "error": "Failed to delete some logs",
                "details": failed,
            }

        return {"success": True, "deleted": deleted}
