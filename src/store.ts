// IndexedDB snapshot store. A late-week world serializes to several
// megabytes — past localStorage quotas — so snapshots live in IDB.
// Failures degrade silently: the page then just replays from tick 0,
// exactly as it did before caching existed.

const DB_NAME = 'living-world';
const STORE = 'snapshots';
const KEY = 'world';

export interface Snapshot {
  seed: number;
  age: number;
  savedAt: number;
  tickCount: number; // duplicated out of `state` so freshness checks skip the big parse
  state: string; // Sim.serialize() payload (includes tickCount + RNG state)
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v && typeof v.state === 'string' && typeof v.seed === 'number' ? (v as Snapshot) : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveSnapshot(snap: Snapshot): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snap, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
