# Project NovaAI WIP
  
NovaAI is a local app where you can create and interact with bots. This program uses what I like to call the TKAEM system, meaning the Tiered Keyword and Embedding Memory system. This makes even high context bots have dynamic human-like memory and thought processing modules. This app does not provide an API and works only as an interface(similar to Silly Tavern). You can use a localhost or connect to your preferred API in order to interact with the bot.

I will not take any responsibility for what you do with this app. The LLM's and bots outputs in general are dependent on their definition and most importantly, the user input. I have no control or means to control what you do locally with this app.

The ultimate goal of this project is creating the ultimate all in one AI that can work even on small models. A true, imersive AI that will convince you it's human.

If you like what I create, consider supporting me by buying me a coffee ;)

<a href="https://www.buymeacoffee.com/saimon_szaszakg" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-yellow.png" alt="Buy Me A Coffee" height="100" width="500"></a>

---

## Simple Guide

### 1) Start the app

From the `Nova` folder, run:

```bash
start.bat
```

The script prepares dependencies, launches the app, starts the local GUI server, and opens the browser.

### 2) Configure API Client (Settings)

1. Open **Settings**.
2. Choose provider:
	- `Localhost (LM Studio)` for LM Studio/OpenAI-compatible local server
	- `LocalModel (Direct File)` to run a local model file directly from this project
	- `OpenAI` for OpenAI API
3. Confirm/update:
	- **Localhost:** API Base URL + Model
	- **LocalModel:** pick model file in **Local Model File** (from `Models/ChatModels`)
	- **OpenAI:** API Base URL + Model + API Key
4. Click **Test Connection**.
5. Save settings.

### 3) Create your Bot

1. Open **Bot Creation**.
2. Set bot name and core/scenario text.
3. (Optional) adjust prompt order in advanced settings.
4. Save.

### 4) Create/select Persona

1. Open **Personas** or **Persona Creation**.
2. Create or choose a persona.
3. Add persona definition text (stored as persona context).

### 5) Start chatting

1. Open **Chat**.
2. Select bot/persona.
3. Send a message.
4. Use hover actions on messages when needed:
	- Bot message: edit, regenerate, continue, delete
	- User message: edit, delete (and regenerate if no bot reply follows)
5. The app stores your conversation locally.

---

## Notes

- This project is still WIP, but the core end-to-end chat loop is active.
- Existing chats/settings are stored locally in project folders.
- If responses fail, check provider/base URL/model/API key first.

---

## Version 1.0.1 Update - What's new

This update focuses on chat quality-of-life, better message controls, and direct local model support.

### 1) New message action controls in Chat

Messages now have action buttons on hover:

- **Bot messages:** edit, regenerate, continue, delete
- **User messages:** edit, delete
- **User regenerate fallback:** if a user message has no following bot reply (for example after deleting a bot response), regenerate is available from that user message to create a new assistant reply.

### 2) Better generation UX feedback

- The chat now shows temporary **Thinking...** states during generation/regeneration.
- Regenerate and continue now display visual processing feedback directly in the message flow.

### 3) Improved regenerate/continue behavior

- Continue logic was improved to reduce repeated duplicate chunks.
- Regenerate can target both assistant messages and eligible user messages (when no assistant reply exists yet).

### 4) API Client now supports LocalModel provider

In addition to **Localhost** and **OpenAI**, there is now:

- **LocalModel (Direct File)** provider
- Local model file picker that lists files from `Models/ChatModels`
- Model list filtering to likely model file types (e.g. `.gguf`, `.bin`, `.safetensors`, `.pt`, `.pth`)

> Note: LocalModel requires `llama-cpp-python` in your Python environment.

### 5) Startup and repo safety improvements

- `start.bat` now bootstraps dependencies and launches the app directly.



