/**
 * Vault Module — Document lifecycle management
 *
 * Handles upload, storage, retrieval, and indexing of vault documents.
 * Documents are:
 *   • Encrypted with keys derived from the owner's wallet signature
 *   • Stored permanently on Lumera's Cascade decentralized storage
 *   • Indexed in localStorage per wallet address for fast access
 */

import {
    initCrypto,
    generateDocumentKey,
    encryptBytes,
    decryptBytes,
    deriveKeyFromSignature,
    encryptKeyForOwner,
    decryptKeyForOwner,
    computeDocumentCommitment,
    randomSalt,
    randomId,
    toBase64,
    fromBase64,
} from './crypto';
import { signMessage, getConnectedAddress, isWalletConnected } from './wallet';
import {
    uploadToCascade,
    downloadFromCascade,
    isCascadeReady,
} from './cascade';
import { type SchemaType } from './schemas';
import { VAULT_INDEX_KEY_PREFIX } from './config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VaultDocument {
    /** Unique document ID (hex) */
    documentId:         string;
    /** Display title */
    title:              string;
    /** Document category */
    schemaType:         SchemaType;
    /** Document commitment (stored publicly with Cascade action) */
    documentCommitment: string; // base64
    /** Cascade action ID pointing to the encrypted document blob */
    cascadeActionId:    string;
    /** Encrypted document key (sealed with owner's derived key) */
    encryptedKey:       string; // base64
    /** Nonce for key decryption */
    keyNonce:           string; // base64
    /** Salt used to compute the document commitment (base64) */
    commitmentSalt:     string; // base64
    /** Owner wallet address */
    owner:              string;
    /** Upload timestamp (ms) */
    uploadedAt:         number;
    /** Approximate encrypted size in bytes */
    sizeBytes:          number;
}

