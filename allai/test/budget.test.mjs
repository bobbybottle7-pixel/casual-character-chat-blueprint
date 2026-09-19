/* Tests for the cost guard. Run with: node --test test/
 * No test framework to install — this is Node's own built-in runner.
 *
 * These tests exist because "ALLAI never spends money without asking" is a
 * promise, and an untested promise is just a hope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorize, DECISION, DEFAULT_BUDGET_SETTINGS, isFreeModel,
  estimateCostUsd, makeLedgerEntry, formatUsd,
} from '../src/core/budget.js';

const freeModel  = { id: 'free-1',  providerId: 'p', free: true,  pricing: { inPerMTok: 0, outPerMTok: 0 } };
const paidModel  = { id: 'paid-1',  providerId: 'p', free: false, pricing: { inPerMTok: 3, outPerMTok: 15 } };
const unknownModel = { id: 'mystery', providerId: 'p', free: false, pricing: null };
const lyingModel = { id: 'lies', providerId: 'p', free: true, pricing: { inPerMTok: 3, outPerMTok: 15 } };
const msgs = [{ role: 'user', content: 'hello world' }];

test('a free model is allowed with the default settings', () => {
  const r = authorize({ model: freeModel, messages: msgs });
  assert.equal(r.allowed, true);
  assert.equal(r.decision, DECISION.ALLOWED_FREE);
  assert.equal(r.estimatedUsd, 0);
});

test('defaults refuse to spend: paid is off and balance is protected', () => {
  assert.equal(DEFAULT_BUDGET_SETTINGS.allowPaid, false);
  assert.equal(DEFAULT_BUDGET_SETTINGS.protectBalance, true);
  assert.equal(DEFAULT_BUDGET_SETTINGS.budgetUsd, 0);
});

test('a paid model is blocked out of the box', () => {
  const r = authorize({ model: paidModel, messages: msgs });
  assert.equal(r.allowed, false);
  assert.equal(r.decision, DECISION.BLOCKED_PROTECTED);
});

test('"Protect my balance" beats every other setting', () => {
  const r = authorize({
    model: paidModel, messages: msgs, approved: true,
    settings: { allowPaid: true, protectBalance: true, budgetUsd: 100 },
  });
  assert.equal(r.allowed, false, 'protect-balance must win even when paid is on, budget is large and the user approved');
  assert.equal(r.decision, DECISION.BLOCKED_PROTECTED);
});

test('paid switched off blocks even with budget available', () => {
  const r = authorize({
    model: paidModel, messages: msgs,
    settings: { allowPaid: false, protectBalance: false, budgetUsd: 5 },
  });
  assert.equal(r.allowed, false);
  assert.equal(r.decision, DECISION.BLOCKED_PAID_OFF);
});

test('an unknown price is never treated as free', () => {
  assert.equal(isFreeModel(unknownModel), false);
  const r = authorize({
    model: unknownModel, messages: msgs, approved: true,
    settings: { allowPaid: true, protectBalance: false, budgetUsd: 5 },
  });
  assert.equal(r.allowed, false);
  assert.equal(r.decision, DECISION.BLOCKED_UNKNOWN_PRICE);
});

test('a free flag that disagrees with a non-zero price loses to the price', () => {
  assert.equal(isFreeModel(lyingModel), false);
  const r = authorize({ model: lyingModel, messages: msgs });
  assert.equal(r.allowed, false, 'a mislabelled model must not slip through as free');
});

test('a paid request needs explicit approval even when everything is switched on', () => {
  const settings = { allowPaid: true, protectBalance: false, budgetUsd: 5, spentUsd: 0 };
  const asked = authorize({ model: paidModel, messages: msgs, settings });
  assert.equal(asked.allowed, false);
  assert.equal(asked.requiresApproval, true);
  assert.ok(asked.estimatedUsd > 0);

  const approvedNow = authorize({ model: paidModel, messages: msgs, settings, approved: true });
  assert.equal(approvedNow.allowed, true);
});

test('spending stops when the budget is used up', () => {
  const r = authorize({
    model: paidModel, messages: msgs, approved: true,
    settings: { allowPaid: true, protectBalance: false, budgetUsd: 5, spentUsd: 5 },
  });
  assert.equal(r.allowed, false);
  assert.equal(r.decision, DECISION.BLOCKED_NO_BUDGET);
  assert.equal(r.remainingUsd, 0);
});

test('cost maths is right', () => {
  // 1,000,000 prompt tokens at $3/M plus 1,000,000 completion at $15/M = $18
  assert.equal(estimateCostUsd(paidModel, { promptTokens: 1e6, completionTokens: 1e6 }), 18);
  assert.equal(estimateCostUsd(unknownModel, { promptTokens: 1e6 }), null);
});

test('the ledger records unknown cost as null, not as zero', () => {
  const entry = makeLedgerEntry({ model: unknownModel, usage: { promptTokens: 10, completionTokens: 10 }, latencyMs: 5 });
  assert.equal(entry.actualUsd, null);
  assert.equal(entry.free, false);
});

test('the ledger records a real cost for a paid model', () => {
  const entry = makeLedgerEntry({ model: paidModel, usage: { promptTokens: 1e6, completionTokens: 0 }, latencyMs: 5 });
  assert.equal(entry.actualUsd, 3);
});

test('money is shown in a readable way', () => {
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(1.5), '$1.50');
  assert.equal(formatUsd(0.0001), '$0.0001');
  assert.equal(formatUsd(null), 'an unknown amount');
});
