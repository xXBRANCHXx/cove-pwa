import forge from 'node-forge';

// Helper to encode/decode strings
const enc = new TextEncoder();
const dec = new TextDecoder();

// Basic AES-GCM (WebCrypto) for payload encryption (used in symmetric parts like backups)
export async function generateKey() {
    return await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

export async function exportKey(key) {
    const exported = await crypto.subtle.exportKey("raw", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importKey(base64Str) {
    const binaryString = atob(base64Str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return await crypto.subtle.importKey(
        "raw",
        bytes,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
    );
}

export async function encryptData(key, plainText) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = enc.encode(plainText);

    const cipherText = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encoded
    );

    const encryptedData = new Uint8Array(iv.length + cipherText.byteLength);
    encryptedData.set(iv, 0);
    encryptedData.set(new Uint8Array(cipherText), iv.length);

    return btoa(String.fromCharCode(...encryptedData));
}

export async function decryptData(key, base64Cipher) {
    try {
        const binaryString = atob(base64Cipher);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const iv = bytes.slice(0, 12);
        const cipherText = bytes.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            cipherText
        );
        return dec.decode(decrypted);
    } catch (err) {
        console.error("Decryption failed", err);
        return "[Encrypted Message]";
    }
}

// ----------------------------------------------------
// Asymmetric (RSA) using node-forge for P2P messaging
// ----------------------------------------------------

// Generate a 2048-bit RSA keypair (Async to avoid blocking UI)
export function generateRSAKeyPair() {
    return new Promise((resolve, reject) => {
        forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, function (err, keypair) {
            if (err) return reject(err);

            const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
            const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

            resolve({
                publicKey: publicKeyPem,
                privateKey: privateKeyPem
            });
        });
    });
}

// Encrypt payload (like message text or AES shared key) using the RECIPIENT'S public key
export function encryptWithPublicKey(publicKeyPem, text) {
    try {
        const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
        // Use RSA-OAEP for security
        const encrypted = publicKey.encrypt(forge.util.encodeUtf8(text), 'RSA-OAEP');
        return forge.util.encode64(encrypted);
    } catch (err) {
        console.error("RSA Encryption failed", err);
        throw err;
    }
}

// Decrypt payload using OUR private key
export function decryptWithPrivateKey(privateKeyPem, encryptedBase64) {
    try {
        const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
        const encryptedBytes = forge.util.decode64(encryptedBase64);
        const decryptedBytes = privateKey.decrypt(encryptedBytes, 'RSA-OAEP');
        return forge.util.decodeUtf8(decryptedBytes);
    } catch (err) {
        console.error("RSA Decryption failed", err);
        return "[Encrypted/Unreadable Message]";
    }
}

// ----------------------------------------------------
// Symmetrical local key storage (PBKDF2 + AES)
// Used to securely store the user's private key ON SERVER,
// locked by their password, so they don't lose it if they switch devices.
// ----------------------------------------------------

export function encryptPrivateKeyWithPassword(privateKeyPem, password) {
    const salt = forge.random.getBytesSync(16);
    // Derive key via PBKDF2
    const derivedKey = forge.pkcs5.pbkdf2(password, salt, 100000, 32);

    const iv = forge.random.getBytesSync(16);
    const cipher = forge.cipher.createCipher('AES-CBC', derivedKey);
    cipher.start({ iv: iv });
    cipher.update(forge.util.createBuffer(privateKeyPem, 'utf8'));
    cipher.finish();

    const encrypted = cipher.output.getBytes();

    // Pack salt + IV + encrypted data into one transport friendly base64 string
    const packed = salt + iv + encrypted;
    return forge.util.encode64(packed);
}

export function decryptPrivateKeyWithPassword(packedBase64, password) {
    const packed = forge.util.decode64(packedBase64);

    if (packed.length < 32) throw new Error("Invalid private key package");

    const salt = packed.substring(0, 16);
    const iv = packed.substring(16, 32);
    const encrypted = packed.substring(32);

    // Derive key via PBKDF2 the exact same way
    const derivedKey = forge.pkcs5.pbkdf2(password, salt, 100000, 32);

    const decipher = forge.cipher.createDecipher('AES-CBC', derivedKey);
    decipher.start({ iv: iv });
    decipher.update(forge.util.createBuffer(encrypted));
    const success = decipher.finish();

    if (!success) throw new Error("Failed to decrypt private key. Incorrect password?");

    return decipher.output.toString('utf8');
}

// ----------------------------------------------------
// Envelope Encryption for Messages (AES Payload + RSA Keys)
// ----------------------------------------------------

export async function encryptMessagePayloadForUsers(payloadJsonStr, participantsPublicKeysMap) {
    // 1. Generate a random AES key for this specific message
    const aesKeyStr = forge.random.getBytesSync(32);

    // 2. Encrypt the actual payload with the symmetric AES key
    const iv = forge.random.getBytesSync(12);
    const cipher = forge.cipher.createCipher('AES-GCM', aesKeyStr);
    cipher.start({ iv: iv });
    cipher.update(forge.util.createBuffer(payloadJsonStr, 'utf8'));
    cipher.finish();
    const encryptedPayload = forge.util.encode64(iv + cipher.output.getBytes() + cipher.mode.tag.getBytes());

    // 3. Encrypt the symmetric AES key using each participant's RSA public key
    const encryptedKeys = {};
    for (const [email, pubKeyPem] of Object.entries(participantsPublicKeysMap)) {
        if (!pubKeyPem) continue;
        try {
            const pubKey = forge.pki.publicKeyFromPem(pubKeyPem);
            const rsaEncrypted = pubKey.encrypt(aesKeyStr, 'RSA-OAEP');
            encryptedKeys[email] = forge.util.encode64(rsaEncrypted);
        } catch (e) {
            console.warn(`Could not encrypt message for ${email}`);
        }
    }

    return { encryptedPayload, encryptedKeys };
}

export async function decryptMessagePayload(encryptedPayloadBase64, encryptedKeysMap, userEmail, privateKeyPem) {
    try {
        const encryptedKeyForMeBase64 = encryptedKeysMap[userEmail.toLowerCase()];
        if (!encryptedKeyForMeBase64) return JSON.stringify({ text: "[Message not encrypted for you]" });

        // 1. Decrypt the AES key with my private key
        const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
        const aesKeyStr = privateKey.decrypt(forge.util.decode64(encryptedKeyForMeBase64), 'RSA-OAEP');

        // 2. Decrypt the payload with the AES key
        const payloadBytes = forge.util.decode64(encryptedPayloadBase64);
        const iv = payloadBytes.substring(0, 12);
        const ciphertext = payloadBytes.substring(12, payloadBytes.length - 16);
        const tag = payloadBytes.substring(payloadBytes.length - 16);

        const decipher = forge.cipher.createDecipher('AES-GCM', aesKeyStr);
        decipher.start({ iv: iv, tagLength: 128, tag: forge.util.createBuffer(tag) });
        decipher.update(forge.util.createBuffer(ciphertext));

        if (!decipher.finish()) {
            throw new Error("Message authentication failed (bad AES-GCM tag).");
        }
        return decipher.output.toString('utf8');
    } catch (e) {
        console.error("Failed to decrypt message payload", e);
        return JSON.stringify({ text: "[Encrypted or Corrupted Message]" });
    }
}
