import calculator from "./calculator.js";
import search from "./search.js";
import webFetch from "./webFetch.js";
import fileOps from "./fileOps.js";
import shell from "./shell.js";
import notes from "./notes.js";

// Ordered — first matching skill wins. "reason" (pure thinking, no tool)
// is always the fallback and is handled directly by src/agent.js, not
// registered here.
//
// webFetch must precede fileOps: fileOps matches anything with a file
// extension, and "example.com" looks exactly like one to that pattern.
// search precedes webFetch so "look up X online" (no URL given) is a
// search; search itself defers whenever the task contains a real URL.
export const SKILLS = [calculator, search, webFetch, fileOps, shell, notes];

export function findSkill(name) {
  return SKILLS.find((s) => s.name === name);
}

export function matchSkill(task) {
  return SKILLS.find((s) => {
    try {
      return s.match(task);
    } catch {
      return false;
    }
  });
}

export function describeSkills() {
  return SKILLS.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
