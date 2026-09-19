/* ===========================================================================
 * ALLAI — cost guard
 *
 * Cam has about five dollars. This file exists so that no request can ever
 * quietly spend any of it.
 *
 * The rule the whole file enforces: a request that could cost money is
 * refused unless three separate things are true — paid spending is switched
 * on, "Protect my balance" is switched off, and there is budget left. The
 * defaults are set so that a brand new install can only ever use free models.
 *
 * Two deliberate strictnesses:
 *   1. A model with UNKNOWN pricing counts as PAID. Unknown is not free.
 *   2. Having an API key is never treated as permission to spend. A key means
 *      "I can reach this provider", not "help yourself".
 * ======================================================================== */

export const DEFAULT_BUDGET_SETTINGS = Object.freeze({
  allowPaid: false,       // paid spending is OFF until Cam turns it on
  protectBalance: true,   // the big red switch: refuse all paid requests
  budgetUsd: 0,           // maximum ALLAI may ever spend, in dollars
  spentUsd: 0,            // what the ledger says has been spent so far
  warnAboveUsd: 0.01,     // ask again before any single request over this
});

export const DECISION = Object.freeze({
  ALLOWED_FREE: 'allowed_free',
  NEEDS_APPROVAL: 'needs_approval',
  BLOCKED_PROTECTED: 'blocked_protected',
  BLOCKED_PAID_OFF: 'blocked_paid_off',
  BLOCKED_NO_BUDGET: 'blocked_no_budget',
  BLOCKED_UNKNOWN_PRICE: 'blocked_unknown_price',
});

/**
 * A rough token count. Four characters per token is the usual rule of thumb
 * for English text; it is an ESTIMATE and the UI must say so. Real counts come
 * back from the provider after the fact and are what the ledger records.
 */
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

export function estimateRequestTokens(messages, expectedReplyTokens = 600) {
  const promptTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  return { promptTokens, completionTokens: expectedReplyTokens };
}

/** Dollars for a given token count at a given price. Returns null if unknown. */
export function estimateCostUsd(model, { promptTokens = 0, completionTokens = 0 } = {}) {
  if (!model?.pricing) return null;
  const { inPerMTok, outPerMTok } = model.pricing;
  if (!Number.isFinite(inPerMTok) || !Number.isFinite(outPerMTok)) return null;
  return (promptTokens / 1e6) * inPerMTok + (completionTokens / 1e6) * outPerMTok;
}

export function isFreeModel(model) {
  // Free only when the provider published a price and that price is zero on
  // both sides. A missing price is unknown, and unknown is never free. The
  // `free` flag alone is not enough either — a flag that disagrees with the
  // published price loses to the price.
  if (!model?.pricing) return false;
  return model.pricing.inPerMTok === 0 && model.pricing.outPerMTok === 0;
}

/**
 * The gate. Every request goes through this before a single byte is sent.
 *
 * Returns { decision, allowed, requiresApproval, estimatedUsd, remainingUsd, message }
 * `message` is written to be shown to a person as-is.
 */
export function authorize({ model, messages = [], settings = DEFAULT_BUDGET_SETTINGS, approved = false }) {
  const s = { ...DEFAULT_BUDGET_SETTINGS, ...settings };
  const remainingUsd = Math.max(0, Number(s.budgetUsd || 0) - Number(s.spentUsd || 0));

  if (isFreeModel(model)) {
    return {
      decision: DECISION.ALLOWED_FREE,
      allowed: true,
      requiresApproval: false,
      estimatedUsd: 0,
      remainingUsd,
      message: 'Free model — this costs nothing.',
    };
  }

  const tokens = estimateRequestTokens(messages);
  const estimatedUsd = estimateCostUsd(model, tokens);

  if (s.protectBalance) {
    return {
      decision: DECISION.BLOCKED_PROTECTED,
      allowed: false,
      requiresApproval: false,
      estimatedUsd,
      remainingUsd,
      message:
        '"Protect my balance" is on, so ALLAI will not send any request that could cost money. ' +
        'Pick a free model, or turn the setting off in Settings.',
    };
  }

  if (!s.allowPaid) {
    return {
      decision: DECISION.BLOCKED_PAID_OFF,
      allowed: false,
      requiresApproval: false,
      estimatedUsd,
      remainingUsd,
      message: 'Paid requests are switched off. Turn them on in Settings if you want to use this model.',
    };
  }

  if (estimatedUsd == null) {
    return {
      decision: DECISION.BLOCKED_UNKNOWN_PRICE,
      allowed: false,
      requiresApproval: false,
      estimatedUsd: null,
      remainingUsd,
      message:
        'ALLAI does not know what this model charges, so it will not send the request. ' +
        'An unknown price is not a free price.',
    };
  }

  if (estimatedUsd > remainingUsd) {
    return {
      decision: DECISION.BLOCKED_NO_BUDGET,
      allowed: false,
      requiresApproval: false,
      estimatedUsd,
      remainingUsd,
      message:
        `This request is estimated at ${formatUsd(estimatedUsd)} but only ${formatUsd(remainingUsd)} ` +
        'of your budget is left. Raise the budget in Settings if you want to continue.',
    };
  }

  if (!approved) {
    return {
      decision: DECISION.NEEDS_APPROVAL,
      allowed: false,
      requiresApproval: true,
      estimatedUsd,
      remainingUsd,
      message:
        `This is a paid model. Estimated cost: about ${formatUsd(estimatedUsd)} ` +
        `(a rough guess, not a quote). You have ${formatUsd(remainingUsd)} of budget left.`,
    };
  }

  return {
    decision: DECISION.NEEDS_APPROVAL,
    allowed: true,
    requiresApproval: false,
    estimatedUsd,
    remainingUsd,
    message: `Approved. Estimated cost about ${formatUsd(estimatedUsd)}.`,
  };
}

export function formatUsd(value) {
  if (value == null || !Number.isFinite(value)) return 'an unknown amount';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * One line in the usage ledger. Written after every request, free or paid, so
 * that "what have I actually used" is answerable from real data rather than
 * from memory.
 */
export function makeLedgerEntry({ model, usage, latencyMs, estimatedUsd, outcome }) {
  const actualUsd = usage ? estimateCostUsd(model, {
    promptTokens: usage.promptTokens || 0,
    completionTokens: usage.completionTokens || 0,
  }) : null;
  return {
    ts: Date.now(),
    providerId: model?.providerId ?? null,
    modelId: model?.id ?? null,
    free: isFreeModel(model),
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    latencyMs: latencyMs ?? null,
    estimatedUsd: estimatedUsd ?? null,
    // null means "the provider did not tell us", not "zero".
    actualUsd,
    outcome: outcome || 'ok',
  };
}
