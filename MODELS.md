# Model Guide

Every model below runs through [OpenRouter](https://openrouter.ai). The list was checked against OpenRouter's live model catalog in October 2026. Free models come and go, so if one stops answering, switch to **Openrouter: Free**, which always routes to whatever free model is up.

## The one-time setup (free, no card)

1. Make an account at [openrouter.ai](https://openrouter.ai). No payment details needed.
2. Go to **Keys** → **Create Key** and copy it.
3. In the app: **⚙️ Global App Settings** → paste the key → save.

The free models have a daily message cap per account. It's enough for normal chatting; check OpenRouter's docs for the current number.

## A straight answer on "uncensored"

None of the free models are uncensored fine-tunes. They're mainstream open models with their normal safety training. They still handle dark themes, violence, horror and mature roleplay much better than ChatGPT-style apps, especially with the app's built-in roleplay instructions. Every free model's instructions already tell it to describe dark scenes authentically. What you'll still run into: refusals on the most explicit stuff, and some models breaking character to add a warning.

The truly uncensored roleplay models on OpenRouter all cost money (see the last table). They're cheap, but not free.

## Free models (in the app)

| Model | Context | What it is | Pros | Cons |
|---|---|---|---|---|
| **Openrouter: Free** (default) | 200K | Picks a random working free model for each message | Never breaks when a free model is pulled; zero thinking required | Writing style changes from message to message; you don't control which model answers |
| **NVIDIA: Nemotron 3 Ultra** | 1M | 550B mixture-of-experts reasoning model, NVIDIA's biggest | Smartest free option; follows long character cards and plot details well | Slower; reasoning-tuned, so prose can feel dry; enterprise-style safety training |
| **Thinking Machines: Inkling** | 1M | 975B multimodal mixture-of-experts | Huge model, strong general writing and memory over long chats | New, so roleplay behavior is less proven; can be slow at busy times |
| **NVIDIA: Nemotron 3 Super** | 262K | 120B MoE, 12B active | Good balance of smart and fast | Same corporate-leaning tone as Ultra |
| **Thinking Machines: Inkling Small** | 1M | Smaller Inkling (12B active of 276B) | Faster than full Inkling, still capable; huge context | Less depth and creativity than the big one |
| **Dots Studio: Dots3-Note Preview** | 512K | 280B MoE, open weights, preview build | Fresh model, big context, often less preachy than big-lab models | "Preview" means it can change or vanish; quality is less predictable |
| **Qwen: Qwen3.8 27B** | 262K | Alibaba's dense 27B model | Reliable, sharp at following instructions; Qwen models are usually fairly permissive with fiction | Mid-size, so prose is sometimes generic; can slip into a "helpful assistant" voice |
| **Google: Gemma 4 31B** | 262K | Google's open 31B model | Natural, readable prose; good at staying in character | Google safety training means more refusals on explicit content than the others |
| **Google: Gemma 4 26B A4B** | 262K | Lighter, faster Gemma 4 | Quick replies, near-31B quality | Same Google filtering; slightly weaker on complex scenes |
| **NVIDIA: Nemotron 3.5 Lightning** | 1M | Small fast MoE (3B active) | Fastest replies on the list | Smallest brain here: forgets details and writes simpler |

**My picks:** start with **Nemotron 3 Ultra** or **Inkling** for quality, **Qwen3.8 27B** when one of them refuses something, and **Openrouter: Free** when everything else is rate-limited.

Left out on purpose: free models built for medicine, coding, research agents, content moderation or music, since they're bad at chat.

## Paid models already in the app

These were in the app before and still are. They need credits on your OpenRouter account and give an error without them.

| Model | Cost | Notes |
|---|---|---|
| Mistral: Mistral Nemo | ~$0.00005/msg | Lightly filtered, decent roleplay for almost nothing |
| Sao10K: Llama 3 8B Lunaris | ~$0.00009/msg | Roleplay fine-tune, uncensored-leaning, small |
| DeepSeek V4 Flash | ~$0.00009/msg | Smart and cheap, fairly permissive |
| Qwen3.7 Flash | ~$0.00016/msg | Fast all-rounder |
| Gemma 4 31B (paid) | ~$0.00043/msg | Same as the free one, without the daily cap |
| GLM 4.7 Flash | ~$0.00046/msg | Good creative writing |

## Actually uncensored models (paid, not in the app)

If you ever drop a few dollars on OpenRouter, these are built specifically to have no content filter. Add any of them in **Global App Settings** → **Add Model** using the ID.

| Model ID | Price per 1M tokens (in/out) | Pros | Cons |
|---|---|---|---|
| `cognitivecomputations/dolphin-mistral-24b-venice-edition` | $0.20 / $0.90 | Made to be uncensored; follows instructions well | Plain writing style |
| `thedrummer/cydonia-24b-v4.1` | $0.30 / $0.50 | Uncensored creative-writing fine-tune; good memory | 24B, not the deepest thinker |
| `thedrummer/unslopnemo-12b` | $0.40 / $0.40 | Adventure and roleplay focused, avoids clichéd "AI prose" | Small model |
| `sao10k/l3.3-euryale-70b` | $0.65 / $0.75 | Community favorite for roleplay, rich descriptions | Pricier per message |
| `nousresearch/hermes-4-405b` | $1.00 / $3.00 | Huge, smart, very lightly filtered | Most expensive here |
| `gryphe/mythomax-l2-13b` | $0.08 / $0.11 | Classic roleplay model, dirt cheap | Old, with an 8K context, so it forgets quickly |

A typical chat message is roughly 2–4K tokens, so even the pricey ones are fractions of a cent per message.
