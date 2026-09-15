import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { evaluate, looksLikeMath } from "../src/skills/calculator.js";
import fileOps from "../src/skills/fileOps.js";
import notes from "../src/skills/notes.js";
import shell from "../src/skills/shell.js";
import webFetch, { assertSafeUrl, extractUrl } from "../src/skills/webFetch.js";
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
// webFetch
// ---------------------------------------------------------------------

function fakeFetch(routes) {
  return async (url) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch of ${url}`);
    return {
      ok: route.status === undefined || (route.status >= 200 && route.status < 300),
      status: route.status ?? 200,
      headers: { get: (k) => route.headers?.[k.toLowerCase()] ?? null },
      text: async () => route.body ?? "",
    };
  };
}

test("webFetch: blocks non-http protocols", () => {
  assert.throws(() => assertSafeUrl("file:///etc/passwd"), /only http and https/);
  assert.throws(() => assertSafeUrl("ftp://example.com"), /only http and https/);
});

test("webFetch: blocks loopback, private, and metadata addresses", () => {
  for (const bad of [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://172.16.0.9/x",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://metadata.google.internal/x",
    "http://[::1]/x",
    "http://printer.local/x",
  ]) {
    assert.throws(() => assertSafeUrl(bad), new RegExp("Refusing"), `should block ${bad}`);
  }
});

test("webFetch: allows ordinary public URLs", () => {
  assert.equal(assertSafeUrl("https://example.com/docs").hostname, "example.com");
  assert.equal(assertSafeUrl("http://93.184.216.34/").hostname, "93.184.216.34");
});

test("webFetch: re-checks the guard on every redirect hop", async () => {
  const fetchImpl = fakeFetch({
    "https://example.com/start": { status: 302, headers: { location: "http://169.254.169.254/creds" } },
  });
  const result = await webFetch.run("fetch https://example.com/start", { fetch: fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.output, /Refusing to fetch private\/loopback/);
});

test("webFetch: follows a safe redirect and returns readable text", async () => {
  const fetchImpl = fakeFetch({
    "https://example.com/a": { status: 301, headers: { location: "https://example.com/b" } },
    "https://example.com/b": {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><head><style>p{color:red}</style></head><body><h1>Title</h1><p>Hello &amp; welcome</p><script>evil()</script></body></html>",
    },
  });
  const result = await webFetch.run("fetch https://example.com/a", { fetch: fetchImpl });
  assert.equal(result.ok, true);
  assert.match(result.output, /Title/);
  assert.match(result.output, /Hello & welcome/);
  assert.doesNotMatch(result.output, /evil\(\)/, "script contents must be stripped");
  assert.doesNotMatch(result.output, /color:red/, "style contents must be stripped");
});

test("webFetch: reports HTTP errors and skips binary content", async () => {
  const notFound = await webFetch.run("fetch https://example.com/missing", {
    fetch: fakeFetch({ "https://example.com/missing": { status: 404 } }),
  });
  assert.equal(notFound.ok, false);
  assert.match(notFound.output, /HTTP 404/);

  const binary = await webFetch.run("fetch https://example.com/img", {
    fetch: fakeFetch({ "https://example.com/img": { headers: { "content-type": "image/png" } } }),
  });
  assert.equal(binary.ok, false);
  assert.match(binary.output, /non-text content/);
});

test("webFetch: refuses oversized responses before reading them", async () => {
  const result = await webFetch.run("fetch https://example.com/big", {
    fetch: fakeFetch({
      "https://example.com/big": { headers: { "content-length": String(50 * 1024 * 1024), "content-type": "text/html" } },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /over the .* cap/);
});

test("webFetch: refuses non-http schemes explicitly instead of falling through", async () => {
  assert.equal(matchSkill("fetch file:///etc/passwd").name, "webFetch");
  const result = await webFetch.run("fetch file:///etc/passwd", { fetch: fakeFetch({}) });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.match(result.output, /only http and https/);
});

test("agent.runTask: a blocked URL is not retried", async () => {
  const cwd = tmpDir();
  const session = loadSession(cwd);
  const result = await runTask("fetch http://169.254.169.254/latest/meta-data/", {
    session,
    cwd,
    teach: false,
    autoYes: true,
    confirm: async () => true,
    fetch: fakeFetch({}),
  });
  // One attempt only — a guard refusal can never succeed on a retry.
  assert.equal(result.observations.length, 1);
  assert.match(result.answer, /Refusing to fetch private\/loopback/);
});

test("webFetch: extracts URLs from prose and bare domains", () => {
  assert.equal(extractUrl("please fetch https://example.com/docs, thanks"), "https://example.com/docs");
  assert.equal(extractUrl("look up example.com/pricing"), "https://example.com/pricing");
  assert.equal(extractUrl("no link here"), null);
});

test("webFetch is matched before fileOps for URLs (extension collision)", () => {
  assert.equal(matchSkill("fetch https://example.com/index.html").name, "webFetch");
  assert.equal(matchSkill("read notes.txt").name, "fileOps");
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
