import { getLocalMessages, initDB } from './idb';
import { generateKey, exportKey, encryptData } from './crypto';

const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const LAST_SYNC_KEY = 'cove_last_sync';

export async function checkAndRunSync(workerUrl, uploadToken = null) {
    const lastSync = localStorage.getItem(LAST_SYNC_KEY);
    const now = Date.now();

    if (!lastSync || now - parseInt(lastSync, 10) > SYNC_INTERVAL_MS) {
        console.log("Triggering 12-hour automated Cloud Sync backup...");
        await performBackup(workerUrl, uploadToken);
    } else {
        console.log("Backup not needed yet. Next sync in:", (SYNC_INTERVAL_MS - (now - parseInt(lastSync, 10))) / 1000, "seconds");
    }
}

async function performBackup(workerUrl, uploadToken) {
    try {
        const db = await initDB();
        const tx = db.transaction(['messages', 'contacts'], 'readonly');
        const allMessages = await tx.objectStore('messages').getAll();
        const allContacts = await tx.objectStore('contacts').getAll();

        const plainData = JSON.stringify({
            version: 1,
            timestamp: Date.now(),
            messages: allMessages,
            contacts: allContacts
        });

        // We encrypt it with a newly generated backup key or the user's master key.
        // For now we'll create an ephemeral key for the blob and return the key to the user
        // or assume the user has a master password-derived key.
        const key = await generateKey();
        const encryptedPayload = await encryptData(key, plainData);

        // Convert to a File to use the existing worker upload endpoint
        const blob = new Blob([encryptedPayload], { type: 'application/octet-stream' });
        const file = new File([blob], `cove-backup-${Date.now()}.bin`, { type: 'application/octet-stream' });

        const filename = `backup-${Date.now()}.enc`;
        const headers = {
            'Content-Type': 'application/octet-stream',
            'X-Filename': filename,
        };

        if (uploadToken) {
            headers.Authorization = `Bearer ${uploadToken}`;
        }

        const res = await fetch(`${workerUrl}/upload`, {
            method: 'POST',
            headers,
            body: file
        });

        if (!res.ok) {
            throw new Error(`Backup upload failed: ${res.status}`);
        }

        const data = await res.json();
        console.log("Backup complete, Cloudflare Worker returned:", data.url);

        localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
    } catch (err) {
        console.error("Backup failed", err);
    }
}
