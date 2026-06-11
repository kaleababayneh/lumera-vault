/**
 * Wallet-less on-chain verification.
 *
 * A verifier pastes a #verify/ link; this module queries the Midnight indexer
 * for the registry contract state and checks:
 *   1. the claim proof record exists under the recomputed proof key
 *      (a record can only exist if the ZK circuit's asserts held),
 *   2. the referenced certificate is registered and not revoked,
 *   3. the record's disclosed fields match the claim in the link,
 *   4. optionally, the disclosed identity matches the record's studentIdHash.
 */

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
    ledger,
    type ClaimRecord,
    type Ledger,
} from '@lumera-vault/contract';
import { INDEXER_URI, INDEXER_WS_URI } from '../config';
import { b64uToBytes, type VerifyLinkPayload } from '../links';
import { prepareClaim, proofKeyOf, studentIdHashOf } from './encoding';

let _pdp: ReturnType<typeof indexerPublicDataProvider> | null = null;

function publicDataProvider() {
    if (!_pdp) {
        // setNetworkId() runs at app boot (main.ts) before anything calls this.
        _pdp = indexerPublicDataProvider(INDEXER_URI, INDEXER_WS_URI);
    }
    return _pdp;
}

export async function fetchRegistryLedger(contractAddress: string): Promise<Ledger | null> {
    const state = await publicDataProvider().queryContractState(contractAddress);
    return state ? ledger(state.data) : null;
}

export interface VerificationCheck {
    label:   string;
    ok:      boolean;
    detail?: string;
}

export interface OnChainVerificationResult {
    valid:       boolean;
    description: string;
    checks:      VerificationCheck[];
    claimRecord: ClaimRecord | null;
    cascadeId:   string | null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function verifyClaimOnChain(
    payload: VerifyLinkPayload,
): Promise<OnChainVerificationResult> {
    const checks: VerificationCheck[] = [];
    const claim = prepareClaim(payload.claimKey, payload.claimParams);

    // 1. Reach the registry contract via the public indexer.
    let l: Ledger | null = null;
    let indexerError = '';
    try {
        l = await fetchRegistryLedger(payload.contractAddress);
    } catch (err) {
        indexerError = String(err);
    }
    checks.push({
        label: 'Registry contract found on Midnight',
        ok: l !== null,
        detail: l ? payload.contractAddress : (indexerError || 'Contract state not found on the indexer'),
    });
    if (!l) {
        return { valid: false, description: claim.description, checks, claimRecord: null, cascadeId: null };
    }

    // 2. Certificate registered and not revoked.
    const commitment = b64uToBytes(payload.commitment);
    const certRegistered = l.certificates.member(commitment);
    const certRecord = certRegistered ? l.certificates.lookup(commitment) : null;
    checks.push({
        label: 'Certificate anchored by the issuing school',
        ok: certRegistered,
        detail: certRegistered
            ? `Cascade action ${certRecord!.cascadeId}`
            : 'No certificate found under this commitment',
    });
    checks.push({
        label: 'Certificate not revoked',
        ok: certRegistered && !certRecord!.revoked,
        detail: certRecord?.revoked ? 'The school revoked this certificate' : undefined,
    });

    // 3. ZK claim proof recorded under the recomputed key. The key derivation
    //    (pure circuit) binds it to this exact commitment + claim + params, so
    //    a hit here is the on-chain evidence the circuit's asserts held.
    const proofKey = proofKeyOf(commitment, claim);
    const proofExists = l.claimProofs.member(proofKey);
    const claimRecord = proofExists ? l.claimProofs.lookup(proofKey) : null;
    checks.push({
        label: 'ZK proof recorded on-chain for this exact claim',
        ok: proofExists,
        detail: proofExists ? undefined : 'No claim proof found for this claim + parameters',
    });

    // 4. Defense in depth: the stored record's disclosed fields must match.
    if (claimRecord) {
        const fieldsMatch =
            claimRecord.claimKind === claim.kind &&
            claimRecord.numericParam === claim.numericParam &&
            bytesEqual(claimRecord.hashParam, claim.hashParam);
        checks.push({
            label: 'On-chain record matches the claim parameters',
            ok: fieldsMatch,
        });
    }

    // 5. Optional identity disclosure.
    if (payload.identity && claimRecord) {
        const idSalt = Uint8Array.from(
            payload.identity.idSalt.match(/.{2}/g)?.map(h => parseInt(h, 16)) ?? [],
        );
        const expected = studentIdHashOf(payload.identity.name, payload.identity.id, idSalt);
        checks.push({
            label: `Proof belongs to ${payload.identity.name} (${payload.identity.id})`,
            ok: bytesEqual(expected, claimRecord.studentIdHash),
            detail: 'Disclosed identity recomputed against the on-chain studentIdHash',
        });
    }

    const valid = checks.every(c => c.ok);
    return {
        valid,
        description: claim.description,
        checks,
        claimRecord,
        cascadeId: certRecord?.cascadeId ?? null,
    };
}
