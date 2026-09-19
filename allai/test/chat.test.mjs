/* Tests for the one path every AI request takes.
 * A fake provider stands in for the real ones, so these run offline and
 * cost nothing. Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerProvider, ERROR_KIND } from '../src/core/providers/registry.js';
import { sendChat, sendWithFallback, buildMessages, explainError } from '../src/core/chat.js';

let calls = [];

registerProvider({
  id: 'fake-free',
  name: 'Fake free provider',
  auth: { required: false, scheme: 'none' },
  listModels: () => [{ id: 'f1', providerId: 'fake-free', free: true, pricing: { inPerMTok: 0, outPerMTok: 0 } }],
  async send({ model, messages }) {
    calls.push(model.id);
    return { text: 'hello from ' + model.id, usage: { promptTokens: 5, completionTokens: 3 }, latencyMs: 10, modelReported: model.id };
  },
});

registerProvider({
  id: 'fake-paid',
  name: 'Fake paid provider',
  auth: { required: true, scheme: 'bearer' },
  listModels: () => [{ id: 'p1', providerId: 'fake-paid', free: false, pricing: { inPerMTok: 3, outPerMTok: 15 } }],
  async send({ model }) { calls.push(model.id); return { text: 'paid reply', usage: null, latencyMs: 5 }; },
});

registerProvider({
  id: 'fake-broken',
  name: 'Always fails',
  auth: { required: false, scheme: 'none' },
  listModels: () => [{ id: 'b1', providerId: 'fake-broken', free: true, pricing: { inPerMTok: 0, outPerMTok: 0 } }],
  async send() { throw new Error('boom'); },
});

const freeModel = { id: 'f1', providerId: 'fake-free', free: true, pricing: { inPerMTok: 0, outPerMTok: 0 } };
const paidModel = { id: 'p1', providerId: 'fake-paid', free: false, pricing: { inPerMTok: 3, outPerMTok: 15 } };
const brokenModel = { id: 'b1', providerId: 'fake-broken', free: true, pricing: { inPerMTok: 0, outPerMTok: 0 } };
const msgs = [{ role: 'user', content: 'hi' }];

test('a free request goes through and reports real usage', async () => {
  calls = [];
  const r = await sendChat({ model: freeModel, messages: msgs, recordToLedger: false });
  assert.equal(r.text, 'hello from f1');
  assert.deepEqual(r.usage, { promptTokens: 5, completionTokens: 3 });
  assert.deepEqual(calls, ['f1']);
});

test('the budget guard blocks a paid request before anything is sent', async () => {
  calls = [];
  await assert.rejects(
    () => sendChat({
      model: paidModel, messages: msgs, recordToLedger: false,
      providerConfig: { 'fake-paid': { apiKey: 'sk-test' } },
    }),
    (err) => err.kind === ERROR_KIND.BLOCKED_BY_BUDGET,
  );
  assert.deepEqual(calls, [], 'nothing may reach the provider when the guard says no');
});

test('an API key alone is not permission to spend', async () => {
  calls = [];
  await assert.rejects(
    () => sendChat({
      model: paidModel, messages: msgs, recordToLedger: false,
      providerConfig: { 'fake-paid': { apiKey: 'sk-test' } },
      budgetSettings: { protectBalance: false, allowPaid: false, budgetUsd: 5 },
    }),
    (err) => err.kind === ERROR_KIND.BLOCKED_BY_BUDGET,
  );
  assert.deepEqual(calls, []);
});

test('a paid request runs once every switch is on and it is approved', async () => {
  calls = [];
  const r = await sendChat({
    model: paidModel, messages: msgs, recordToLedger: false, approved: true,
    providerConfig: { 'fake-paid': { apiKey: 'sk-test' } },
    budgetSettings: { protectBalance: false, allowPaid: true, budgetUsd: 5 },
  });
  assert.equal(r.text, 'paid reply');
  assert.deepEqual(calls, ['p1']);
});

test('a provider that needs a key and has none is refused, not attempted', async () => {
  calls = [];
  await assert.rejects(
    () => sendChat({ model: paidModel, messages: msgs, recordToLedger: false, approved: true,
      budgetSettings: { protectBalance: false, allowPaid: true, budgetUsd: 5 } }),
    (err) => err.kind === ERROR_KIND.AUTH,
  );
  assert.deepEqual(calls, []);
});

test('fallback moves past a broken model to a working one', async () => {
  calls = [];
  const { model } = await sendWithFallback({
    models: [brokenModel, freeModel], messages: msgs, recordToLedger: false,
  });
  assert.equal(model.id, 'f1');
});

test('fallback refuses to invent a chain it does not have', async () => {
  await assert.rejects(
    () => sendWithFallback({ models: [paidModel], messages: msgs, recordToLedger: false }),
    (err) => err.kind === ERROR_KIND.UNAVAILABLE && /will not invent a fallback/.test(err.message),
  );
});

test('fallback never silently upgrades a free request to a paid model', async () => {
  calls = [];
  await assert.rejects(
    () => sendWithFallback({
      models: [brokenModel, paidModel], messages: msgs, recordToLedger: false,
      providerConfig: { 'fake-paid': { apiKey: 'sk-test' } },
      budgetSettings: { protectBalance: false, allowPaid: true, budgetUsd: 5 },
    }),
    () => true,
  );
  assert.equal(calls.includes('p1'), false, 'a free-only chain must never reach a paid model');
});

test('memory is only included when it is switched on', () => {
  const memories = [{ text: 'Cam is new to programming', enabled: true }];
  const withMemory = buildMessages({ systemPrompt: 'Be helpful.', memories, history: [], memoryEnabled: true });
  assert.match(withMemory[0].content, /new to programming/);

  const withoutMemory = buildMessages({ systemPrompt: 'Be helpful.', memories, history: [], memoryEnabled: false });
  assert.doesNotMatch(withoutMemory[0].content, /new to programming/);
});

test('a memory switched off individually is left out', () => {
  const memories = [{ text: 'keep this', enabled: true }, { text: 'skip this', enabled: false }];
  const built = buildMessages({ memories, history: [], memoryEnabled: true });
  assert.match(built[0].content, /keep this/);
  assert.doesNotMatch(built[0].content, /skip this/);
});

test('history order is preserved and stray roles are dropped', () => {
  const history = [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'debug', content: 'should not be sent' },
    { role: 'user', content: 'three' },
  ];
  const built = buildMessages({ history });
  assert.deepEqual(built.map(m => m.content), ['one', 'two', 'three']);
});

test('errors are explained in plain words', () => {
  assert.equal(explainError({ name: 'ProviderError', kind: 'nope', message: 'raw' }), 'raw');
});