/** Lightweight index entry stored in localStorage */
export interface VaultIndexEntry {
    documentId:         string;
    title:              string;
    schemaType:         SchemaType;
    documentCommitment: string;
    cascadeActionId:    string;
    encryptedKey:       string;
    keyNonce:           string;
    commitmentSalt:     string;
    owner:              string;
    uploadedAt:         number;
    sizeBytes:          number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SIGN_KEY_MSG = 'Lumera Vault: Derive document encryption key v1';

// ── Key management ────────────────────────────────────────────────────────────

let _cachedDerivedKey: Uint8Array | null = null;
let _keyDerivationPromise: Promise<Uint8Array> | null = null;

/** Derive (or return cached) the wallet-based encryption key. */
async function getDerivedKey(): Promise<Uint8Array> {
    if (_cachedDerivedKey) return _cachedDerivedKey;
    if (_keyDerivationPromise) return _keyDerivationPromise;

    // Store in a local variable so the caller always holds a valid reference
    // even after the `finally` block sets _keyDerivationPromise back to null.
    const p: Promise<Uint8Array> = (async () => {
        try {
            const sig = await signMessage(SIGN_KEY_MSG);
            const dk  = deriveKeyFromSignature(sig);
            _cachedDerivedKey = dk;
            return dk;
        } catch (err) {
            // Improve the error message for Keplr internal IDB / session errors
            const msg = String(err);
            if (
                msg.includes('IDBDatabase') ||
                msg.includes('InvalidStateError') ||
                msg.includes('closing') ||
                msg.includes('getActiveSessions')
            ) {
                throw new Error(
                    'Keplr wallet encountered an internal error. ' +
                    'Please reload the page, reconnect your wallet, and try again.'
                );
            }
            throw err;
        } finally {
            // Always clear — success or failure — so future calls try fresh.
            _keyDerivationPromise = null;
        }
    })();

    _keyDerivationPromise = p;
    return p;
}

/** Clear the cached derived key (call on wallet disconnect). */
export function clearDerivedKey(): void {
    _cachedDerivedKey     = null;
    _keyDerivationPromise = null;
}

/**
 * Pre-warm the vault encryption key.
 * Call after wallet connect so Keplr's signing prompt appears at a natural
 * moment rather than mid-proof-generation.
 */
export async function warmupVaultKey(): Promise<void> {
    await getDerivedKey();
}

// ── Vault index (localStorage) ────────────────────────────────────────────────

function indexKey(ownerAddress: string): string {
    return `${VAULT_INDEX_KEY_PREFIX}${ownerAddress}`;
}

function loadIndex(ownerAddress: string): VaultIndexEntry[] {
    try {
        const raw = localStorage.getItem(indexKey(ownerAddress));
        return raw ? (JSON.parse(raw) as VaultIndexEntry[]) : [];
    } catch {
        return [];
    }
}

function saveIndex(ownerAddress: string, entries: VaultIndexEntry[]): void {
    localStorage.setItem(indexKey(ownerAddress), JSON.stringify(entries));
}

function appendToIndex(ownerAddress: string, entry: VaultIndexEntry): void {
    const entries = loadIndex(ownerAddress);
    entries.push(entry);
    saveIndex(ownerAddress, entries);
}

function removeFromIndex(ownerAddress: string, documentId: string): void {
    const entries = loadIndex(ownerAddress).filter(e => e.documentId !== documentId);
    saveIndex(ownerAddress, entries);
}

// ── Initialisation ────────────────────────────────────────────────────────────

/** Must be called after wallet connect and Cascade initialisation. */
export async function initVault(): Promise<void> {
    await initCrypto();
    if (!isWalletConnected()) throw new Error('Wallet must be connected.');
}

// ── Upload ────────────────────────────────────────────────────────────────────

export interface UploadDocumentParams {
    title:       string;
    schemaType:  SchemaType;
    fields:      Record<string, unknown>;
    onProgress?: (pct: number, label: string) => void;
}

/**
 * Encrypt a document and upload it to Cascade permanent storage.
 * Returns the vault document metadata.
 */
export async function uploadDocument(
    p: UploadDocumentParams
): Promise<VaultDocument> {
    const owner = getConnectedAddress();
    if (!owner) throw new Error('Wallet not connected.');

    p.onProgress?.(5, 'Requesting signing key…');

    // 1. Derive owner key (triggers wallet signing prompt once)
    const ownerDerivedKey = await getDerivedKey();

    p.onProgress?.(15, 'Generating document encryption key…');

    // 2. Generate document-specific symmetric key
    const documentKey = generateDocumentKey();

    // 3. Encrypt the fields JSON
    const fieldsJson  = JSON.stringify(p.fields);
    const fieldsBytes = new TextEncoder().encode(fieldsJson);
    const encrypted   = encryptBytes(fieldsBytes, documentKey);

    // 4. Seal the document key with the owner's derived key
    const { encryptedKey, nonce: keyNonce } = encryptKeyForOwner(documentKey, ownerDerivedKey);

    p.onProgress?.(25, 'Computing document commitment…');

    // 5. Compute public commitment (stored alongside Cascade action)
    const salt           = randomSalt();
    const saltB64        = toBase64(salt);
    const commitment     = computeDocumentCommitment(p.fields, owner, salt);

    // 6. Build the Cascade payload (encrypted JSON + commitment metadata)
    const payload = {
        version:            1,
        schemaType:         p.schemaType,
        commitment,
        encryptedFields:    encrypted,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

    p.onProgress?.(35, 'Uploading to Cascade…');

    // 7. Upload to Cascade
    let cascadeActionId: string;

    if (isCascadeReady()) {
        const safeTitle    = p.title.replace(/[^a-zA-Z0-9_-]/g, '_');
        cascadeActionId    = await uploadToCascade(
            payloadBytes,
            `vault_${p.schemaType}_${safeTitle}.enc`,
            false, // private
            pct => p.onProgress?.(35 + Math.round(pct * 0.55), 'Uploading to Cascade…')
        );
    } else {
        // Fallback: store in localStorage (no Cascade available in offline mode)
        const documentId = randomId();
        cascadeActionId  = `local_${documentId}`;
        localStorage.setItem(
            `lumera_vault_blob_${cascadeActionId}`,
            toBase64(payloadBytes)
        );
        console.warn('Cascade unavailable — stored locally. Connect wallet to upload to permanent storage.');
    }

    p.onProgress?.(92, 'Indexing document…');

    // 8. Build and persist index entry
    const documentId = randomId();
    const entry: VaultIndexEntry = {
        documentId,
        title:              p.title,
        schemaType:         p.schemaType,
        documentCommitment: commitment,
        cascadeActionId,
        encryptedKey,
        keyNonce,
        commitmentSalt:     saltB64,
        owner,
        uploadedAt:         Date.now(),
        sizeBytes:          payloadBytes.length,
    };

    appendToIndex(owner, entry);

    p.onProgress?.(100, 'Done');

    return { ...entry };
}

// ── List ──────────────────────────────────────────────────────────────────────

/** Return all documents in the vault for the connected wallet. */
export function listDocuments(): VaultDocument[] {
    const owner = getConnectedAddress();
    if (!owner) return [];
    return loadIndex(owner).map(e => ({ ...e }));
}

/** Get a single document by ID. */
export function getDocument(documentId: string): VaultDocument | null {
    const owner = getConnectedAddress();
    if (!owner) return null;
    return loadIndex(owner).find(e => e.documentId === documentId) ?? null;
}

// ── Download & decrypt ────────────────────────────────────────────────────────

/**
 * Download and decrypt the plaintext fields for a vault document.
 * Requires wallet to derive the decryption key.
 */
export async function decryptDocumentFields(
    doc:         VaultDocument,
    onProgress?: (pct: number, label: string) => void
): Promise<Record<string, unknown>> {
    onProgress?.(5, 'Requesting decryption key…');

    const ownerDerivedKey = await getDerivedKey();

    onProgress?.(20, 'Decrypting document key…');

    // 1. Recover document key
    const documentKey = decryptKeyForOwner(doc.encryptedKey, doc.keyNonce, ownerDerivedKey);

    // 2. Download encrypted payload
    let payloadBytes: Uint8Array;

    if (doc.cascadeActionId.startsWith('local_')) {
        const b64 = localStorage.getItem(`lumera_vault_blob_${doc.cascadeActionId}`);
        if (!b64) throw new Error('Local document blob not found.');
        payloadBytes = fromBase64(b64);
    } else {
        onProgress?.(30, 'Downloading from Cascade…');
        payloadBytes = await downloadFromCascade(
            doc.cascadeActionId,
            pct => onProgress?.(30 + Math.round(pct * 0.5), 'Downloading…')
        );
    }

    onProgress?.(82, 'Decrypting fields…');

    // 3. Parse payload
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload     = JSON.parse(payloadJson) as {
        encryptedFields: { ciphertext: string; nonce: string; algorithm: 'xchacha20-poly1305' };
    };

    // 4. Decrypt fields
    const fieldsBytes = decryptBytes(payload.encryptedFields, documentKey);
    const fieldsJson  = new TextDecoder().decode(fieldsBytes);

    onProgress?.(100, 'Done');

    return JSON.parse(fieldsJson) as Record<string, unknown>;
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Remove a document from the vault index.
 * Note: the Cascade entry is permanent and cannot be deleted
 * (this is by design — immutability is a feature).
 */
export function deleteDocument(documentId: string): void {
    const owner = getConnectedAddress();
    if (!owner) return;
    removeFromIndex(owner, documentId);
}
