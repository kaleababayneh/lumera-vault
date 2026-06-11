/**
 * Vault Module — certificate document lifecycle + local indexes.
 *
 * The certificate document (plaintext fields + salts + commitment) is
 * encrypted client-side with a random XChaCha20-Poly1305 key and stored
 * permanently on Lumera Cascade. The decryption key never touches the
 * backend — it travels only inside the #cert/ share link the school hands
 * to the student.
 *
 * Three localStorage indexes:
 *   • issuer book     — certificates this browser issued (school role)
 *   • student vault   — certificates imported from share links (student role)
 *   • proof history   — verify links produced by this browser
 */

import {
    encryptBytes,
    decryptBytes,
    generateDocumentKey,
} from './crypto';
import { uploadToCascade, downloadFromCascade } from './cascade';
import type { CertificateFields } from './midnight/encoding';
import {
    bytesToB64u,
    b64uToBytes,
    type CertShareLinkPayload,
} from './links';
import {
    ISSUED_INDEX_KEY,
    STUDENT_VAULT_KEY,
    PROOF_HISTORY_KEY,
} from './config';

// ── Cascade document format ──────────────────────────────────────────────────

/** Plaintext certificate document (this is what gets encrypted on Cascade). */
export interface CertificateDocument {
    v:               2;
    type:            'lumera-vault/academic-credential';
    title:           string;
    fields:          CertificateFields;
    /** base64url commitment salt (witness material). */
    salt:            string;
    /** base64url identity salt (preimage material for studentIdHash). */
    idSalt:          string;
    /** base64url commitment — must match the on-chain registration. */
    commitment:      string;
    contractAddress: string;
    issuedAt:        number;
}

interface EncryptedEnvelope {
    v:          2;
    alg:        'xchacha20-poly1305';
    nonce:      string;
    ciphertext: string;
}

export interface PublishResult {
    actionId:  string;
    txHash:    string;
    keyB64u:   string;
    sizeBytes: number;
}

/** Encrypt the document with a fresh key and inscribe it on Cascade. */
export async function publishCertificateDocument(
    doc:         CertificateDocument,
    onProgress?: (pct: number, label: string) => void,
): Promise<PublishResult> {
    onProgress?.(5, 'Encrypting certificate…');

    const documentKey = generateDocumentKey();
    const plaintext   = new TextEncoder().encode(JSON.stringify(doc));
    const blob        = encryptBytes(plaintext, documentKey);

    const envelope: EncryptedEnvelope = {
        v: 2,
        alg: 'xchacha20-poly1305',
        nonce: blob.nonce,
        ciphertext: blob.ciphertext,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(envelope));

    const safeTitle = doc.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const upload = await uploadToCascade(
        payloadBytes,
        `lumera_vault_cert_${safeTitle}.json.enc`,
        (pct, label) => onProgress?.(5 + Math.round(pct * 0.9), label),
    );

    onProgress?.(100, 'Stored on Cascade');
    return {
        actionId:  upload.actionId,
        txHash:    upload.txHash,
        keyB64u:   bytesToB64u(documentKey),
        sizeBytes: upload.sizeBytes,
    };
}

/** Download + decrypt + validate a certificate document from Cascade. */
export async function fetchCertificateDocument(
    actionId:    string,
    keyB64u:     string,
    onProgress?: (pct: number, label: string) => void,
): Promise<CertificateDocument> {
    const bytes = await downloadFromCascade(actionId, (pct, label) =>
        onProgress?.(Math.round(pct * 0.8), label),
    );

    onProgress?.(85, 'Decrypting…');

    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as EncryptedEnvelope;
    if (envelope.alg !== 'xchacha20-poly1305') {
        throw new Error('Unrecognized certificate envelope format');
    }

    const plaintext = decryptBytes(
        { ciphertext: envelope.ciphertext, nonce: envelope.nonce, algorithm: envelope.alg },
        b64uToBytes(keyB64u),
    );
    const doc = JSON.parse(new TextDecoder().decode(plaintext)) as CertificateDocument;
    if (doc.type !== 'lumera-vault/academic-credential') {
        throw new Error('Document is not a Lumera Vault academic credential');
    }

    onProgress?.(100, 'Certificate ready');
    return doc;
}

// ── localStorage helpers ─────────────────────────────────────────────────────

function loadList<T>(key: string): T[] {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
        return [];
    }
}

function saveList<T>(key: string, list: T[]): void {
    localStorage.setItem(key, JSON.stringify(list));
}

// ── Issuer book (school role) ────────────────────────────────────────────────

export interface IssuedRecord {
    title:       string;
    studentName: string;
    actionId:    string;
    commitment:  string; // base64url
    shareLink:   string;
    txHash:      string;
    issuedAt:    number;
    revoked:     boolean;
}

export function listIssued(): IssuedRecord[] {
    return loadList<IssuedRecord>(ISSUED_INDEX_KEY);
}

export function recordIssued(entry: IssuedRecord): void {
    const list = listIssued();
    list.unshift(entry);
    saveList(ISSUED_INDEX_KEY, list);
}

export function markIssuedRevoked(commitment: string): void {
    const list = listIssued().map(e =>
        e.commitment === commitment ? { ...e, revoked: true } : e,
    );
    saveList(ISSUED_INDEX_KEY, list);
}

// ── Student vault ────────────────────────────────────────────────────────────

export interface StudentCert {
    title:      string;
    actionId:   string;
    keyB64u:    string;
    doc:        CertificateDocument;
    importedAt: number;
}

export function listStudentCerts(): StudentCert[] {
    return loadList<StudentCert>(STUDENT_VAULT_KEY);
}

export function getStudentCert(actionId: string): StudentCert | null {
    return listStudentCerts().find(c => c.actionId === actionId) ?? null;
}

export function removeStudentCert(actionId: string): void {
    saveList(STUDENT_VAULT_KEY, listStudentCerts().filter(c => c.actionId !== actionId));
}

/** Import a certificate from a #cert/ share link payload. */
export async function importCertificateFromLink(
    payload:     CertShareLinkPayload,
    onProgress?: (pct: number, label: string) => void,
): Promise<StudentCert> {
    const existing = getStudentCert(payload.actionId);
    if (existing) return existing;

    const doc = await fetchCertificateDocument(payload.actionId, payload.key, onProgress);

    const cert: StudentCert = {
        title:      doc.title || payload.title || 'Academic Certificate',
        actionId:   payload.actionId,
        keyB64u:    payload.key,
        doc,
        importedAt: Date.now(),
    };
    const list = listStudentCerts();
    list.unshift(cert);
    saveList(STUDENT_VAULT_KEY, list);
    return cert;
}

// ── Proof history ────────────────────────────────────────────────────────────

export interface ProofHistoryEntry {
    description: string;
    certTitle:   string;
    link:        string;
    txHash:      string;
    when:        number;
}

export function listProofHistory(): ProofHistoryEntry[] {
    return loadList<ProofHistoryEntry>(PROOF_HISTORY_KEY);
}

export function addProofHistory(entry: ProofHistoryEntry): void {
    const list = listProofHistory();
    list.unshift(entry);
    saveList(PROOF_HISTORY_KEY, list);
}

export function removeProofHistory(txHash: string): void {
    saveList(PROOF_HISTORY_KEY, listProofHistory().filter(e => e.txHash !== txHash));
}
