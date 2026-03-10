"""
Context Tracker module.

Provides UI-only context tracker behavior in chat header.
This module is intended to be enabled/disabled via bot prompt order
using the key: module::Context Tracker.
"""

MODULE_PROMPT = """
Auxiliary Capability (UI)
Context Tracker is enabled. It provides a chat-header context usage tracker in the UI.
"""


def process(context=None):
    return MODULE_PROMPT


def extend(context=None):
    return MODULE_PROMPT
