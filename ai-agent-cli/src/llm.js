import { SKILLS, describeSkills } from "./skills/index.js";
import { evaluate, looksLikeMath } from "./skills/calculator.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.AGENT_MODEL || "claude-sonnet-5";

export function isOnline() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function callAnthropic(system, userText) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).map((c) => c.text || "").join("");
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return JSON");
  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------------
// PLAN
// ---------------------------------------------------------------------

const PLAN_SYSTEM = `You are the planning module of a terminal AI agent.
Given a user's task, produce a short ordered plan as JSON only, no prose:

{"steps": [{"skill": "<one of: ${SKILLS.map((s) => s.name).join(", ")}, reason>", "input": "<what to pass the skill, or the sub-question to reason about>", "summary": "<5-8 word step title>", "reasoning": "<one sentence: why this step>", "teaching": "<1-2 plain-language sentences for a beginner: why this step matters>"}]}

Available skills:
${describeSkills()}
- reason: pure thinking, no tool — use for anything the other skills can't do.

Chaining: a step's "input" may contain {{prev}} (the previous step's output)
or {{N}} (step N's output, 1-indexed). The agent substitutes the real text
before running the step. Use this whenever a step needs an earlier result —
e.g. fetch a page in step 1, then step 2 input "write to out.txt with
content {{prev}}".

Keep plans to 1-4 steps. Prefer the fewest steps that actually solve the task.`;

async function planOnline(task) {
  const raw = await callAnthropic(PLAN_SYSTEM, task);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed.steps) || !parsed.steps.length) {
    throw new Error("Empty plan returned by model");
  }
  return parsed.steps;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Only explicit sequencing words split a task. "and" alone is too greedy —
// it would tear "list files and directories" into two bogus steps.
const CHAIN_SPLIT = /\s*(?:,\s*)?\b(?:and\s+then|then)\b\s+/i;
const BACKREF = /\b(it|that|this|them|the result|the output|the contents?)\b/i;

// Rewrites a back-referring clause into the canonical form its skill
// already parses, with {{prev}} standing in for the earlier step's output.
function canonicalizeChained(clause) {
  const write = clause.match(/\b(?:write|save|store)\b.*?\bto\b\s+(\S+)/i);
  if (write && BACKREF.test(clause)) {
    return { skill: "fileOps", input: `write to ${write[1].replace(/[.,;:]+$/, "")} with content {{prev}}` };
  }

  const remember = clause.match(/\bremember\b.*?\bas\b\s+(?:the\s+)?([\w -]+)/i);
  if (remember && BACKREF.test(clause)) {
    return { skill: "notes", input: `remember ${remember[1].trim()} = {{prev}}` };
  }

  return null;
}

function chainedStep(clause, canon) {
  return {
    skill: canon.skill,
    input: canon.input,
    summary: `Pass the previous result to ${canon.skill}`,
    reasoning: `"${clause}" refers back to the previous step, so it consumes that step's output.`,
    teaching:
      "This step's input contains {{prev}}, which the agent replaces with what the previous step actually produced before running it. That substitution is the difference between a real chain and a list of unrelated commands run back to back.",
  };
}

function planOffline(task) {
  // Deterministic, rule-based planner. It exercises the exact same
  // control flow and skills the online planner would pick — see
  // DESIGN.md §3.3 for why this exists and what it guarantees.
  const trimmed = task.trim();

  const clauses = trimmed.split(CHAIN_SPLIT).map((c) => c.trim()).filter(Boolean);
  if (clauses.length > 1) {
    return clauses.map((clause, i) => {
      const canon = i > 0 ? canonicalizeChained(clause) : null;
      return canon ? chainedStep(clause, canon) : planClause(clause);
    });
  }

  return [planClause(trimmed)];
}

