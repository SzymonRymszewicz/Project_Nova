# All global variables should be defined here. This file is imported by all modules, so we can define variables that are shared across the entire project here.

__author__ = "Szymon Rymszewicz"
__version__ = "1.0.0"
__name__ = "Project Nova " + __version__

LOCALHOST = 5067 # The port that the GUI server will run on. You can change this if you want to run the GUI server on a different port.

AUTO_CALL_DELAY = 10 # seconds. This variable will be used to set the time between automatic calls to the cycle method in the pipeline. 

# Global variables for the TKAEMS (Tiered Keyword and Embedding Memory System)

TKAEMS_Memory_Capacity = 30000 # Tokens over this value will trigger the deletion of memories in the TKAEMS.
TKAEMS_IAM_LIMIT = 20 # Messages over this value will be turned into memories and stored in the TKAEMS.

TKAEMS_STM_Strategy = ["STM", 30, 20, 10] # Short-term memory deletion strategy(STM priority). This strategy will delete the least recently used memories first.

# Memory deletion strategy for all tiers of memory. This variable is used to set the deletion strategy for all tiers of memory at once.
TKAEMS_Memory_Deletion_Strategy = TKAEMS_STM_Strategy 