# TKAEMS: Tiered Keyword and Embedding Memory System. 
# This module will be responsible for managing the memory of the application. 
# It will be responsible for storing and retrieving data from the different tiers of memory and deleting them when the memory capacity is exceeded.

from variables import *

# Conceptual structure of the TKAEMS:

# Imiediately accessible memory (IAM)
# Short-term memory (STM)
# Mid-term memory (MTM)
# Long-term memory (LTM)

# Memory template: timestamp, content, embedding, keywords, type, importance, last_accessed

class TKAEMS:
    def __init__(self, bot):
        self.bot = bot
        print(f"TKAEMS initialized for bot '{self.bot.replace('bot_', '')}'! Current strategy: {TKAEMS_Memory_Deletion_Strategy}")

    def initialize_memory(self):
        print("Initializing memory...") # Loading memory from storage. This is where we will load the memory from storage and return it in order to be used by the pipeline.
        return "Memory initialized. " # This is just a placeholder. We will replace this with the actual memory later.
    
    def delete_memory(self, memory):
        print("Deleting memory...") # Deleting memory from storage. This is where we will delete the memory from storage when the memory capacity is exceeded.
        return "Memory deleted. " # This is just a placeholder. We will replace this with the actual memory deletion later.
    
    def retrieve_memory(self, query):
        print("Retrieving memory...") # Retrieving memory from storage. This is where we will retrieve the memory from storage based on the query and return it to be used by the pipeline.
        return "Memory retrieved. " # This is just a placeholder. We will replace this with the actual memory retrieval later.