function planClause(trimmed) {
  if (looksLikeMath(trimmed)) {
    return {
      skill: "calculator",
      input: trimmed,
      summary: "Evaluate the expression",
      reasoning: "The task is a self-contained arithmetic expression.",
      teaching:
        "Agent CLI never guesses at arithmetic — it hands numeric work to a dedicated calculator skill so the result is exact, not a language model's best guess.",
    };
  }

  const matched = SKILLS.find((s) => {
    try {
      return s.match(trimmed);
    } catch {
      return false;
    }
  });

  if (matched) {
    return {
      skill: matched.name,
      input: trimmed,
      summary: `Use ${matched.name} to handle the request`,
      reasoning: `The task's wording matches what the "${matched.name}" skill is built for.`,
      teaching: `I picked "${matched.name}" because it ${lowerFirst(matched.description).replace(/\.$/, "")} — matching the verbs in your request to the right tool is most of what planning means.`,
    };
  }

  return {
    skill: "reason",
    input: trimmed,
    summary: "Think through the task directly",
    reasoning: "No specific skill matched, so this is answered by reasoning alone.",
    teaching:
      "Not every task needs a tool. When nothing in the skill list fits, the agent answers directly instead of forcing a tool call — using a tool just because one exists is a common beginner mistake to avoid.",
  };
}

export async function planTask(task) {
  if (isOnline()) {
    try {
      return await planOnline(task);
    } catch (err) {
      // Never hard-fail a task just because the network/API hiccuped —
      // degrade to the offline planner and say so.
      return planOffline(task).map((s) => ({
        ...s,
        reasoning: `${s.reasoning} (offline fallback: ${err.message})`,
      }));
    }
  }
  return planOffline(task);
}

// ---------------------------------------------------------------------
// REASON step (no skill — the model/offline logic answers directly)
// ---------------------------------------------------------------------

export async function reasonAbout(question, context) {
  if (isOnline()) {
    try {
      const contextBlock = context?.length
        ? `Recent conversation:\n${context.map((c) => `Q: ${c.task}\nA: ${c.answer}`).join("\n")}\n\n`
        : "";
      return await callAnthropic(
        "You are a direct, expert assistant. Answer clearly and concisely. No hedging, no disclaimers unless safety-critical.",
        `${contextBlock}${question}`
      );
    } catch (err) {
      return offlineReason(question, err);
    }
  }
  return offlineReason(question);
}

function offlineReason(question, err) {
  const prefix = err ? `[offline fallback — ${err.message}]\n` : "";
  return (
    `${prefix}I don't have a live model connected right now (no ANTHROPIC_API_KEY set), ` +
    `so I can't reason freely about "${question}". Set ANTHROPIC_API_KEY to enable full ` +
    `reasoning, or rephrase this as something one of my skills can do directly: ` +
    `arithmetic, file read/write/list, a shell command, or remembering/recalling a note.`
  );
}

// ---------------------------------------------------------------------
// ANSWER + SUGGESTIONS
// ---------------------------------------------------------------------

export async function composeAnswer(task, observations) {
  const summary = observations.map((o) => `- ${o.skill}: ${o.output}`).join("\n");
  if (isOnline()) {
    try {
      return await callAnthropic(
        "You are the response module of a terminal agent. Given the task and what each step produced, write a short, direct final answer for the user. No filler.",
        `Task: ${task}\n\nStep results:\n${summary}`
      );
    } catch {
      // fall through to offline composition
    }
  }
  if (observations.length === 1) return observations[0].output;
  return summary;
}

export async function composeSuggestions(task, answer, opts = {}) {
  if (isOnline()) {
    try {
      const raw = await callAnthropic(
        'Given a completed task and its answer, propose 2-4 short, concrete, imperative follow-up actions the user could run next. Return JSON only: {"suggestions": ["...", "..."]}',
        `Task: ${task}\nAnswer: ${answer}`
      );
      const parsed = extractJson(raw);
      if (Array.isArray(parsed.suggestions) && parsed.suggestions.length) return parsed.suggestions;
    } catch {
      // fall through
    }
  }
  return offlineSuggestions(task, opts);
}

function offlineSuggestions(task, opts = {}) {
  const suggestions = [];
  if (/\.(js|py|ts|json|md|txt)\b/i.test(task)) {
    suggestions.push('Try: agent "list files in ." to see what else is here');
  }
  if (looksLikeMath(task)) {
    suggestions.push('Chain it: agent "remember result is <the number>" to reuse it later');
  }
  if (!opts.teach) {
    suggestions.push("Run with --teach to see the plain-language reasoning behind each step");
  }
  suggestions.push('Ask "what can you do?" to see the full skill list');
  suggestions.push("Start a session: run `agent` with no arguments to keep notes between tasks");
  return suggestions.slice(0, 4);
}

export { evaluate };
