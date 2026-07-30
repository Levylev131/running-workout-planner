// IndexedDB layer — single "sessions" store.
const DB_NAME = "running-workout-planner";
const DB_VERSION = 1;

function uid() {
  // crypto.randomUUID() requires a secure context (HTTPS or localhost) — falls back
  // to a manual v4 UUID so this still works over plain HTTP on a phone via LAN IP.
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", { keyPath: "id" });
        s.createIndex("date", "date");
        s.createIndex("status", "status");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = openDB();

function tx(storeName, mode) {
  return dbPromise.then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const store = await tx(storeName, "readonly");
  return wrap(store.getAll());
}

async function put(storeName, value) {
  const store = await tx(storeName, "readwrite");
  return wrap(store.put(value));
}

async function remove(storeName, id) {
  const store = await tx(storeName, "readwrite");
  return wrap(store.delete(id));
}

async function clear(storeName) {
  const store = await tx(storeName, "readwrite");
  return wrap(store.clear());
}

const Sessions = {
  all: () => getAll("sessions"),
  upsert: (session) => put("sessions", session),
  remove: (id) => remove("sessions", id),
  clear: () => clear("sessions"),
};

window.DB = { uid, Sessions };
