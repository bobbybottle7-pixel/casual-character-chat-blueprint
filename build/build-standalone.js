#!/usr/bin/env node
/*
 * build-standalone.js — builds casual-character-chat-app/standalone-app.html
 *
 * The app ships in two shapes. The multi-file shape (index.html + style.css +
 * script.js + starter_pack_data.js + the two static pages) is the one you edit.
 * The standalone shape is that same app flattened into one HTML file with
 * nothing linked, because phones refuse to load linked CSS and scripts from a
 * file:// page and a single file is what people can actually open there.
 *
 * Sources are never modified. Everything below reads them and writes exactly
 * one output file.
 *
 * Usage:
 *   node build/build-standalone.js           write standalone-app.html
 *   node build/build-standalone.js --check   build in memory and diff against
 *                                            the committed file; exit 1 if they
 *                                            differ (for CI / pre-commit)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'casual-character-chat-app');
const BUILD = __dirname;
const OUT = path.join(APP, 'standalone-app.html');

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/* Editors keep re-adding a BOM to style.css and script.js. It is harmless in a
 * linked file and poison in the middle of an inlined one, so it goes here. */
const stripBom = (s) => s.replace(/^﻿/, '');

let failed = false;
const warn = (msg) => { failed = true; console.error('  ! ' + msg); };

/* Replace once and complain if the needle was not there — a silent no-op here
 * means the sources moved on and the standalone would ship half-converted. */
function replaceOnce(haystack, find, replace, what) {
    const first = haystack.indexOf(find);
    if (first === -1) {
        warn(`${what}: pattern not found in the source — it was edited or removed.`);
        return haystack;
    }
    if (haystack.indexOf(find, first + find.length) !== -1) {
        warn(`${what}: pattern occurs more than once, refusing to guess which one.`);
        return haystack;
    }
    return haystack.slice(0, first) + replace + haystack.slice(first + find.length);
}

const bodyOf = (html) => {
    const open = html.indexOf('<body>');
    const close = html.indexOf('</body>');
    if (open === -1 || close === -1) throw new Error('page has no <body>');
    return html.slice(open + '<body>'.length, close).replace(/^\s+/, '');
};

const styleBlockOf = (html) => {
    const open = html.indexOf('<style>');
    const close = html.indexOf('</style>');
    if (open === -1 || close === -1) return null;
    return html.slice(open + '<style>'.length, close);
};

const fingerprint = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/* ── sources ───────────────────────────────────────────────────────────── */

const index = read(APP, 'index.html');
const css = stripBom(read(APP, 'style.css'));
const starterPack = read(APP, 'starter_pack_data.js');
const script = stripBom(read(APP, 'script.js'));
const helpPage = read(APP, 'help.html');
const privacyPage = read(APP, 'privacy & terms.html');
const extraCss = read(BUILD, 'standalone-extra.css');
const helpPatches = JSON.parse(read(BUILD, 'help-standalone-patches.json'));

/* ── 1. the two static pages become modals ─────────────────────────────── */

/* standalone-extra.css restates help.html's and the privacy page's own <style>
 * rules scoped to their modal, because inside the standalone those pages are
 * panels and their bare `body`/`h1`/`.container` selectors would otherwise
 * repaint the whole app. Nothing can keep the two copies in sync
 * automatically, so the CSS carries the fingerprint of each page's <style>
 * block it was written against and we check it here. */
function checkStyleFingerprints() {
    const pages = { help: helpPage, privacy: privacyPage };
    for (const [name, page] of Object.entries(pages)) {
        const block = styleBlockOf(page);
        if (block === null) continue;
        const actual = fingerprint(block);
        const declared = new RegExp(`${name}-style-fingerprint:\\s*([0-9a-f]{16})`).exec(extraCss);
        if (!declared) {
            warn(`standalone-extra.css declares no ${name}-style-fingerprint.`);
        } else if (declared[1] !== actual) {
            warn(`${name} page's <style> block changed (${declared[1]} -> ${actual}).\n` +
                 `    Mirror the change in build/standalone-extra.css under the matching\n` +
                 `    #${name}-page-modal rules, then update the fingerprint to ${actual}.`);
        }
    }
}

