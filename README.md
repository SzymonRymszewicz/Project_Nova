# Project_Nova WIP
  
Project Nova is a python app where you can create and interact with bots. This program uses what I like to call the TKAEM system, meaning the Tiered Keyword and Embedding Memory system. This makes even high context bots have dynamic human-like memory and thought processing modules. This app does not provide an API and works only as an interface(similar to Silly Tavern). You can use a localhost or connect to your preferred API in order to interact with the bot.

I will not take any responsibility for what you do with this app. The LLM's and bots outputs in general are dependent on their definition and most importantly, the user input. I have no control or means to control what you do locally with this app.

If you like what I create, consider supporting me by buying me a coffee ;)

<a href="https://www.buymeacoffee.com/saimon_szaszakg" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-yellow.png" alt="Buy Me A Coffee" height="100" width="500"></a>

---

## Current Version (1.0.0) - How it works

This version is a local GUI-first bot studio with a working message pipeline.

- You can create, edit, and delete **Bots**.
- You can create, edit, and delete **Personas** (except the default `User` persona).
- You can start chats and send messages from the web UI.
- The app builds prompts in an ordered structure and sends them to your configured API (`/chat/completions`).
- The assistant response is returned to chat and also saved in chat history.

### Prompt build order (runtime)

At message time, the app composes context blocks using the configured Prompt Order:

1. **Core** (bot identity/name + core definition)
2. **Scenario** (rules/scenario)
3. **User / Persona** (persona name + persona definition from `user.txt` if available)
4. **IAM / Chat History** (conversation history)

Then it appends the latest user message (if not already present), sends the final message array to the selected model, and displays the result in the chat.

### API client behavior

- Supports **Localhost (LM Studio/OpenAI-compatible)** and **OpenAI** provider modes.
- Localhost defaults:
  - Base URL: `http://localhost:1234/v1`
  - Model: `Localhost`
- If API settings are missing/invalid, the chat returns a simple `API error: ...` message in the conversation.

### Generation settings used

The current pipeline uses your saved settings, including:

- `temperature`
- `max_response_length` (sent as `max_tokens`)
- `stop_strings`
- `top_p` (when enabled)
- Localhost-specific extras (when enabled): `top_k`, `repeat_penalty`, `min_p`

---

## Simple Guide

### 1) Start the app

From the `Nova/Code` folder, run:

```bash
python main.py
```

The app starts a local GUI server and opens the browser automatically.

### 2) Configure API Client (Settings)

1. Open **Settings**.
2. Choose provider:
	- `Localhost (LM Studio)` for local models
	- `OpenAI` for OpenAI API
3. Confirm/update:
	- API Base URL
	- Model
	- API Key (required for OpenAI)
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
4. The app generates a real model response and stores the conversation.

---

## Notes

- This project is still WIP, but the core end-to-end chat loop is now active in 1.0.0.
- Existing chats/settings are stored locally in project folders.
- If responses fail, check provider/base URL/model/API key first.

