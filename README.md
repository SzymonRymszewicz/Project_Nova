# BlueNovaAI Project (WIP)

![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey?logo=windows)
![License](https://img.shields.io/badge/License-GPL%20v3-green)
![Version](https://img.shields.io/badge/Version-1.0.0-orange)

**BlueNovaAI** is a local-first AI chat workspace that puts you in full control — define custom bots with personalities, compose rich prompt pipelines, manage conversation history with edit/regenerate/continue actions, and keep everything running on your own machine without any cloud dependency.

It runs as a Python desktop-like app with a built-in local web UI server.

## Highlights

- Local-first architecture with OpenAI-compatible API support (localhost and OpenAI-style providers)
- Bot and persona management with reusable definitions and media
- Modular prompt pipeline with ordered prompt sections and module extensions
- Chat actions: regenerate, continue, edit, delete, and assistant variant navigation
- Dataset injection system for static and dynamic context entries
- Streaming chat UX with controlled speed options
- Debug logging for generation pipeline and action flow analysis

## Why BlueNovaAI?

Most AI chat frontends are thin wrappers around a single API call. BlueNovaAI takes a different approach:

- **Bots are first-class objects** — each bot owns its personality, scenario rules, prompt module stack, and datasets independently.
- **Prompt pipeline is composable** — sections like `conduct`, `scenario`, `core`, `iam`, and dynamically loaded modules combine in a defined order, giving you full visibility and control over what reaches the model.
- **Chat actions are non-destructive** — regenerate and continue produce variant history so you can navigate between different AI responses without losing previous ones.
- **Everything stays local** — no telemetry, no account, no cloud storage. Your bots, chats, and personas live as plain files on your disk.
- **Modular by design** — drop a new module into `Modules/` and it integrates into the pipeline automatically.

## Tech Stack

- Python 3.x
- Built-in HTTP server (`http.server`)
- Vanilla HTML/CSS/JavaScript frontend
- File-based storage for bots, chats, personas, datasets, and settings

## Project Structure

```
BlueNovaAI/
	Code/         # Application backend and managers
	Website/      # Frontend (main.html, JS, CSS)
	Bots/         # Bot definitions and chat folders
	Personas/     # Persona definitions and assets
	Modules/      # Prompt/runtime modules
	Datasets/     # Dataset context assets
	Debug/        # Debug session logs
	run.bat       # Windows launcher
	settings.txt  # Runtime settings
```

## Getting Started (Windows)

1. Install Python 3.10+ and ensure it is available in PATH (`py -3` or `python`).
2. Open this folder in your terminal.
3. Start the app:

```bat
run.bat
```

`run.bat` auto-detects `py`/`python` and launches `Code/main.py`.

## Manual Run

```bat
py -3 Code\main.py
```

or

```bat
python Code\main.py
```

## Troubleshooting

- App does not start:
	- Verify Python is installed and available in PATH.
	- Run `py -3 --version` or `python --version`.
- API errors:
	- Check provider, base URL, API key, and model in Settings.
- Slow or unstable generation:
	- Lower `max_context_messages` and `max_response_length`.
	- Review newest debug file in `Debug/`.


