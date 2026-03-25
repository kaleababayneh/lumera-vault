/**
 * Crypto Module — End-to-end encryption + commitment primitives
 * Uses libsodium XChaCha20-Poly1305 for encryption and BLAKE2b for ZK commitments.
 */

import sodium from 'libsodium-wrappers-sumo';

let sodiumReady = false;

export async function initCrypto(): Promise<void> {
    if (!sodiumReady) {
        await sodium.ready;
        sodiumReady = true;
    }
}

function assertReady(): void {
    if (!sodiumReady) throw new Error('Crypto not initialized. Call initCrypto() first.');
}

// ── Symmetric encryption ────────────────────────────────────────────────────

export interface EncryptedBlob {
    ciphertext: string; // base64
    nonce:      string; // base64
    algorithm:  'xchacha20-poly1305';
}

export function generateDocumentKey(): Uint8Array {
    assertReady();
    return sodium.crypto_secretbox_keygen();
}

export function encryptBytes(data: Uint8Array, key: Uint8Array): EncryptedBlob {
    assertReady();
    const nonce      = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(data, nonce, key);
    return {
        ciphertext: sodium.to_base64(ciphertext),
        nonce:      sodium.to_base64(nonce),
        algorithm:  'xchacha20-poly1305',
    };
}

export function decryptBytes(blob: EncryptedBlob, key: Uint8Array): Uint8Array {
    assertReady();
    const ciphertext = sodium.from_base64(blob.ciphertext);
    const nonce      = sodium.from_base64(blob.nonce);
    const plaintext  = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    if (!plaintext) throw new Error('Decryption failed — invalid key or corrupted data.');
    return plaintext;
}

// ── Key derivation ──────────────────────────────────────────────────────────

/**
 * Derive a deterministic encryption key from a wallet signature (BLAKE2b-256).
 * The same wallet + same message always produces the same key.
 */
export function deriveKeyFromSignature(signature: Uint8Array): Uint8Array {
    assertReady();
    return sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, signature);
}

/**
 * Encrypt a document key for owner storage.
 */
export function encryptKeyForOwner(
    documentKey: Uint8Array,
    ownerDerivedKey: Uint8Array
): { encryptedKey: string; nonce: string } {
    assertReady();
    const nonce        = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encryptedKey = sodium.crypto_secretbox_easy(documentKey, nonce, ownerDerivedKey);
    return {
        encryptedKey: sodium.to_base64(encryptedKey),
        nonce:        sodium.to_base64(nonce),
    };
}

export function decryptKeyForOwner(
    encryptedKey: string,
    nonce: string,
    ownerDerivedKey: Uint8Array
): Uint8Array {
    assertReady();
    const enc = sodium.from_base64(encryptedKey);
    const non = sodium.from_base64(nonce);
    const key = sodium.crypto_secretbox_open_easy(enc, non, ownerDerivedKey);
    if (!key) throw new Error('Failed to decrypt document key.');
    return key;
}

// ── Commitment primitives (used by Midnight simulation) ─────────────────────

/** Concatenate multiple byte arrays */
function concat(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out   = new Uint8Array(total);
    let offset  = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}

const te = new TextEncoder();

/**
 * BLAKE2b-256 hash of arbitrary data.
 */
export function blake2b256(data: Uint8Array): Uint8Array {
    assertReady();
    return sodium.crypto_generichash(32, data);
}

/**
 * BLAKE2b-256 hash of a string (UTF-8 encoded).
 */
export function blake2b256str(s: string): Uint8Array {
    return blake2b256(te.encode(s));
}

/**
 * Compute a document commitment: BLAKE2b(fields_json | owner_address | salt).
 * This is stored publicly; it irreversibly binds the claim to the document.
 */
export function computeDocumentCommitment(
    fields:       Record<string, unknown>,
    ownerAddress: string,
    salt:         Uint8Array
): string {
    assertReady();
    const fieldsBytes = te.encode(JSON.stringify(fields, Object.keys(fields).sort()));
    const ownerBytes  = te.encode(ownerAddress);
    const combined    = concat(fieldsBytes, ownerBytes, salt);
    return sodium.to_base64(blake2b256(combined));
}

/**
 * Generate a random 32-byte salt.
 */
export function randomSalt(): Uint8Array {
    assertReady();
    return sodium.randombytes_buf(32);
}

/**
 * Generate a random ID (8 hex bytes = 16 hex chars).
 */
export function randomId(): string {
    assertReady();
    return sodium.to_hex(sodium.randombytes_buf(8));
}

/** Encode Uint8Array to base64 */
export function toBase64(data: Uint8Array): string {
    assertReady();
    return sodium.to_base64(data);
}

/** Decode base64 to Uint8Array */
export function fromBase64(b64: string): Uint8Array {
    assertReady();
    return sodium.from_base64(b64);
}

/** Encode Uint8Array to hex */
export function toHex(data: Uint8Array): string {
    assertReady();
    return sodium.to_hex(data);
}

/** Concat helper (exported for midnight module) */
export { concat };
