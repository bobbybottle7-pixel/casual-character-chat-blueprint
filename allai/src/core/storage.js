/* ===========================================================================
 * ALLAI — storage
 *
 * Everything ALLAI knows lives in IndexedDB, which is a database built into
 * the phone's browser. Nothing is uploaded anywhere. Clearing the browser's
 * site data for ALLAI deletes all of it, which is also how "delete everything"
 * is implemented.
 *
 * The stores are kept separate on purpose, because the spec draws a hard line
 * between kinds of memory and that line should exist in the data too:
 *
 *   settings       one row per setting. Includes provider keys.
 *   conversations  chat threads and their messages. History, not memory.
 *   memories       permanent, user-controlled facts. Survives conversations.
 *   characters     AI personalities, stored as data rather than code.
 *   ledger         one row per request made, for the budget screen.
 *
 * "Temporary context" — the third memory kind — deliberately has no store.
 * It lives in memory for the length of a session and is gone when the tab
 * closes. That is what makes it temporary.
 * ======================================================================== */

const DB_NAME = 'allai';
const DB_VERSION = 1;

export const STORES = Object.freeze({
  SETTINGS: 'settings',
  CONVERSATIONS: 'conversations',
  MEMORIES: 'memories',
  CHARACTERS: 'characters',
  LEDGER: 'ledger',
});

let dbPromise = null;

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so ALLAI cannot save anything.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORES.SETTINGS)) db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
        const store = db.createObjectStore(STORES.CONVERSATIONS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORES.MEMORIES)) {
        const store = db.createObjectStore(STORES.MEMORIES, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORES.CHARACTERS)) db.createObjectStore(STORES.CHARACTERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.LEDGER)) {
        const store = db.createObjectStore(STORES.LEDGER, { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open ALLAI storage.'));
  });
  return dbPromise;
}

function run(storeName, mode, work) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = work(store); } catch (err) { reject(err); return; }
    tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const wrap = (req) => ({ __req: req });

export const put = (storeName, value) => run(storeName, 'readwrite', s => wrap(s.put(value)));
export const remove = (storeName, key) => run(storeName, 'readwrite', s => wrap(s.delete(key)));
export const clearStore = (storeName) => run(storeName, 'readwrite', s => wrap(s.clear()));
export const getOne = (storeName, key) => run(storeName, 'readonly', s => wrap(s.get(key)));
export const getAll = (storeName) => run(storeName, 'readonly', s => wrap(s.getAll()));

/* --- settings -------------------------------------------------------------
 * Provider API keys live here. Two things ALLAI must never do with them:
 * print one into a log, or show one in full on screen. maskKey() is the only
 * approved way to display a key.
 */
export async function getSetting(key, fallback = null) {
  const row = await getOne(STORES.SETTINGS, key);
  return row === undefined || row === null ? fallback : row.value;
}

export async function setSetting(key, value) {
  await put(STORES.SETTINGS, { key, value });
  return value;
}

export async function getAllSettings() {
  const rows = await getAll(STORES.SETTINGS);
  return Object.fromEntries((rows || []).map(r => [r.key, r.value]));
}

/** Shows enough of a key to recognise it, never enough to use it. */
export function maskKey(key) {
  const k = String(key || '');
  if (!k) return '(not set)';
  if (k.length <= 8) return '••••';
  return `${k.slice(0, 4)}••••••${k.slice(-4)}`;
}

/** Wipes everything. Used by the "delete all my data" button in Settings. */
export async function deleteEverything() {
  for (const name of Object.values(STORES)) await clearStore(name);
}
