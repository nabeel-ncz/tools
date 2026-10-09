// Local persistence for Shared Notepad: chats and images live only in this
// browser (IndexedDB). Nothing here is ever sent to a server.

export interface Peer {
  key: string;
  nickname?: string;
  theirName?: string;
  /** Chat is allowed to connect. False while it is a pending incoming request. */
  accepted: boolean;
  /** I declined their request; ignore further requests from this key. */
  declined?: boolean;
  /** Pairing token from their share link — lets them connect without asking me. */
  tok?: string;
  addedAt: number;
  lastTs: number;
  unread: number;
}

export interface Msg {
  id: string;
  peer: string;
  ts: number;
  dir: 'in' | 'out';
  kind: 'text' | 'image';
  text?: string;
  blob?: Blob;
  mime?: string;
  name?: string;
  status: 'queued' | 'sent' | 'delivered' | 'received';
}

const DB_NAME = 'nabl-shared-notepad';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('peers', { keyPath: 'key' });
      db.createObjectStore('msgs', { keyPath: 'id' }).createIndex('peer', 'peer');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(store: 'peers' | 'msgs', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(store, mode);
          const req = fn(tx.objectStore(store));
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function loadAll(): Promise<{ peers: Peer[]; msgs: Msg[] }> {
  const peers = ((await run<Peer[]>('peers', 'readonly', (s) => s.getAll())) ?? []) as Peer[];
  const msgs = ((await run<Msg[]>('msgs', 'readonly', (s) => s.getAll())) ?? []) as Msg[];
  return { peers, msgs };
}

// Records arrive here as reactive proxies; a shallow spread yields a plain,
// structured-clone-safe object (Blob fields stay as real Blobs).
export const putPeer = (p: Peer) => run('peers', 'readwrite', (s) => s.put({ ...p }));
export const putMsg = (m: Msg) => run('msgs', 'readwrite', (s) => s.put({ ...m }));

export async function delPeer(key: string): Promise<void> {
  await run('peers', 'readwrite', (s) => s.delete(key));
  await delMsgsFor(key);
}

export function delMsgsFor(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
          const tx = db.transaction('msgs', 'readwrite');
          const idx = tx.objectStore('msgs').index('peer');
          const cur = idx.openKeyCursor(IDBKeyRange.only(key));
          cur.onsuccess = () => {
            const c = cur.result;
            if (c) {
              tx.objectStore('msgs').delete(c.primaryKey);
              c.continue();
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

// ---- Small localStorage helpers (identity), tolerant of blocked storage ----

const memory = new Map<string, string>();

export function lsGet(name: string): string | null {
  try {
    return localStorage.getItem(name);
  } catch {
    return memory.get(name) ?? null;
  }
}

export function lsSet(name: string, value: string) {
  try {
    localStorage.setItem(name, value);
  } catch {
    memory.set(name, value);
  }
}
