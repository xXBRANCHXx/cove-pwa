import { openDB } from 'idb';

const DB_NAME = 'cove-local';
const STORE_MESSAGES = 'messages';
const STORE_CONTACTS = 'contacts';
const STORE_KV = 'kv';

export async function initDB() {
    return openDB(DB_NAME, 2, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
                const msgs = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
                msgs.createIndex('chatId', 'chatId');
                msgs.createIndex('timestamp', 'timestamp');
            }
            if (!db.objectStoreNames.contains(STORE_CONTACTS)) {
                db.createObjectStore(STORE_CONTACTS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_KV)) {
                db.createObjectStore(STORE_KV, { keyPath: 'key' });
            }
        },
    });
}

export async function saveMessageLocal(msg) {
    const db = await initDB();
    await db.put(STORE_MESSAGES, msg);
}

export async function getLocalMessages(chatId) {
    const db = await initDB();
    const tx = db.transaction(STORE_MESSAGES, 'readonly');
    const index = tx.store.index('chatId');
    return index.getAll(chatId);
}

export async function setLocalKV(key, value) {
    if (!key) return;
    const db = await initDB();
    await db.put(STORE_KV, {
        key,
        value,
        updatedAt: Date.now()
    });
}

export async function getLocalKV(key) {
    if (!key) return null;
    const db = await initDB();
    const row = await db.get(STORE_KV, key);
    return row?.value ?? null;
}
