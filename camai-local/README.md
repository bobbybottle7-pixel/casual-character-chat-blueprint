# CamAI Local Web 1.2

A private AI chat that runs entirely in your phone's browser. No account, no API key, no cloud AI. The model runs on the phone's CPU (Transformers.js, WASM backend), so it works on devices whose WebGPU limits are too low for WebLLM (e.g. `requested=32768, limit=16384`).

## Use on Android (website, recommended)

Open **https://bobbybottle7-pixel.github.io/casual-character-chat-blueprint/camai-local/** in Chrome, then tap **⋮ → Add to Home screen** (or **Install app**). It then opens like a normal app with its own icon.

## Use on Android (from the ZIP)

1. Extract the ZIP.
2. Open `index.html` in Chrome.
3. Pick a model and tap **Load model**:
   - **Qwen 2.5 0.5B** (~510 MB download): better answers.
   - **SmolLM2 360M** (~365 MB download): faster and lighter. Use this one if the tab crashes or is too slow.
4. Wait for the first download. It only happens once, and later loads take seconds.
5. Chat. Tap **Stop** at any time to cut a reply short.

Your chat is saved in this browser. **New chat** clears it. **Free space** deletes the downloaded model files (your chat is kept).

## What changed in 1.2

- Fixed: each message was sent to the model twice.
- Fixed: download progress showed numbers like "4500%".
- Fixed: error messages were fed back to the model as if it had said them.
- The page no longer freezes while the model is replying. The model now runs in a background worker.
- New **Stop** button.
- Only recent messages are sent to the model, so replies stay fast in long chats.
- Smaller downloads: the q8 model files are ~510 MB instead of ~786 MB for Qwen. q8 is also the standard format for CPU.
- **Free space** button, and the browser is asked not to evict the cached model.
- Confirmations before deleting a chat, plus a remembered model choice and auto-growing input box.

## Honest limitations

- These are very small models. Expect simple, sometimes wrong answers, nowhere near cloud AI.
- CPU inference on a 4 GB phone is slow, and very long replies take a while.
- **Stop** reloads the model from the phone's storage, which takes a few seconds, because the CPU engine can't be paused mid-reply.
- The first download needs internet. The page also loads the Transformers.js library from a CDN each time it opens, so it needs a connection to start.
