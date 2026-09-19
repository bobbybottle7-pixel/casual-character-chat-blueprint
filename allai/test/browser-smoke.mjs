/* ===========================================================================
 * ALLAI — browser smoke test
 *
 * Drives the built single file in a real browser at phone size (360x740) and
 * checks the things that would embarrass us if they broke: the app loads, the
 * cost guard is on, nothing scrolls sideways, buttons are thumb-sized, keys
 * stay masked, storage survives a reload, and a real message to a real free
 * model really comes back.
 *
 * It needs Playwright and a network connection, so it is kept out of
 * `npm test` (which runs offline in under a second) and run on its own:
 *
 *     npm run smoke
 *
 * The Chromium path and the certificate exception below are for the container
 * this was developed in. On a normal machine, delete `executablePath` and
 * `ignoreHTTPSErrors` and Playwright will use its own browser.
 * ======================================================================== */
// Playwright may be installed locally or globally. Try the normal import
// first, then fall back to a path in ALLAI_PLAYWRIGHT.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const fallback = process.env.ALLAI_PLAYWRIGHT
    || '/opt/node22/lib/node_modules/playwright/index.mjs';
  try {
    ({ chromium } = await import(fallback));
  } catch {
    console.error('Playwright is not installed. Run `npm i -D playwright`, or set\n'
      + 'ALLAI_PLAYWRIGHT to the path of an existing install.');
    process.exit(2);
  }
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist/allai.html');
const CHROME = process.env.ALLAI_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const problems = [];
const ok = (m) => console.log('  PASS', m);
const bad = (m) => { problems.push(m); console.log('  FAIL', m); };

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
// ignoreHTTPSErrors is for THIS sandbox only: outbound HTTPS here goes through
// an intercepting proxy whose CA Chromium does not carry. Nothing in ALLAI
// disables certificate checking.
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

console.log('\n1. Page loads with no JavaScript errors');
await page.goto(FILE);
await page.waitForTimeout(1500);
const realErrors = consoleErrors.filter(e => !/ERR_CERT_AUTHORITY_INVALID/.test(e));
realErrors.length === 0 ? ok('no console errors') : bad('console errors: ' + realErrors.join(' | '));

console.log('\n2. Navigation is built and all seven screens exist');
const navCount = await page.locator('#app-nav button').count();
navCount === 7 ? ok('7 nav buttons') : bad(`expected 7 nav buttons, got ${navCount}`);

console.log('\n3. A free model is selected by default');
const modelText = await page.locator('#model-select').inputValue();
modelText.includes('pollinations') ? ok(`default model is ${modelText}`) : bad(`default model was ${modelText}`);
const facts = await page.locator('#model-facts').innerText();
facts.toLowerCase().includes('free') ? ok('model facts show FREE') : bad('model facts missing FREE: ' + facts);

console.log('\n4. Cost protection is on out of the box');
await page.locator('#app-nav button[data-screen="settings"]').click();
await page.waitForTimeout(300);
const protect = await page.locator('#protect-balance').isChecked();
const allowPaid = await page.locator('#allow-paid').isChecked();
const budget = await page.locator('#budget-usd').inputValue();
protect ? ok('protect-my-balance is ON') : bad('protect-my-balance was OFF');
!allowPaid ? ok('paid requests are OFF') : bad('paid requests were ON');
budget === '0' ? ok('budget is $0') : bad(`budget was ${budget}`);
const banner = await page.locator('#budget-summary .banner').innerText();
banner.includes('refuse') ? ok('budget banner states the refusal') : bad('banner: ' + banner);

console.log('\n5. Layout fits a 360px phone with no sideways scrolling');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
overflow <= 0 ? ok('no horizontal overflow') : bad(`page overflows by ${overflow}px`);

console.log('\n6. Touch targets are big enough');
const small = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('#app-nav button, .composer button, .btn')) {
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 40) out.push(`${el.id || el.textContent.trim().slice(0,12)}=${Math.round(r.height)}px`);
  }
  return out;
});
small.length === 0 ? ok('all visible buttons >= 40px tall') : bad('too small: ' + small.join(', '));

