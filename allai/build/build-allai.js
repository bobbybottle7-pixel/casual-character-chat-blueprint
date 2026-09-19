/* ===========================================================================
 * ALLAI — build
 *
 * Turns the modular source into ONE file: dist/allai.html
 *
 * Why this exists. Phones will not load linked .js and .css files from a page
 * opened straight off storage — the browser blocks it for security reasons.
 * So the shape that actually works on Cam's phone is a single self-contained
 * file. But writing the whole app as one file is how projects turn into an
 * unmaintainable wall of code, so the SOURCE stays in small modules and this
 * script flattens them.
 *
 * It is a small module bundler rather than a plain concatenation, because
 * separate modules are allowed to use the same names for different things —
 * three provider files each have their own ENDPOINT — and gluing them
 * together would break on that. Each module keeps its own scope here.
 *
 * No dependencies. Runs on any Node from v14 up.
 *
 *   node build/build-allai.js          -> writes dist/allai.html
 *   node build/build-allai.js --check  -> exits 1 if the committed file is stale
 * ======================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ENTRY = 'src/ui/app.js';
const HTML_IN = path.join(ROOT, 'index.html');
const CSS_IN = path.join(ROOT, 'src/ui/styles.css');
const OUT = path.join(ROOT, 'dist/allai.html');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const idOf = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/* --- import / export rewriting -------------------------------------------
 * Each module becomes a function with its own scope. Imports become lookups
 * in a registry, exports become entries in it.
 */

