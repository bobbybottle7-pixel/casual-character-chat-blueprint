import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { evaluate, looksLikeMath } from "../src/skills/calculator.js";
import fileOps from "../src/skills/fileOps.js";
import notes from "../src/skills/notes.js";
import shell from "../src/skills/shell.js";
import { matchSkill, findSkill, SKILLS } from "../src/skills/index.js";
import { planTask, composeAnswer, composeSuggestions, isOnline } from "../src/llm.js";
import { runTask } from "../src/agent.js";
import { loadSession } from "../src/memory.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-cli-test-"));
}

// ---------------------------------------------------------------------
// calculator
// ---------------------------------------------------------------------

test("calculator: basic precedence and parens", () => {
  assert.equal(evaluate("2 + 3 * 4"), 14);
  assert.equal(evaluate("(2 + 3) * 4"), 20);
  assert.equal(evaluate("2 ^ 10"), 1024);
  assert.equal(evaluate("-5 + 2"), -3);
  assert.equal(evaluate("10 % 3"), 1);
});

test("calculator: division by zero throws", () => {
  assert.throws(() => evaluate("1 / 0"));
});

test("calculator: rejects garbage input instead of running it", () => {
  assert.throws(() => evaluate("alert(1)"));
});

test("looksLikeMath distinguishes expressions from prose", () => {
  assert.equal(looksLikeMath("12 * (4 + 3)"), true);
  assert.equal(looksLikeMath("list files in ."), false);
});

test("calculator skill run() extracts and evaluates the expression", async () => {
  const result = await calculatorRun("what is 6 * 7");
  assert.match(result.output, /42/);
});

async function calculatorRun(input) {
  const calculator = findSkill("calculator");
  return calculator.run(input, {});
}

// ---------------------------------------------------------------------
// fileOps
// ---------------------------------------------------------------------

test("fileOps: write then read a file scoped to cwd", async () => {
  const cwd = tmpDir();
  const writeResult = await fileOps.run('write to notes.txt with content "hello agent"', { cwd });
  assert.equal(writeResult.ok, true);
  assert.ok(fs.existsSync(path.join(cwd, "notes.txt")));

  const readResult = await fileOps.run("read notes.txt", { cwd });
  assert.equal(readResult.ok, true);
  assert.equal(readResult.output, "hello agent");
});

test("fileOps: list directory", async () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, "a.txt"), "x");
  fs.writeFileSync(path.join(cwd, "b.txt"), "y");
  const result = await fileOps.run("list files in .", { cwd });
  assert.match(result.output, /a\.txt/);
  assert.match(result.output, /b\.txt/);
});

test("fileOps: refuses to escape the working directory", async () => {
  const cwd = tmpDir();
  await assert.rejects(() => fileOps.run("read ../../etc/passwd", { cwd }));
});

test("fileOps: write requires confirmation, read does not", () => {
  assert.equal(fileOps.needsConfirmation("write to x.txt with content y"), true);
  assert.equal(fileOps.needsConfirmation("read x.txt"), false);
});

// ---------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------

test("notes: remember then recall within a session", async () => {
  const session = { notes: {} };
  const rememberResult = await notes.run("remember favorite color = blue", { session });
  assert.equal(rememberResult.ok, true);
  const recallResult = await notes.run("recall favorite color", { session });
  assert.match(recallResult.output, /blue/);
});

