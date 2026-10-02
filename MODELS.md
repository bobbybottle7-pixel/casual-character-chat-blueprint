# Model Guide

Every model in the app is an **uncensored** model, and all of them are **free**. No account, no API key, no payment.

They run on the [AI Horde](https://aihorde.net), a free network where volunteers share their computers to run community AI models. The app sends your message into the Horde's queue, and a volunteer's machine writes the reply. While you wait, a small bar above the message box shows your place in the queue.

Everything below was checked live on **October 2, 2026**. Every model here replied in character through the app, and the times are what those test messages took. The Horde is run by volunteers, so which models are online and how fast they answer changes hour to hour.

## How it behaves

- **No setup.** Open the app, pick a character, chat.
- **Replies take about 10–60 seconds**, sometimes longer when the queue is busy. They arrive all at once instead of word by word.
- **If your model is offline,** the app automatically answers with another uncensored model and tells you which one stood in.
- **Stopping a reply** cancels it on the Horde too, so it doesn't waste a volunteer's time.
- **Want shorter waits?** Make a free account at [aihorde.net/register](https://aihorde.net/register) and paste the key into **⚙️ Global App Settings → AI Horde API Key**. Registered users get priority over anonymous ones. Still free.

## The models

| Model | Size | Speed in testing | Pros | Cons |
|---|---|---|---|---|
| **Any Uncensored Model (fastest)** (default) | varies | 8–11s | Always picks whichever uncensored models have the most free volunteers right now, so it's the quickest and most reliable | You don't choose the model, so the writing style can change between messages |
| **Behemoth-X 123B** (TheDrummer) | 123B | 28–48s | The biggest and smartest here. Best at long scenes, staying in character and remembering details | The slowest: few volunteers can run a model this size |
| **Skyfall 31B** (TheDrummer) | 31B | 9–15s | The workhorse: the most volunteers, so it's fast and almost always online. Strong, lively writing | Less depth than Behemoth on complicated plots |
| **Magidonia 24B** (TheDrummer) | 24B | ~17s | Witty, vivid, great banter and character voice | Likes to write long and can get cut off at the length limit (use Continue) |
| **Rocinante X 12B** (TheDrummer) | 12B | ~25s | Creative and unpredictable, good for adventure | Smaller brain; sometimes writes actions in *asterisks* despite the app's style rules |
| **Mini Magnum 12B** (Anthracite) | 12B | ~16s | Polished, natural prose for its size | Shorter, simpler replies; forgets details in long chats |
| **Stheno 8B** (Sao10K) | 8B | ~41s | A classic uncensored roleplay model. Many volunteers run copies, so it's nearly always online | Small: plainer writing and weaker memory |
| **Gemma 4 31B Heretic** | 31B | ~115s | Google's Gemma 4 with its refusals stripped out ("heretic" = de-censored). Smart and coherent | Slow on the Horde right now, and the prose feels a bit corporate |
| **Gemma 4 E4B Uncensored** | ~4B | ~40s | De-censored small Gemma 4. Decent for its size | Small model limits: simple writing, short memory |
| **Impish Llama 4B** (SicariusSicariiStuff) | 4B | ~12s | Tiny, fast, and built to be uncensored | The weakest writer on the list |

**Picks:** stay on **Any Uncensored Model** for speed. Switch to **Behemoth-X 123B** when you want the best writing and don't mind waiting, or **Skyfall 31B** for the best mix of quality and speed.

## Adding more Horde models

The full live list is at [aihorde.net](https://aihorde.net) (or [lite.koboldai.net](https://lite.koboldai.net)). To add one, open **⚙️ Global App Settings → + Add new Model**, give it any name, and set the ID to `horde:` followed by part of the model's name, for example `horde:cydonia`. Join words with `+` when one isn't enough: `horde:gemma-4-31b+heretic`. Matching by name keeps the entry working when volunteers upgrade to a newer version of the same model.

## Privacy

Your characters and chats are saved only in your browser. But to write a reply, the conversation is sent through the AI Horde to a volunteer's computer. The Horde doesn't know who you are when you use it without a key, but a volunteer could, in theory, log what their machine generates. **Don't put real names, addresses or other personal details in your chats.**

## Optional: paid uncensored models

You never need these. They answer faster and with stronger writing, for a fraction of a cent per message, if you ever put a few dollars on [OpenRouter](https://openrouter.ai). Add your key under **⚙️ Global App Settings → OpenRouter API Key**, then add the model with **+ Add new Model** using the ID below.

| Model ID | Notes |
|---|---|
| `thedrummer/cydonia-24b-v4.1` | Uncensored creative-writing model, $0.30/$0.50 per 1M tokens |
| `sao10k/l3.3-euryale-70b` | Roleplay favorite with rich descriptions, $0.65/$0.75 |
| `cognitivecomputations/dolphin-mistral-24b-venice-edition` | Built to be uncensored, $0.20/$0.90 |
| `nousresearch/hermes-4-405b` | Huge and very lightly filtered, $1/$3 |