// `import { a, b as c } from './x.js';` — the lazy [\s\S]*? lets the names
// span several lines, which they do in app.js.
const RE_NAMED = /^import\s+(\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
// `import x from './x.js';`
const RE_DEFAULT = /^import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
// `import './x.js';` — run it for its side effects only
const RE_BARE = /^import\s*['"]([^'"]+)['"];?[ \t]*$/gm;
// `export { a, b };`
const RE_EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm;
// `export const X`, `export function f`, `export async function f`, `export class C`
const RE_EXPORT_DECL = /^export\s+(const|let|var|class|function|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;

function resolveImport(fromId, spec) {
  if (!spec.startsWith('.')) throw new Error(`${fromId}: only relative imports are supported, got "${spec}"`);
  return idOf(path.resolve(path.dirname(path.join(ROOT, fromId)), spec));
}

/** Rewrites one module's source and reports which modules it needs. */
function transform(id, source) {
  const deps = [];
  const exported = new Set();
  let code = source;

  code = code.replace(RE_NAMED, (_m, names, spec) => {
    const dep = resolveImport(id, spec);
    deps.push(dep);
    // `{ a, b as c }` is valid destructuring once `as` becomes `:`.
    const destructured = names.replace(/\bas\b/g, ':');
    return `const ${destructured} = __req(${JSON.stringify(dep)});`;
  });

  code = code.replace(RE_DEFAULT, (_m, name, spec) => {
    const dep = resolveImport(id, spec);
    deps.push(dep);
    return `const ${name} = __req(${JSON.stringify(dep)}).default;`;
  });

  code = code.replace(RE_BARE, (_m, spec) => {
    const dep = resolveImport(id, spec);
    deps.push(dep);
    return `__req(${JSON.stringify(dep)});`;
  });

  code = code.replace(RE_EXPORT_LIST, (_m, names) => {
    names.split(',').map(s => s.trim()).filter(Boolean).forEach(entry => {
      const [local, alias] = entry.split(/\s+as\s+/).map(s => s.trim());
      exported.add(alias || local);
      if (alias && alias !== local) exported.add(`${alias}:${local}`);
    });
    return '';
  });

  code = code.replace(RE_EXPORT_DECL, (_m, kind, name) => {
    exported.add(name);
    return `${kind} ${name}`;
  });

  if (/^export\s/m.test(code)) {
    const stray = code.match(/^export\s.*$/m)[0];
    throw new Error(`${id}: this export form is not supported by the build: ${stray.trim()}`);
  }

  const assignments = [...exported].map(entry => {
    if (entry.includes(':')) { const [alias, local] = entry.split(':'); return `${alias}: ${local}`; }
    return entry;
  });
  const footer = assignments.length ? `\nObject.assign(__exports, { ${assignments.join(', ')} });\n` : '';

  return { code: code + footer, deps: [...new Set(deps)] };
}

/** Walks the import graph from the entry point, depth first, deepest first. */
function collectModules(entryId) {
  const modules = new Map();
  const order = [];
  const visiting = new Set();

  (function visit(id, trail) {
    if (modules.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Import cycle: ${[...trail, id].join(' -> ')}`);
    }
    visiting.add(id);
    let source;
    try { source = read(id); } catch { throw new Error(`Cannot read module "${id}" (imported by ${trail[trail.length - 1] || 'the entry point'})`); }
    const { code, deps } = transform(id, source);
    for (const dep of deps) visit(dep, [...trail, id]);
    visiting.delete(id);
    modules.set(id, code);
    order.push(id);
  })(entryId, []);

  return { modules, order };
}

function bundle() {
  const { modules, order } = collectModules(ENTRY);
  const defs = order.map(id =>
    `__def(${JSON.stringify(id)}, function (__exports, __req) {\n${modules.get(id)}\n});`
  ).join('\n\n');

  return `(function () {
'use strict';
/* ALLAI bundle — generated by build/build-allai.js. Do not edit this file;
   edit the files in allai/src/ and run the build again. */
var __defs = {};
var __cache = {};
function __def(id, fn) { __defs[id] = fn; }
function __req(id) {
  if (Object.prototype.hasOwnProperty.call(__cache, id)) return __cache[id];
  var exports = {};
  __cache[id] = exports;
  var fn = __defs[id];
  if (!fn) throw new Error('ALLAI bundle is missing module: ' + id);
  fn(exports, __req);
  return exports;
}

${defs}

__req(${JSON.stringify(ENTRY)});
})();`;
}

function buildHtml() {
  const css = read(path.relative(ROOT, CSS_IN).split(path.sep).join('/'));
  let html = fs.readFileSync(HTML_IN, 'utf8');

  // Every replacement below passes a FUNCTION rather than a string. With a
  // string, JavaScript treats $$, $&, $` and $1 inside it as substitution
  // escapes and silently rewrites the code being inlined — which really
  // happened here: `const $$ = ...` arrived in the bundle as `const $ = ...`
  // and broke the app. A replacer function is handed through untouched.
  const insert = (text) => () => text;

  const linkTag = /<link\s+rel="stylesheet"\s+href="src\/ui\/styles\.css">/;
  if (!linkTag.test(html)) throw new Error('index.html no longer links src/ui/styles.css — the build cannot find where to inline the stylesheet.');
  html = html.replace(linkTag, insert(`<style>\n${css}\n</style>`));

  const scriptTag = /<script\s+type="module"\s+src="src\/ui\/app\.js"><\/script>/;
  if (!scriptTag.test(html)) throw new Error('index.html no longer loads src/ui/app.js — the build cannot find where to inline the code.');
  // </script> inside a string would end the block early; < avoids it.
  const code = bundle().replace(/<\/script>/gi, '<\\u002fscript>');
  html = html.replace(scriptTag, insert(`<script>\n${code}\n</script>`));

  html = html.replace(
    '<title>ALLAI</title>',
    insert('<title>ALLAI</title>\n<!-- Single-file build. Generated from allai/src by build/build-allai.js. -->'),
  );
  return html;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let html;
  try {
    html = buildHtml();
  } catch (err) {
    console.error(`! build failed: ${err.message}`);
    process.exit(1);
  }

  if (checkOnly) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (current === html) { console.log('dist/allai.html is up to date.'); return; }
    console.error('! dist/allai.html is out of date. Run: node build/build-allai.js');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`Wrote dist/allai.html (${kb} KB)`);
}

main();
