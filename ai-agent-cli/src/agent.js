import { findSkill } from "./skills/index.js";
import { planTask, reasonAbout, composeAnswer, composeSuggestions } from "./llm.js";
import { recordTurn, recentContext } from "./memory.js";
import * as ui from "./ui.js";

const MAX_REPLANS = 2;

async function runStep(step, ctx) {
  if (step.skill === "reason" || !findSkill(step.skill)) {
    const output = await reasonAbout(step.input, recentContext(ctx.session));
    return { ok: true, skill: "reason", output };
  }

  const skill = findSkill(step.skill);
  const needsConfirm = typeof skill.needsConfirmation === "function" ? skill.needsConfirmation(step.input) : skill.needsConfirmation;

  if (needsConfirm && !ctx.autoYes) {
    const isDestructive = typeof skill.isDestructive === "function" && skill.isDestructive(step.input);
    const label = isDestructive ? ui.style.err("[potentially destructive]") : "";
    const approved = await ctx.confirm(`Run ${skill.name} step: "${step.input}" ${label}? [y/N] `);
    if (!approved) {
      return { ok: false, declined: true, skill: skill.name, output: "Skipped — not confirmed by user." };
    }
  }

  try {
    const result = await skill.run(step.input, { cwd: ctx.cwd, session: ctx.session });
    return { ok: result.ok, skill: skill.name, output: result.output };
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
    const step = steps[i];
    ui.printStepHeader(i + 1, steps.length, step);
    if (step.reasoning) ui.printReasoning(step.reasoning);
    if (ctx.teach && step.teaching) ui.printTeaching(step.teaching);

    const result = await runStep(step, ctx);
    ui.printObservation(result.output);
    observations.push(result);

    if (result.declined) {
      // The user made a deliberate choice not to run this step — that is
      // not a failure to work around, so never re-plan around a decline.
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

  const suggestions = await composeSuggestions(task, answer);
  ui.printSuggestions(suggestions);

  recordTurn(ctx.session, task, answer);
  return { answer, suggestions, observations };
}