function asModal(id, body) {
    const close = `document.getElementById('${id}').classList.add('standalone-modal-hidden')`;
    return `<div id="${id}" class="standalone-modal-overlay standalone-modal-hidden">\n` +
           `    <button class="standalone-modal-close" onclick="${close}">✕ Close</button>\n` +
           `\n${body}</div>\n`;
}

/* A page's inline <script> keeps working inside the modal, but it is re-emitted
 * on its own lines so the seam is readable in the built file. */
const normalizeInlineScripts = (html) =>
    html.replace(/\s*<script>([\s\S]*?)<\/script>/g,
        (_, inner) => `\n<script>\n${inner.replace(/\s+$/, '')}\n</script>`);

function buildHelpModal() {
    let body = bodyOf(helpPage);
    for (const p of helpPatches) {
        body = replaceOnce(body, p.find, p.replace, 'help.html patch');
    }
    body = normalizeInlineScripts(body);
    /* help.html's find-on-page widget owns generic ids and searches
     * document.body. Both would collide with the app it is now sitting in. */
    body = body.replace(/\bsearch-(container|input|prev|next|counter)\b/g, 'help-search-$1');
    body = replaceOnce(body,
        'const content = document.body;',
        "const content = document.getElementById('help-page-modal');",
        'help.html search scope');
    return asModal('help-page-modal', body);
}

const buildPrivacyModal = () =>
    asModal('privacy-page-modal', normalizeInlineScripts(bodyOf(privacyPage)));

/* ── 2. flatten index.html ─────────────────────────────────────────────── */

function build() {
    checkStyleFingerprints();

    let html = index;

    html = replaceOnce(html,
        '<link rel="stylesheet" href="style.css">',
        `<style>\n${css}${extraCss}    </style>`,
        'style.css');

    for (const [file, source] of [['starter_pack_data.js', starterPack], ['script.js', script]]) {
        html = replaceOnce(html,
            `<script src="${file}"></script>`,
            `<script>\n${source.replace(/\s+$/, '')}\n</script>`,
            file);
    }

    /* The footer links open two separate pages; in one file they open panels. */
    html = replaceOnce(html,
        '<a href="help.html" target="_blank" id="help-btn" title="Help Document & FAQ">',
        `<button id="help-btn" onclick="document.getElementById('help-page-modal').classList.remove('standalone-modal-hidden')" title="Help Document & FAQ">`,
        'help link');
    html = replaceOnce(html,
        '<a href="privacy & terms.html" target="_blank" id="privacy-btn" title="Privacy & Terms">',
        `<button id="privacy-btn" onclick="document.getElementById('privacy-page-modal').classList.remove('standalone-modal-hidden')" title="Privacy & Terms">`,
        'privacy link');
    html = replaceOnce(html,
        '❓Help & FAQ<span id="help-notification-dot" class="notification-dot hidden"></span></a>',
        '❓Help & FAQ<span id="help-notification-dot" class="notification-dot hidden"></span></button>',
        'help link close tag');
    html = replaceOnce(html, '🔒 Privacy & Terms</a>', '🔒 Privacy & Terms</button>', 'privacy link close tag');

    html = replaceOnce(html, '</body>',
        `${buildHelpModal()}\n${buildPrivacyModal()}\n</body>`,
        'modal insertion point');

    return html;
}

/* ── run ───────────────────────────────────────────────────────────────── */

const checkOnly = process.argv.includes('--check');
const built = build();

if (failed) {
    console.error('\nBuild aborted: the sources no longer match what this script expects.');
    process.exit(1);
}

const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
const mb = (s) => (Buffer.byteLength(s) / 1048576).toFixed(1);

if (checkOnly) {
    if (existing === built) {
        console.log(`standalone-app.html is up to date (${mb(built)} MB).`);
        process.exit(0);
    }
    console.error('standalone-app.html is out of date — run: node build/build-standalone.js');
    process.exit(1);
}

if (existing === built) {
    console.log(`standalone-app.html already up to date (${mb(built)} MB), left untouched.`);
} else {
    fs.writeFileSync(OUT, built);
    console.log(`Wrote ${path.relative(ROOT, OUT)} (${mb(built)} MB).`);
}
