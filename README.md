# 🌐 Translate by AI

AI-powered translation extension for GNOME Shell. Uses LLM APIs (Google Gemini, OpenAI, Groq, Ollama, etc.) for high-quality, context-aware translations.

## Features

- 🤖 **AI-Powered Translation** — Uses large language models for natural, context-aware translations
- 🔧 **Flexible Provider** — Works with any OpenAI-compatible API (OpenAI, Groq, Ollama, LM Studio) or Google Gemini
- 📝 **Customizable Prompts** — Full control over system prompt and user prompt templates
- 🌍 **Any Language** — Translate to/from any language supported by your chosen AI model
- ⌨️ **Keyboard Shortcut** — `<Super> + T` to toggle the translation menu (customizable)
- 📋 **Selectable Output** — Translation results can be selected and copied

## Installation

1. Copy the extension folder to `~/.local/share/gnome-shell/extensions/translate-by-ai@by-ai.net`
2. Compile the schema:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/translate-by-ai@by-ai.net/schemas
   ```
3. Restart GNOME Shell (log out and log back in on Wayland)
4. Enable the extension:
   ```bash
   gnome-extensions enable translate-by-ai@by-ai.net
   ```

## Configuration

Open Extension Settings → **LLM** tab:

| Setting | Description | Default |
|---------|-------------|---------|
| **API Key** | Your API key from the provider | — |
| **Base URL** | API endpoint URL | `https://generativelanguage.googleapis.com/v1beta/models` (Gemini) |
| **Model** | Model name | `gemini-2.0-flash` |
| **Target Language** | Default translation language | `Arabic` |
| **System Prompt** | AI personality/behavior instructions | Professional translator role |
| **User Prompt** | Template using `{text}` and `{target_lang}` | Translate to {target_lang} |

### Quick Setup with Google Gemini (Free)

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Paste the key in the **API Key** field
3. Done! The default settings are pre-configured for Gemini

### Using OpenAI / Groq / Ollama

Change the **Base URL** to your provider's endpoint:

| Provider | Base URL |
|----------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Ollama (local) | `http://localhost:11434/v1` |

## Usage

1. Press `<Super> + T` or click the icon in the panel
2. Type the text you want to translate
3. Press `Enter` to translate
4. The translation appears below — select and copy as needed

## Requirements

- GNOME Shell 46
- An API key from a supported LLM provider

## Author

**Mohamed Saad**

## License

GPL-3.0
