"""
ExampleModule demonstrates the module system.

This module will print a message to the console when it's enabled in the prompt order.
"""

MODULE_PROMPT = """
Auxiliary Capability
You have access to an example module that demonstrates the modding system.
This is a simple test module to verify module loading and execution.
"""

def process():
    """This function is called when the module is processed during prompt building."""
    print("[ExampleModule] I am an example module!")
    return MODULE_PROMPT


def extend(context=None):
    print("I extend main file!")
    return MODULE_PROMPT

# But can it run DOOM?

# This file should be added loaded dynamically into main.py