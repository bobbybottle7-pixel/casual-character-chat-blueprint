# CamAI Local Web 1.1

This build fixes the WebGPU failure seen on the Nubia/Chromium screenshot.

The previous build used WebLLM, which requested `maxComputeWorkgroupStorageSize = 32768`, while the browser reported a device limit of `16384`. WebGPU cannot satisfy that request on this device.

CamAI 1.1 therefore uses Hugging Face Transformers.js with the WASM/CPU backend. Transformers.js documents WASM as the broad compatibility fallback and supports quantized Q4 models in the browser.

## Use on Android

1. Extract the ZIP.
2. Open `index.html` in Chrome/Chromium.
3. Tap **Load local model**.
4. Choose Qwen 2.5 0.5B first. It is the stronger of the two included choices, but it is still a small model.
5. Wait for the first model download. It may take several minutes.
6. Send a message.

The model is downloaded from Hugging Face on first load. Inference is performed by the browser's CPU/WASM runtime. No AI API key or account is used.

## Why this build does not use WebGPU

The supplied screenshot shows:
`requested=32768, limit=16384`.

That is a runtime capability mismatch, not a bad API key or missing model. WebGPU is intentionally bypassed here.

## Honest limitations

- CPU inference on a 4 GB phone can be slow.
- The models are small and will not match frontier cloud models.
- Internet is needed for the first model download unless model files are later bundled locally.
- The browser still provides the runtime, so this is not yet a native APK.
