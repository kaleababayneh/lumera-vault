/**
 * Proof Module — Generate, store, and retrieve ZK proofs
 *
 * Thin orchestration layer on top of midnight.ts + vault.ts.
 */

import {
    generateMidnightProof,
    type MidnightProof,
    type VerificationResult,
    buildProofLink,
    serializeProof,
    verifyMidnightProof,
} from './midnight';
import {
    getDocument,
    decryptDocumentFields,
    type VaultDocument,
} from './vault';
import { type SchemaType } from './schemas';
import {
    getConnectedAddress,
    isWalletConnected,
} from './wallet';
import { PROOFS_KEY_PREFIX, DUST_BALANCE_KEY, DUST_PER_PROOF, INITIAL_DUST_BALANCE } from './config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProofRecord {
    proof:       MidnightProof;
    proofLink:   string;
    generatedAt: number;
    documentId:  string;
    documentTitle: string;
}

// ── DUST balance ──────────────────────────────────────────────────────────────

export function getDustBalance(ownerAddress: string): number {
    const raw = localStorage.getItem(`${DUST_BALANCE_KEY}_${ownerAddress}`);
    return raw !== null ? Number(raw) : INITIAL_DUST_BALANCE;
}

function deductDust(ownerAddress: string): void {
    const current = getDustBalance(ownerAddress);
    const updated = Math.max(0, current - DUST_PER_PROOF);
    localStorage.setItem(`${DUST_BALANCE_KEY}_${ownerAddress}`, String(updated));
}

// ── Proof registry (localStorage) ────────────────────────────────────────────

function proofsKey(ownerAddress: string): string {
    return `${PROOFS_KEY_PREFIX}${ownerAddress}`;
}

function loadProofRegistry(ownerAddress: string): ProofRecord[] {
    try {
        const raw = localStorage.getItem(proofsKey(ownerAddress));
        return raw ? (JSON.parse(raw) as ProofRecord[]) : [];
    } catch {
        return [];
    }
}

function saveProofRegistry(ownerAddress: string, records: ProofRecord[]): void {
    localStorage.setItem(proofsKey(ownerAddress), JSON.stringify(records));
}

// ── Generate ──────────────────────────────────────────────────────────────────

export interface GenerateProofRequest {
    documentId:   string;
    claimType:    string;
    claimParams:  Record<string, unknown>;
    expiresInMs?: number | null;
    onProgress?:  (pct: number, label: string) => void;
}

export interface GenerateProofResult {
    proof:      MidnightProof;
    proofLink:  string;
    serialized: string;
}

/**
 * Orchestrate ZK proof generation for a vault document.
 * 1. Look up and decrypt the document
 * 2. Run the Midnight circuit
 * 3. Persist proof record
 * 4. Deduct DUST fee
 */
export async function generateProof(
    req: GenerateProofRequest
): Promise<GenerateProofResult> {
    if (!isWalletConnected()) throw new Error('Wallet not connected.');

    const owner = getConnectedAddress()!;

    req.onProgress?.(2, 'Looking up document…');

    const doc = getDocument(req.documentId);
    if (!doc) throw new Error(`Document not found: ${req.documentId}`);

    req.onProgress?.(5, 'Decrypting document fields…');

    // Decrypt to get plaintext fields (stays on device, never sent)
    const fields = await decryptDocumentFields(
        doc,
        (pct, label) => req.onProgress?.(5 + Math.round(pct * 0.5), label)
    );

    req.onProgress?.(56, 'Running Midnight circuit proof generation…');

    const midnightProof = await generateMidnightProof({
        fields,
        documentSalt:       doc.commitmentSalt,
        documentCommitment: doc.documentCommitment,
        schemaType:         doc.schemaType as SchemaType,
        claimType:          req.claimType,
        claimParams:        req.claimParams,
        ownerAddress:       owner,
        expiresInMs:        req.expiresInMs ?? null,
    });

    req.onProgress?.(85, 'Serializing proof for sharing…');

    const proofLink  = buildProofLink(midnightProof);
    const serialized = serializeProof(midnightProof);

    req.onProgress?.(90, 'Saving to proof registry…');

    // Persist
    const records = loadProofRegistry(owner);
    records.unshift({
        proof:        midnightProof,
        proofLink,
        generatedAt:  Date.now(),
        documentId:   req.documentId,
        documentTitle: doc.title,
    });
    saveProofRegistry(owner, records);

    // Deduct DUST
    deductDust(owner);

    req.onProgress?.(100, 'Proof ready');

    return { proof: midnightProof, proofLink, serialized };
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Verify a proof — works without wallet connection.
 */
export function verifyProof(proof: MidnightProof): VerificationResult {
    return verifyMidnightProof(proof);
}

// ── History ───────────────────────────────────────────────────────────────────

export function listProofs(): ProofRecord[] {
    const owner = getConnectedAddress();
    if (!owner) return [];
    return loadProofRegistry(owner);
}

export function getProofById(proofId: string): ProofRecord | null {
    const owner = getConnectedAddress();
    if (!owner) return null;
    return loadProofRegistry(owner).find(r => r.proof.proofId === proofId) ?? null;
}

export function deleteProof(proofId: string): void {
    const owner = getConnectedAddress();
    if (!owner) return;
    const records = loadProofRegistry(owner).filter(r => r.proof.proofId !== proofId);
    saveProofRegistry(owner, records);
}

// ── Document helper ───────────────────────────────────────────────────────────

export { getDocument };
export type { VaultDocument };
