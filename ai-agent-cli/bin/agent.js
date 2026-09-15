#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadSession, saveSession } from "../src/memory.js";
import { runTask } from "../src/agent.js";
import { isOnline } from "../src/llm.js";
import * as ui from "../src/ui.js";
import { describeSkills } from "../src/skills/index.js";

function parseArgs(argv) {
  const args = { teach: false, yes: false, help: false, helpTutorial: false, taskParts: [] };
  for (const arg of argv) {
    if (arg === "--teach") args.teach = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--help-tutorial") args.helpTutorial = true;
    else args.taskParts.push(arg);
  }
  args.task = args.taskParts.join(" ").trim();
  return args;
}

function printUsage() {
  console.log(
    [
      "Usage:",
      '  agent "your task"        Run one task and exit',
      "  agent                     Start an interactive session (REPL)",
      "",
      "Flags:",
      "  --teach                   Show plain-language reasoning for every step",
      "  --yes, -y                 Auto-confirm skill actions that would otherwise ask",
      "  --help-tutorial           Show the first-run walkthrough again",
      "  --help, -h                Show this message",
      "",
      "Environment:",
      "  ANTHROPIC_API_KEY         If set, the agent plans/reasons with a live model.",
      "                             Otherwise it uses a deterministic offline planner.",
      "  AGENT_MODEL                Model id to use when ANTHROPIC_API_KEY is set.",
      "",
      "Skills:",
      describeSkills()
        .split("\n")
        .map((l) => "  " + l)
        .join("\n"),
    ].join("\n")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const session = loadSession(cwd);

  if (args.help) {
    printUsage();
    return;
  }

  if (args.helpTutorial) {
    ui.printTutorial();
    return;
  }

  if (!session.tutorialSeen) {
    ui.printTutorial();
    session.tutorialSeen = true;
    saveSession(session, cwd);
  }

  ui.printBanner();
  if (!isOnline()) {
    console.log(ui.style.dim("  (offline mode — no ANTHROPIC_API_KEY set; using the built-in planner)\n"));
  }

  // A single shared async-iterator over stdin's lines, used for BOTH the
  // REPL prompt and the confirm() gate. Node's readline.question() closes
  // its interface after the first read pass on a piped (non-TTY) stdin,
  // so calling question() repeatedly in a loop silently drops every line
  // after the first once input isn't an interactive terminal. Pulling
  // from one shared iterator avoids that — see test/run.js and DESIGN.md.
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (question) => {
    stdout.write(question);
    const { value, done } = await lines.next();
    return done ? null : value.trim();
  };
  const confirm = async (question) => {
    const answer = await prompt(question);
    return answer !== null && /^y(es)?$/i.test(answer);
  };
  const baseCtx = { session, cwd, teach: args.teach, autoYes: args.yes, confirm };

  try {
    if (args.task) {
      await runTask(args.task, baseCtx);
      saveSession(session, cwd);
      rl.close();
      return;
    }

    // REPL mode
    console.log(ui.style.dim('Interactive mode. Type a task, or "exit" to quit.\n'));
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const line = await prompt(ui.style.bold("> "));
      if (line === null) break; // stdin closed (EOF / Ctrl+D)
      if (!line) continue;
      if (/^(exit|quit)$/i.test(line)) break;
      try {
        await runTask(line, baseCtx);
        saveSession(session, cwd);
      } catch (err) {
        ui.printError(err.message);
      }
    }
    rl.close();
  } catch (err) {
    ui.printError(err.message);
    rl.close();
    process.exitCode = 1;
  }
}

main();
