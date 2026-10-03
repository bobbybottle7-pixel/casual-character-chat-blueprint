# CamAI for Android

A private AI chat app that runs AI models **directly on your phone**: no account, no API key, and nothing leaves the device. An optional **Cloud boost** lets you use big free cloud models when you want smarter answers.

It uses [llama.cpp](https://github.com/ggml-org/llama.cpp), the same engine behind most local-AI apps, with Arm-optimised code chosen automatically for your phone's processor.

## Install

1. On your phone, open the latest build: **Releases → "CamAI for Android (latest build)" → `CamAI.apk`**.
2. Open the downloaded file. If Android asks, allow installs from your browser ("Install unknown apps").
3. Open CamAI → **☰ menu → Models** → download **LFM 2.5 1.2B** (recommended, ~700 MB) → tap **Load**.
4. Start chatting.

New versions install over the old one; your chats and downloaded models are kept.

## Features

- **On-device models** sized for 4 GB phones, from tiny (219 MB) to Qwen 3.5 4B (experimental). You can also import any `.gguf` model file.
- **Multiple chats**, saved on the phone, which you can rename, share or delete.
- **Characters**: built-in personas plus your own (name, emoji, personality, scenario, first message).
- **Voice**: tap the mic to speak, tap the speaker icon to hear a reply, or turn on "Read replies aloud".
- **Thinking mode** for models that support it (Qwen 3.5), shown in a collapsible "💭 Thoughts" box.
- **Regenerate, edit and resend, copy**, plus formatted answers with copyable code blocks.
- **Speed test** (Settings → Find fastest setting) times your phone and picks the fastest number of CPU threads.
- **Cloud boost**: add a free [OpenRouter](https://openrouter.ai/keys) key, then tap the phone/cloud icon in any chat.
- **Diagnostics and crash reports**: if something goes wrong, Diagnostics → Copy gives everything needed to fix it.

## Performance tools (new in 2.1)

- **Smart Fit**: before loading, CamAI *simulates* the model's exact memory needs (without reading the weights) for several memory sizes, batch sizes and compression levels. It then loads the richest setup that fits your phone's free RAM. Every downloaded model shows a rating: *Fits well*, *Tight* or *Probably too big*.
- **Compressed memory**: stores the conversation memory in 8-bit, halving its RAM use. Settings → Compressed memory: Auto / Off / Always.
- **Smaller work batches**: for models with huge vocabularies (Qwen 3.5) this cuts scratch memory from 245 MB to 61 MB, at about 2% slower prompt reading (measured).
- **Instant Resume**: each chat's model state is saved to storage when you switch chats or leave the app. Coming back continues straight away instead of re-reading the whole conversation (measured: half the time on a short chat, and more on long ones).
- **Model Finder**: Models → *Find more models on Hugging Face* searches every public GGUF model, lists each file's size and quantization with a fit rating, and downloads it into CamAI.

## Speed tricks under the hood

- **Context reuse with checkpoints**: the model doesn't re-read the whole chat each turn. It keeps its memory between messages and saves a checkpoint at the end of each of your messages. That covers models like Qwen 3.5 and LFM 2.5 too, whose memory can't simply be rewound. Regenerate is near-instant.
- **Runtime CPU selection**: one build contains code for several Arm generations, and the best one for your chip loads at startup.
- **Q4_0 models**, which llama.cpp repacks into Arm-optimised layouts as they load.
- **Memory-mapped loading**: model weights are read straight from storage instead of being copied into RAM.

## Honest limits

- A 4 GB phone can realistically run models up to about 2–3B parameters. Bigger models won't fit in memory.
- Small models make mistakes. Use Cloud boost for hard questions.
- Expect roughly 3–15 words per second depending on the phone and model.

## Building it yourself

GitHub Actions builds the APK on every push that touches `camai-android/` (see `.github/workflows/camai-android.yml`) and publishes it to the `camai-latest` release.

Local build: Android SDK with NDK `29.0.13113456` and CMake `3.31.6`, then:

```bash
git submodule update --init --depth 1
cd camai-android
./gradlew :app:assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

`llama.cpp` is a git submodule pinned to release `v0.5.0`. The signing key in `app/camai.keystore` is committed on purpose so that every build can update the previous one; it identifies "the same app", not a trusted publisher.
