import { api } from '../lib/api.js';
import { escapeHtml } from '../lib/markdown.js';

const $ = (id) => document.getElementById(id);

/* -------------------------------- mode picker ------------------------------ */

/**
 * The picker serves two different intents: the mode chip moves the open
 * conversation to another mode, while "New chat" starts a fresh one. They used
 * to share a callback, which made "New chat" silently convert the conversation
 * you were already in.
 */
export function initModePicker(modes, onPick) {
  const sheet = $('mode-sheet');
  const grid = $('mode-grid');
  const heading = sheet.querySelector('h3');
  let intent = 'new';

  $('mode-chip').addEventListener('click', () => open(currentModeId, 'switch'));

  let currentModeId = null;

  const render = (currentId) => {
    grid.replaceChildren();
    for (const mode of modes) {
      const card = document.createElement('button');
      card.className = 'mode-card';
      card.type = 'button';
      card.setAttribute('aria-current', String(mode.id === currentId));
      card.innerHTML = `
        <span class="mode-card-icon">${mode.icon}</span>
        <span>
          <span class="mode-card-label">${escapeHtml(mode.label)}</span>
          <span class="mode-card-blurb">${escapeHtml(mode.blurb)}</span>
        </span>`;
      card.addEventListener('click', () => {
        sheet.close();
        onPick(mode, intent);
      });
      grid.append(card);
    }
  };

  function open(currentId, nextIntent = 'new') {
    currentModeId = currentId ?? null;
    intent = nextIntent;
    heading.textContent = nextIntent === 'switch' ? 'Switch mode' : 'New chat';
    render(currentId);
    sheet.showModal();
  }

  return { open, render };
}

/* ---------------------------------- library -------------------------------- */

export function initLibrary(onChange) {
  const sheet = $('library-sheet');
  const fileInput = $('import-file');
  const drop = $('file-drop');

  $('open-library').addEventListener('click', () => open());

  async function refresh() {
    const [characters, personas] = await Promise.all([api.listCharacters(), api.listPersonas()]);

    const charList = $('character-list');
    charList.replaceChildren();
    if (!characters.length) charList.innerHTML = '<li class="empty">No characters yet.</li>';
    for (const character of characters) {
      const li = document.createElement('li');
      li.innerHTML = `
        ${character.avatar ? `<img src="${escapeHtml(character.avatar)}" alt="">` : ''}
        <span>${escapeHtml(character.name)}</span>`;
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost btn-sm btn-danger';
      remove.textContent = '✕';
      remove.addEventListener('click', async () => {
        await api.deleteCharacter(character.id);
        await refresh();
        onChange?.();
      });
      li.append(remove);
      charList.append(li);
    }

    const personaList = $('persona-list');
    personaList.replaceChildren();
    if (!personas.length) personaList.innerHTML = '<li class="empty">No personas yet.</li>';
    for (const persona of personas) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(persona.name)}</span>`;
      personaList.append(li);
    }

    const add = document.createElement('button');
    add.className = 'btn btn-ghost btn-sm';
    add.textContent = '+ New persona';
    add.addEventListener('click', async () => {
      const name = prompt('Persona name — who are you playing?');
      if (!name?.trim()) return;
      const description = prompt('A line or two about them (optional)') ?? '';
      await api.createPersona({ name: name.trim(), description: description.trim() });
      await refresh();
      onChange?.();
    });
    personaList.append(add);

    return { characters, personas };
  }

  async function importFile(file) {
    if (!file) return;
    const base64 = await fileToBase64(file);
    try {
      const result = await api.importFile(file.name, base64);
      const count = (result.characters?.length ?? 0) + (result.personas?.length ?? 0);
      await refresh();
      onChange?.();
      alert(count ? `Imported ${count} item${count === 1 ? '' : 's'}.` : 'Nothing to import from that file.');
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    }
  }

  fileInput.addEventListener('change', () => importFile(fileInput.files?.[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    importFile(e.dataTransfer?.files?.[0]);
  });

  async function open() {
    await refresh();
    sheet.showModal();
  }

  return { open, refresh };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------ conversation setup ------------------------- */

/**
 * Modes with extra inputs ask for them before the conversation starts, rather
 * than failing on the first message because no folder or character was chosen.
 */
export function initSetup() {
  const sheet = $('setup-sheet');
  const body = $('setup-body');
  const confirm = $('setup-confirm');

  return {
    /** Resolves with a payload patch, or null if the user cancelled. */
    async collect(mode) {
      if (mode.id === 'roleplay') {
        const [characters, personas] = await Promise.all([api.listCharacters(), api.listPersonas()]);
        if (!characters.length) {
          alert('Import a character card first — open Characters in the bottom left.');
          return null;
        }
        body.innerHTML = `
          <label class="field">
            <span>Who is Claude playing? (ctrl-click for several)</span>
            <select id="setup-characters" multiple size="${Math.min(characters.length, 6)}">
              ${characters.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Who are you playing?</span>
            <select id="setup-persona">
              <option value="">Just me</option>
              ${personas.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </label>`;
      } else if (mode.id === 'code') {
        body.innerHTML = `
          <label class="field">
            <span>Project folder — an absolute path on this machine</span>
            <input id="setup-cwd" placeholder="/Users/you/projects/thing" value="${escapeHtml(lastCwd())}">
          </label>
          <p class="sheet-sub">Claude reads and edits inside this folder. Writes and commands ask you first.</p>`;
      } else {
        return {};
      }

      sheet.showModal();
      return new Promise((resolve) => {
        const onConfirm = () => {
          cleanup();
          if (mode.id === 'roleplay') {
            const select = $('setup-characters');
            const characterIds = [...select.selectedOptions].map((o) => o.value);
            if (!characterIds.length) {
              alert('Pick at least one character.');
              resolve(null);
              return;
            }
            resolve({ characterIds, personaId: $('setup-persona').value || undefined });
          } else {
            const cwd = $('setup-cwd').value.trim();
            if (!cwd) {
              alert('Enter a folder path.');
              resolve(null);
              return;
            }
            localStorage.setItem('camClaude.lastCwd', cwd);
            resolve({ cwd });
          }
          sheet.close();
        };
        const onCancel = () => {
          cleanup();
          resolve(null);
        };
        const cleanup = () => {
          confirm.removeEventListener('click', onConfirm);
          sheet.removeEventListener('close', onCancel);
        };
        confirm.addEventListener('click', onConfirm);
        sheet.addEventListener('close', onCancel, { once: true });
      });
    },
  };
}

function lastCwd() {
  try {
    return localStorage.getItem('camClaude.lastCwd') ?? '';
  } catch {
    return '';
  }
}
