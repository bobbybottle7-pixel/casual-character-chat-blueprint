// Minimal terminal formatting helpers. No dependencies on purpose —
// this whole project stays install-free, same as build/build-standalone.js
// in the parent repo.

const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

const codes = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function paint(code, text) {
  if (!supportsColor) return text;
  return `${codes[code]}${text}${codes.reset}`;
}

export const style = {
  bold: (t) => paint("bold", t),
  dim: (t) => paint("dim", t),
  heading: (t) => paint("cyan", paint("bold", t)),
  ok: (t) => paint("green", t),
  warn: (t) => paint("yellow", t),
  err: (t) => paint("red", t),
  teach: (t) => paint("magenta", t),
};

export function printBanner() {
  console.log(style.heading("\n  Agent CLI") + style.dim("  — plans, acts, teaches, suggests\n"));
}

export function printPlan(steps) {
  console.log(style.bold("Plan:"));
  steps.forEach((s, i) => {
    console.log(`  ${style.dim(`${i + 1}.`)} ${s.summary} ${style.dim(`[${s.skill}]`)}`);
  });
  console.log("");
}

export function printStepHeader(index, total, step) {
  console.log(style.bold(`[${index}/${total}] ${step.skill}`) + `  ${style.dim("—")}  ${step.summary}`);
}

export function printReasoning(text) {
  console.log(`  ${style.dim("↳ reasoning:")} ${text}`);
}

export function printTeaching(text) {
  const lines = text.split("\n").map((l) => `  ${style.teach("↳ why:")} ${l}`);
  console.log(lines.join("\n"));
}

export function printObservation(text) {
  const clipped = text.length > 500 ? text.slice(0, 500) + style.dim("… (truncated)") : text;
  console.log(`  ${style.dim("result:")} ${clipped}\n`);
}

export function printAnswer(text) {
  console.log(style.heading("\nAnswer:"));
  console.log(text + "\n");
}

export function printSuggestions(list) {
  if (!list.length) return;
  console.log(style.bold("Suggestions:"));
  list.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log("");
}

export function printError(text) {
  console.error(style.err(`Error: ${text}`));
}

export function printTutorial() {
  console.log(style.heading("Welcome to Agent CLI\n"));
  console.log(
    [
      "This is a small local agent, not a chatbot. When you give it a task it:",
      "  1. Writes a short numbered PLAN before doing anything.",
      "  2. Runs each step through a SKILL (calculator, file access, shell, notes).",
      "  3. Shows you the REASONING behind each step, so nothing happens silently.",
      "  4. Answers, then SUGGESTS 2-4 things you could do next.",
      "",
      "Run with --teach to also see a plain-language WHY for every step —",
      "useful if you're new to agent tools and want to understand the loop,",
      "not just the output.",
      "",
      "No API key? No problem — Agent CLI has a built-in offline planner so",
      "you can use it immediately. Set ANTHROPIC_API_KEY to switch to live",
      "model reasoning.",
      "",
      style.dim("(This message only shows once. Replay it any time with: agent --help-tutorial)"),
      "",
    ].join("\n")
  );
}
