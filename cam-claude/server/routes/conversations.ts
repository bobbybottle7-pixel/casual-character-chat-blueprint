import { Router } from 'express';
import { getMode, listModeSummaries, requireMode } from '../modes/index.js';
import { getRunner, invalidatePrompt, peekRunner, restart } from '../agent/manager.js';
import type { CamEvent } from '../agent/events.js';
import {
  addMemory,
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getWorld,
  listConversations,
  listGmEvents,
  listMemories,
  listMessages,
  setConversationCharacters,
  updateConversation,
} from '../store/repo.js';
import type { ReplyKind } from '../modes/types.js';

export const conversationRoutes = Router();

conversationRoutes.get('/modes', (_req, res) => {
  res.json(listModeSummaries());
});

conversationRoutes.get('/conversations', (_req, res) => {
  res.json(listConversations());
});

conversationRoutes.post('/conversations', (req, res) => {
  const { modeId, title, cwd, characterIds, personaId } = req.body ?? {};
  if (!getMode(modeId)) {
    res.status(400).json({ error: `Unknown mode: ${modeId}` });
    return;
  }
  const conv = createConversation(modeId, { title, cwd });
  if (Array.isArray(characterIds) && characterIds.length) {
    setConversationCharacters(conv.id, characterIds);
  }
  if (personaId) updateConversation(conv.id, { persona_id: personaId });
  res.status(201).json(getConversation(conv.id));
});

conversationRoutes.get('/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({
    conversation: conv,
    messages: listMessages(conv.id),
    world: getWorld(conv.id),
    memories: listMemories(conv.id),
    gmEvents: listGmEvents(conv.id),
  });
});

conversationRoutes.patch('/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { title, cwd, personaId, characterIds, modeId } = req.body ?? {};

  if (modeId !== undefined && modeId !== conv.mode_id && !getMode(modeId)) {
    res.status(400).json({ error: `Unknown mode: ${modeId}` });
    return;
  }

  // The title is the one field the prompt is not built from, so changing it
  // alone must not throw away the session.
  if (title !== undefined) updateConversation(conv.id, { title });
  if (cwd !== undefined) updateConversation(conv.id, { cwd });
  if (personaId !== undefined) updateConversation(conv.id, { persona_id: personaId });
  if (Array.isArray(characterIds)) setConversationCharacters(conv.id, characterIds);

  const switchingMode = modeId !== undefined && modeId !== conv.mode_id;
  if (switchingMode) {
    updateConversation(conv.id, { mode_id: modeId });
    // A visible divider, so a mode change is never silent.
    addMessage({
      conversationId: conv.id,
      role: 'system',
      text: `Switched from ${requireMode(conv.mode_id).label} to ${requireMode(modeId).label}.`,
    });
  }

  const reason = switchingMode
    ? `it just switched from ${requireMode(conv.mode_id).label} mode to ${requireMode(modeId).label} mode`
    : 'its setup was changed';

  if (switchingMode || cwd !== undefined || personaId !== undefined || Array.isArray(characterIds)) {
    invalidatePrompt(conv.id, reason);
  }

  res.json(getConversation(conv.id));
});

conversationRoutes.delete('/conversations/:id', (req, res) => {
  restart(req.params.id);
  deleteConversation(req.params.id);
  res.status(204).end();
});

/** Server-sent events for one conversation's live session. */
conversationRoutes.get('/conversations/:id/stream', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const runner = getRunner(conv.id);
  const send = (event: CamEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const unsubscribe = runner.subscribe(send);

  // Proxies and browsers drop an idle event stream; this keeps it open.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

conversationRoutes.post('/conversations/:id/messages', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const text: string = req.body?.text ?? '';
  const replyKind: ReplyKind | undefined = req.body?.replyKind;
  const images = Array.isArray(req.body?.images) ? req.body.images : undefined;

  if (!text.trim() && !images?.length) {
    res.status(400).json({ error: 'Message is empty.' });
    return;
  }

  const row = addMessage({
    conversationId: conv.id,
    role: 'user',
    text,
    replyKind: replyKind ?? null,
  });

  try {
    const runner = getRunner(conv.id);
    runner.send(text, { ...(replyKind ? { replyKind } : {}), ...(images ? { images } : {}) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    return;
  }

  // Title the conversation from its first message rather than leaving a list of
  // identical "New conversation" rows.
  if (conv.title === 'New conversation' && text.trim()) {
    const title = text.trim().slice(0, 60).replace(/\s+/g, ' ');
    updateConversation(conv.id, { title });
  }

  res.status(202).json(row);
});

conversationRoutes.post('/conversations/:id/interrupt', async (req, res) => {
  await peekRunner(req.params.id)?.interrupt();
  res.status(204).end();
});

conversationRoutes.post('/conversations/:id/permissions/:permissionId', (req, res) => {
  const runner = peekRunner(req.params.id);
  const handled = runner?.resolvePermission(req.params.permissionId, Boolean(req.body?.allow));
  if (!handled) {
    res.status(404).json({ error: 'No pending permission request with that id.' });
    return;
  }
  res.status(204).end();
});

conversationRoutes.get('/conversations/:id/world', (req, res) => {
  res.json(getWorld(req.params.id));
});

conversationRoutes.post('/conversations/:id/memories', (req, res) => {
  const text: string = req.body?.text ?? '';
  if (!text.trim()) {
    res.status(400).json({ error: 'Memory text is empty.' });
    return;
  }
  addMemory(req.params.id, req.body?.kind === 'auto' ? 'auto' : 'pinned', text.trim());
  invalidatePrompt(req.params.id, 'a new memory was added');
  res.status(201).json(listMemories(req.params.id));
});