test("notes: recalling an unknown key fails clearly", async () => {
  const session = { notes: {} };
  const result = await notes.run("recall something never set", { session });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------

test("shell: always needs confirmation", () => {
  assert.equal(shell.needsConfirmation(), true);
});

test("shell: flags destructive-looking commands", () => {
  assert.equal(shell.isDestructive("run `rm -rf /tmp/x`"), true);
  assert.equal(shell.isDestructive("run `echo hello`"), false);
});

test("shell: runs a harmless command and captures output", async () => {
  const cwd = tmpDir();
  const result = await shell.run("run `echo hello-from-agent-cli`", { cwd });
  assert.equal(result.ok, true);
  assert.match(result.output, /hello-from-agent-cli/);
});

// ---------------------------------------------------------------------
// skill registry / offline planner
// ---------------------------------------------------------------------

test("skill registry matches tasks to the right skill", () => {
  assert.equal(matchSkill("12 * 4").name, "calculator");
  assert.equal(matchSkill("list files in .").name, "fileOps");
  assert.equal(matchSkill("remember x = 1").name, "notes");
});

test("offline planner (no API key) produces a usable plan", async () => {
  assert.equal(isOnline(), false, "test must run without ANTHROPIC_API_KEY set");
  const steps = await planTask("12 * (4 + 3)");
  assert.ok(steps.length >= 1);
  assert.equal(steps[0].skill, "calculator");
  assert.ok(steps[0].teaching && steps[0].teaching.length > 0);
});

test("offline planner falls back to 'reason' for unmatched tasks", async () => {
  const steps = await planTask("tell me a story about the ocean");
  assert.equal(steps[0].skill, "reason");
});

test("composeAnswer/composeSuggestions never return empty offline", async () => {
  const answer = await composeAnswer("12 * 4", [{ skill: "calculator", output: "12 * 4 = 48" }]);
  assert.ok(answer.length > 0);
  const suggestions = await composeSuggestions("12 * 4", answer);
  assert.ok(suggestions.length >= 1);
});

// ---------------------------------------------------------------------
// end-to-end agent loop
// ---------------------------------------------------------------------

test("teaching lines read as grammatical sentences", async () => {
  const steps = await planTask("list files in .");
  assert.match(steps[0].teaching, /because it reads, lists, or writes files/);
  assert.doesNotMatch(steps[0].teaching, /\.\s+—/, "no stray period before the em-dash");
});

test("suggestions drop the --teach tip when teach mode is already on", async () => {
  const withoutTeach = await composeSuggestions("12 * 4", "48", { teach: false });
  const withTeach = await composeSuggestions("12 * 4", "48", { teach: true });
  assert.ok(withoutTeach.some((s) => s.includes("--teach")));
  assert.ok(!withTeach.some((s) => s.includes("--teach")));
  // DESIGN.md §6 promises 2-4 suggestions, never an empty or thin list.
  for (const list of [withoutTeach, withTeach]) {
    assert.ok(list.length >= 2 && list.length <= 4, `expected 2-4 suggestions, got ${list.length}`);
  }
});

test("agent.runTask: full loop end-to-end for a math task", async () => {
  const cwd = tmpDir();
  const session = loadSession(cwd);
  const result = await runTask("what is 7 * 6", {
    session,
    cwd,
    teach: false,
    autoYes: true,
    confirm: async () => true,
  });
  assert.match(result.answer, /42/);
  assert.ok(result.suggestions.length >= 1);
  assert.equal(session.history.length, 1);
});

test("agent.runTask: confirmation gate blocks unconfirmed writes", async () => {
  const cwd = tmpDir();
  const session = loadSession(cwd);
  const result = await runTask('write to out.txt with content "should not be written"', {
    session,
    cwd,
    teach: false,
    autoYes: false,
    confirm: async () => false, // simulate the user declining
  });
  assert.equal(fs.existsSync(path.join(cwd, "out.txt")), false);
  assert.match(result.observations[0].output, /Skipped/);
});

test("agent.runTask: a declined confirmation does not trigger a re-plan loop", async () => {
  const cwd = tmpDir();
  const session = loadSession(cwd);
  const result = await runTask('write to danger.txt with content "nope"', {
    session,
    cwd,
    teach: false,
    autoYes: false,
    confirm: async () => false,
  });
  // Exactly one step should be recorded — a decline must not spawn
  // additional re-planned attempts that ask again with a garbled prompt.
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].declined, true);
  assert.equal(fs.existsSync(path.join(cwd, "danger.txt")), false);
});

test("every registered skill exposes the required interface", () => {
  for (const skill of SKILLS) {
    assert.equal(typeof skill.name, "string");
    assert.equal(typeof skill.description, "string");
    assert.equal(typeof skill.match, "function");
    assert.equal(typeof skill.run, "function");
  }
});
