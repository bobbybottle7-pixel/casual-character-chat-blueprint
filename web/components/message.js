import { renderMarkdown, escapeHtml } from '../lib/markdown.js';

const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

const TOOL_LABELS = {
  mcp__gm__roll_dice: 'rolled dice',
  mcp__gm__read_world_state: 'read world state',
  mcp__gm__update_world_state: 'updated world state',
  mcp__gm__advance_scene: 'advanced the scene',
  mcp__gm__adjust_stat: 'adjusted a stat',
  mcp__gm__update_inventory: 'updated inventory',
  mcp__gm__recall_lore: 'recalled lore',
  WebSearch: 'searched the web',
  WebFetch: 'fetched a page',
  Read: 'read a file',
  Write: 'wrote a file',
  Edit: 'edited a file',
  Bash: 'ran a command',
  Task: 'delegated to a subagent',
};

function toolSummary(name, input) {
  const label = TOOL_LABELS[name] ?? name;
  const detail =
    input?.query ?? input?.url ?? input?.file_path ?? input?.command ?? input?.notation ?? input?.description ?? '';
  return detail ? `${label} — ${String(detail).slice(0, 120)}` : label;
}

/** A user or assistant turn. Returns the node plus handles for live updating. */
export function createMessage(role, options = {}) {
  const wrap = el('article', `msg msg-${role}`);
  wrap.append(el('div', 'msg-role', role === 'user' ? 'You' : role === 'assistant' ? 'Claude' : ''));

  const think = el('details', 'think');
  think.append(el('summary', null, 'Thinking'));
  const thinkBody = el('div', 'think-body');
  think.append(thinkBody);
  think.hidden = true;
  if (options.showThinking !== false) wrap.append(think);

  const tools = el('div', 'msg-tools');
  wrap.append(tools);

  const body = el('div', 'msg-body');
  wrap.append(body);

  let text = '';
  let thinkText = '';
  const toolNodes = new Map();

  return {
    node: wrap,

    setText(next) {
      text = next;
      body.innerHTML = renderMarkdown(text);
    },
    appendText(delta) {
      text += delta;
      body.innerHTML = renderMarkdown(text);
    },
    appendThinking(delta) {
      thinkText += delta;
      think.hidden = false;
      thinkBody.textContent = thinkText;
    },
    setThinking(value) {
      if (!value) return;
      thinkText = value;
      think.hidden = false;
      thinkBody.textContent = value;
    },

    addTool(id, name, input) {
      // Dice get their own card: the whole point of the tool is that the number
      // did not come from the model, so it should not be buried in a log row.
      if (name === 'mcp__gm__roll_dice') return;

      const card = el('div', 'tool-card');
      const head = el('div', 'tool-card-head');
      head.append(el('span', 'tool-card-name', escapeHtml(toolSummary(name, input))));
      head.append(el('span', 'tool-card-status', 'running…'));
      card.append(head);
      tools.append(card);
      toolNodes.set(id, card);
    },
    resolveTool(id, isError, preview) {
      const card = toolNodes.get(id);
      if (!card) return;
      const status = card.querySelector('.tool-card-status');
      if (status) status.textContent = isError ? 'failed' : 'done';
      if (isError) card.classList.add('error');
      if (preview) {
        // Collapsed by default: a world-state dump or a file read should not
        // push the actual reply off screen. Errors open, because those are the
        // ones worth reading.
        const details = el('details', 'tool-card-output');
        const summary = el('summary', null, isError ? 'Error output' : 'Output');
        const pre = el('pre');
        pre.textContent = preview;
        details.append(summary, pre);
        details.open = isError;
        card.append(details);
      }
    },
    addRoll(roll) {
      const card = el('div', 'roll-card');
      card.append(el('span', 'roll-total', String(roll.total)));
      const mod = roll.modifier ? ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}` : '';
      card.append(
        el(
          'span',
          'roll-detail',
          `<b>${escapeHtml(roll.reason ?? 'Roll')}</b><br>${escapeHtml(roll.notation)} → [${roll.rolls.join(', ')}]${mod}`,
        ),
      );
      tools.append(card);
    },

    markStreaming(on) {
      wrap.classList.toggle('streaming', on);
    },
    get text() {
      return text;
    },
  };
}

export function createSystemNote(text) {
  return el('div', 'msg-system', escapeHtml(text));
}

export function createSceneDivider(text) {
  return el('div', 'scene-divider', escapeHtml(text));
}

export function createErrorBanner(message) {
  return el('div', 'error-banner', `<strong>Error:</strong> ${escapeHtml(message)}`);
}

/** Approve/deny card for a tool call that needs a decision. */
export function createApproval(request, onDecide) {
  const card = el('div', 'approval');
  card.append(el('h4', null, escapeHtml(request.prompt ?? `Claude wants to run ${request.toolName}`)));

  const pre = el('pre');
  pre.textContent = JSON.stringify(request.input, null, 2);
  card.append(pre);

  const actions = el('div', 'approval-actions');
  const allow = el('button', 'btn btn-primary btn-sm', 'Allow');
  const deny = el('button', 'btn btn-sm btn-danger', 'Deny');
  actions.append(allow, deny);
  card.append(actions);

  const decide = (value) => {
    allow.disabled = true;
    deny.disabled = true;
    card.append(el('div', 'empty', value ? 'Allowed.' : 'Denied.'));
    onDecide(value);
  };
  allow.addEventListener('click', () => decide(true));
  deny.addEventListener('click', () => decide(false));

  return card;
}
