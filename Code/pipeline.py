# This file contains the Pipeline class. The Pipeline class is responsible for managing the flow of the application. It will be responsible for calling the different modules in the correct order and passing data between them.

import time
from TKAEMS import TKAEMS
from variables import *

# The pipeline consists of the following steps:
# 1. Get core information (rules for the bot, core context, etc.)
# 2. Load memory from the TKAEMS (Tiered Keyword and Embedding Memory System). This will be the context for the application and will be used to generate responses based on the user input and the core information.
# 3. Listen for user input and update the context with the new information.
# 4. Process the context and generate a response based on the core information and the user input.

class Pipeline:
    def __init__(self, bot, stop_event=None):

        print("Pipeline initialized!") # Print a message when the pipeline is initialized.

        self.cycle_count = 0 # This variable will keep track of how many times the cycle method has been called.
        self.stop_event = stop_event
        
        self.tkaems = TKAEMS(bot) # Initialize the TKAEMS(Tiered Keyword and Embedding Memory System).
        self.context = ""

        self.cycle()
    
    def cycle(self): # This method will be called in a loop to keep the application running. It will call the different modules in the correct order and pass data between them.
        if self.stop_event is not None and self.stop_event.is_set():
            return
        
        self.cycle_count += 1
        print("--------------------------------")
        print(f"Cycle started! (cycle id: {self.cycle_count})")

        # Cycle loop starts here. We will call the different modules in the correct order and pass data between them.

        self.context += self.get_core() # This will get the core information. Rules for the bot, core context, etc.
        self.context += self.tkaems.initialize_memory() # Load the memory in order from the TKAEMS. This will be the context for the application and will be used to generate responses based on the user input and the core information.
        self.context += self.listen() # Update the context with the new information.
        self.process_prompt() # This is where we will process the context and generate a response based on the core information and the user input. This is where the main logic of the application will be implemented.

        # Cycle loop ends here.

        print(f"Cycle ended! (cycle id: {self.cycle_count}). Waiting for {AUTO_CALL_DELAY} seconds before starting the next cycle...")
        print("--------------------------------")

        time.sleep(AUTO_CALL_DELAY)
        if self.stop_event is not None and self.stop_event.is_set():
            return
        self.cycle() # Call the cycle method again to keep the application running.

    def get_core(self):
        print("Getting core information...") # This is where we will get the core information. Rules for the bot, core context, etc. This information will be used to guide the behavior of the application and will be stored in the context.
        return "Core information. " # This is just a placeholder. We will replace this with the actual core information later.
    
    def process_prompt(self):
        print("Processing context...") # This is where we will process the context and generate a response based on the core information and the user input. This is where the main logic of the application will be implemented.
        return "Response. " # This is just a placeholder. We will replace this with the actual response generation later.

    def listen(self):
        print("Listening for input...") # This is where we will listen for user input and update the context with the new information.
        return "Input. " # This is just a placeholder. We will replace this with the actual user input later.