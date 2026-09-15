import { findSkill } from "./skills/index.js";
import { planTask, reasonAbout, composeAnswer, composeSuggestions } from "./llm.js";
import { recordTurn, recentContext } from "./memory.js";
import * as ui from "./ui.js";

const MAX_REPLANS = 2;
const CONFIRM_PREVIEW_CHARS = 120;

/**
 * Replaces {{prev}} and {{N}} in a step's input with what earlier steps
 * actually produced. Without this a "plan" is just a batch of independent
 * tool calls — step 2 could never use what step 1 found.
 */
export function resolveReferences(input, observations) {
  if (!input || !observations.length) return input;
  // A skill may return `data` (the clean value meant for chaining)
  // alongside `output` (what the user reads); prefer it when present.
  const valueOf = (obs) => obs?.data ?? obs?.output ?? "";
  return input
    .replace(/\{\{prev\}\}/gi, () => valueOf(observations[observations.length - 1]))
    .replace(/\{\{(\d+)\}\}/g, (match, n) => (observations[Number(n) - 1] ? valueOf(observations[Number(n) - 1]) : match));
}

async function runStep(step, ctx, observations) {
  if (step.skill === "reason" || !findSkill(step.skill)) {
    // A reasoning step sees both prior turns and what this task's earlier
    // steps turned up, so it can actually reason about the findings.
    const stepContext = observations.map((o, i) => ({
      task: `step ${i + 1} (${o.skill})`,
      answer: o.output,
    }));
    const output = await reasonAbout(step.input, [...recentContext(ctx.session), ...stepContext]);
    return { ok: true, skill: "reason", output };
  }

  const skill = findSkill(step.skill);
  const needsConfirm = typeof skill.needsConfirmation === "function" ? skill.needsConfirmation(step.input) : skill.needsConfirmation;

  if (needsConfirm && !ctx.autoYes) {
    const isDestructive = typeof skill.isDestructive === "function" && skill.isDestructive(step.input);
    const label = isDestructive ? ui.style.err("[potentially destructive]") : "";
    // Resolved input can carry a whole fetched page — don't dump it into
    // the prompt the user has to read before answering y/N.
    const preview =
      step.input.length > CONFIRM_PREVIEW_CHARS ? `${step.input.slice(0, CONFIRM_PREVIEW_CHARS)}…` : step.input;
    const approved = await ctx.confirm(`Run ${skill.name} step: "${preview}" ${label}? [y/N] `);
    if (!approved) {
      return { ok: false, declined: true, skill: skill.name, output: "Skipped — not confirmed by user." };
    }
  }

  try {
    const result = await skill.run(step.input, { cwd: ctx.cwd, session: ctx.session, fetch: ctx.fetch });
    return { ok: result.ok, retryable: result.retryable, skill: skill.name, output: result.output, data: result.data };
  } catch (err) {
    return { ok: false, skill: skill.name, output: `Skill error: ${err.message}` };
  }
}

/**
 * Runs one task through plan -> act -> observe -> reflect -> answer -> suggest.
 * ctx: { session, cwd, teach, autoYes, confirm(question) -> Promise<boolean> }
 */
export async function runTask(task, ctx) {
  let steps = await planTask(task);
  ui.printPlan(steps);

  const observations = [];
  let replans = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = { ...steps[i], input: resolveReferences(steps[i].input, observations) };
    ui.printStepHeader(i + 1, steps.length, step);
    if (step.reasoning) ui.printReasoning(step.reasoning);
    if (ctx.teach && step.teaching) ui.printTeaching(step.teaching);

    const result = await runStep(step, ctx, observations);
    ui.printObservation(result.output);
    observations.push(result);

    if (result.declined || result.retryable === false) {
      // A decline is a deliberate user choice, and a skill that reports
      // retryable:false has failed for a reason a retry cannot change
      // (a blocked URL, an unsupported scheme). Neither is worth a re-plan.
      continue;
    }

    if (!result.ok && replans < MAX_REPLANS) {
      replans++;
      ui.printReasoning(`Step didn't fully succeed — re-planning the remaining work (attempt ${replans}/${MAX_REPLANS}).`);
      const remainingTask = `Original task: "${task}". This step failed: "${step.summary}" (${result.output}). Produce a plan for what to try instead to still accomplish the original task.`;
      const newSteps = await planTask(remainingTask);
      steps = steps.slice(0, i + 1).concat(newSteps);
    }
  }

  const answer = await composeAnswer(task, observations);
  ui.printAnswer(answer);

  const suggestions = await composeSuggestions(task, answer, { teach: ctx.teach });
  ui.printSuggestions(suggestions);

  recordTurn(ctx.session, task, answer);
  return { answer, suggestions, observations };
}