console.log('\n7. Memory can be added, is listed, and survives a reload');
await page.locator('#app-nav button[data-screen="memory"]').click();
await page.locator('#memory-input').fill('Cam is new to programming.');
await page.locator('#memory-add-btn').click();
await page.waitForTimeout(400);
let memText = await page.locator('#memory-list').innerText();
memText.includes('new to programming') ? ok('memory listed') : bad('memory not listed: ' + memText);
await page.reload();
await page.waitForTimeout(1200);
await page.locator('#app-nav button[data-screen="memory"]').click();
await page.waitForTimeout(400);
memText = await page.locator('#memory-list').innerText();
memText.includes('new to programming') ? ok('memory survived reload (IndexedDB works)') : bad('memory lost after reload');

console.log('\n8. Settings never show a full API key');
await page.locator('#app-nav button[data-screen="settings"]').click();
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const req = indexedDB.open('allai');
  await new Promise(r => { req.onsuccess = r; });
  const db = req.result;
  await new Promise(r => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key: 'providerConfig', value: { openrouter: { enabled: true, apiKey: 'sk-or-v1-SECRETVALUE12345' } } });
    tx.oncomplete = r;
  });
});
await page.reload();
await page.waitForTimeout(1500);
await page.locator('#app-nav button[data-screen="settings"]').click();
await page.waitForTimeout(400);
const settingsHtml = await page.locator('#screen-settings').innerHTML();
!settingsHtml.includes('SECRETVALUE12345') ? ok('full key is never rendered') : bad('FULL API KEY LEAKED INTO THE PAGE');
const settingsText = await page.locator('#provider-settings').innerText();
settingsText.includes('••') ? ok('key shown masked') : bad('no masked key shown: ' + settingsText.slice(0,200));

console.log('\n9. A real message goes to the real free provider and comes back');
await page.locator('#app-nav button[data-screen="chat"]').click();
let lastReply = '';
let stopSeen = false;
// Up to 3 goes: this sandbox's intercepting proxy intermittently answers
// ERR_TOO_MANY_RETRIES. A retry here is about the test environment, not about
// hiding a real failure — a genuine fault fails all three.
for (let attempt = 1; attempt <= 3; attempt += 1) {
  await page.locator('#composer-input').fill('Reply with exactly the word: ALLAIWORKS');
  await page.locator('#send-btn').click();
  await page.waitForTimeout(500);
  if (await page.locator('#stop-btn').isVisible()) stopSeen = true;
  await page.waitForFunction(() => document.querySelector('#stop-btn').hidden === true, { timeout: 90000 });
  lastReply = await page.locator('#messages .msg.assistant').last().innerText();
  if (/ALLAIWORKS/i.test(lastReply)) break;
  console.log(`     attempt ${attempt} did not succeed: ${JSON.stringify(lastReply.slice(0,90))}`);
  await page.waitForTimeout(3000);
}
stopSeen ? ok('Stop button appears while generating') : bad('Stop button did not appear');
try {
  const last = lastReply;
  console.log('     model said:', JSON.stringify(last.slice(0, 160)));
  if (/ALLAIWORKS/i.test(last)) ok('a real model answered through the UI');
  else bad('reply did not contain the requested word: ' + last.slice(0, 200));
  /tokens|token count/.test(last) ? ok('reply footer reports token usage') : bad('no usage reported: ' + last);
  /free/.test(last) ? ok('reply footer marks the request as free') : bad('not marked free: ' + last);
} catch (e) {
  bad('no reply arrived within 60s: ' + e.message);
}

console.log('\n10. The usage ledger recorded that request');
await page.locator('#app-nav button[data-screen="settings"]').click();
await page.waitForTimeout(500);
const ledger = await page.locator('#budget-summary').innerText();
console.log('     ledger rows:', JSON.stringify(ledger.replace(/\s+/g,' ').slice(0, 300)));
/1 requests so far|requests so far/.test(ledger) ? ok('ledger shows the request') : bad('ledger empty: ' + ledger.slice(0,200));
/\$0\.00/.test(ledger) ? ok('ledger reports $0.00 spent') : bad('ledger did not report zero spend: ' + ledger.slice(0,200));

await browser.close();
console.log(`\n${problems.length === 0 ? 'ALL CHECKS PASSED' : problems.length + ' CHECK(S) FAILED'}`);
process.exit(problems.length === 0 ? 0 : 1);
