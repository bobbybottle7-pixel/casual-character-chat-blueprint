# Qwen Local Chat

A private AI chat app that runs **Qwen** entirely in your browser. There's no API key, account or server, and nothing to install.

## Use it

1. Open `qwen-chat/index.html` in **Chrome, Edge or Brave** on desktop, or Chrome on Android.
2. That's it. The default model (Qwen3 1.7B, about 1 GB) downloads automatically the first time and is cached, so later visits start in seconds and work offline.
3. Type and press **Enter**. You can send a message while the model is still loading; it answers as soon as the model is ready.

The browser needs **WebGPU**, which is on by default in current Chrome/Edge/Brave. If it's missing, the app tells you.

## Features

- **Qwen3, Qwen3.5 and Qwen2.5** models from 0.6B to 9B, switchable in Settings. The app picks fp16 or fp32 builds automatically based on your GPU.
- **Streaming replies** with a live typing cursor and a stop button.
- **Thinking mode** (Qwen3/3.5): the model reasons first. You can expand its reasoning in a panel above the answer.
- **Fully editable system prompt**, with presets: Unfiltered, Helpful, Coder, Storyteller and Roleplay. No extra content filter is added on top of the model. What you write is sent as-is.
- **Markdown and syntax-highlighted code**, with one-click copy buttons.
- **Multiple chats** with auto titles, search, rename, delete, and Today/7-day grouping.
- **Edit and resend** your messages, **regenerate** replies, and copy any message.
- Temperature, top-p and max reply length sliders.
- Export a chat as Markdown, export or import all chats as JSON, and clear the downloaded model cache.
- Light and dark theme, mobile layout, and a tokens-per-second readout.

## Privacy

Chats and settings are stored in your browser's localStorage. The model runs on your own GPU, so the only network traffic is the one-time download of the model files from Hugging Face and the page libraries from public CDNs.

## Notes

- "Unfiltered" means the app itself doesn't censor anything. The Qwen models still have their own training and may occasionally refuse.
- Bigger models are smarter but need more VRAM. If a model fails to load, pick a smaller one in Settings.
- The models have a 4k-token context window. Long chats are trimmed to the most recent messages automatically.
