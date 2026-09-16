/** Thin fetch wrapper. Every failure surfaces the server's message, not "fetch failed". */
async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the status line when the body is not JSON.
    }
    throw new Error(message);
  }

  return response.status === 204 ? null : response.json();
}

export const api = {
  health: () => request('GET', '/api/health'),
  modes: () => request('GET', '/api/modes'),

  listConversations: () => request('GET', '/api/conversations'),
  createConversation: (payload) => request('POST', '/api/conversations', payload),
  getConversation: (id) => request('GET', `/api/conversations/${id}`),
  updateConversation: (id, patch) => request('PATCH', `/api/conversations/${id}`, patch),
  deleteConversation: (id) => request('DELETE', `/api/conversations/${id}`),

  sendMessage: (id, payload) => request('POST', `/api/conversations/${id}/messages`, payload),
  interrupt: (id) => request('POST', `/api/conversations/${id}/interrupt`, {}),
  resolvePermission: (id, permissionId, allow) =>
    request('POST', `/api/conversations/${id}/permissions/${permissionId}`, { allow }),

  listCharacters: () => request('GET', '/api/characters'),
  listPersonas: () => request('GET', '/api/personas'),
  createPersona: (payload) => request('POST', '/api/personas', payload),
  deleteCharacter: (id) => request('DELETE', `/api/characters/${id}`),
  importFile: (filename, base64) => request('POST', '/api/import', { filename, base64 }),
};
