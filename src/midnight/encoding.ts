/**
 * Certificate field encoding — bridges human-readable certificate fields and
 * the circuit's AcademicCert representation.
 *
 * String fields are normalized (trim, lowercase, collapse whitespace) and
 * hashed with BLAKE2b-256 under a domain prefix; the circuit only ever
 * compares these hashes. The commitment and proof keys are computed through
 * the contract's exported pure circuits, so the app and the circuit can never
 * disagree on hashing.
 */

import { blake2b256str, randomSalt, toHex } from '../crypto';
import { pureCircuits, type AcademicCert } from '../../contract/src/index';
import { DEGREE_LEVELS, type DegreeLevel } from '../config';

// ── Certificate fields (plaintext, as entered by the school) ────────────────

export interface CertificateFields {
    studentName:    string;
    studentId:      string;
    institution:    string;
    degreeType:     DegreeLevel;
    fieldOfStudy:   string;
    graduationYear: number;
    accredited:     boolean;
    /** GPA on a 0–4 scale; null when not recorded. */
    gpa:            number | null;
}

// ── Normalization & hashing ──────────────────────────────────────────────────

export function normalizeText(s: string): string {
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hashDomain(domain: string, value: string): Uint8Array {
    return blake2b256str(`lumera-vault:${domain}:${normalizeText(value)}`);
}

/**
 * Identity binding hash. The preimage (name, id, idSalt) is only ever shared
 * off-chain by the student when they choose to disclose identity to a
 * verifier; on-chain only this salted hash appears.
 */
export function studentIdHashOf(name: string, id: string, idSalt: Uint8Array): Uint8Array {
    return blake2b256str(
        `lumera-vault:student:${normalizeText(name)}|${normalizeText(id)}|${toHex(idSalt)}`,
    );
}

export function degreeLevelIndex(level: DegreeLevel): bigint {
    const idx = DEGREE_LEVELS.indexOf(level);
    if (idx < 0) throw new Error(`Unknown degree level: ${level}`);
    return BigInt(idx);
}

export function gpaTimes100Of(gpa: number | null): bigint {
    if (gpa === null || Number.isNaN(gpa)) return 0n;
    return BigInt(Math.round(gpa * 100));
}

// ── Circuit encoding ─────────────────────────────────────────────────────────

export function encodeCertificate(
    fields: CertificateFields,
    salt:   Uint8Array,
    idSalt: Uint8Array,
): AcademicCert {
    return {
        institutionHash:  hashDomain('institution', fields.institution),
        studentIdHash:    studentIdHashOf(fields.studentName, fields.studentId, idSalt),
        degreeLevel:      degreeLevelIndex(fields.degreeType),
        fieldOfStudyHash: hashDomain('field', fields.fieldOfStudy),
        graduationYear:   BigInt(fields.graduationYear),
        accredited:       fields.accredited,
        gpaTimes100:      gpaTimes100Of(fields.gpa),
        salt,
    };
}

/** Commitment exactly as the circuit computes it (via the pure circuit). */
export function commitmentOf(cert: AcademicCert): Uint8Array {
    return pureCircuits.computeCommitment(cert);
}

export function newSalts(): { salt: Uint8Array; idSalt: Uint8Array } {
    return { salt: randomSalt(), idSalt: randomSalt() };
}

// ── Claims ───────────────────────────────────────────────────────────────────

export type ClaimKey =
    | 'has_degree_in'
    | 'graduated_from_accredited'
    | 'degree_level_at_least'
    | 'gpa_above';

export const CLAIM_KIND: Record<ClaimKey, bigint> = {
    has_degree_in:             1n,
    graduated_from_accredited: 2n,
    degree_level_at_least:     3n,
    gpa_above:                 4n,
};

/** Circuit-level encoding of a claim with its public parameters. */
export interface PreparedClaim {
    claimKey:     ClaimKey;
    kind:         bigint;
    numericParam: bigint;
    hashParam:    Uint8Array;
    description:  string;
}

const ZERO32 = new Uint8Array(32);

export function prepareClaim(
    claimKey: ClaimKey,
    params:   Record<string, unknown>,
): PreparedClaim {
    switch (claimKey) {
        case 'has_degree_in': {
            const field = String(params.field ?? '').trim();
            if (!field) throw new Error('Claim parameter "field" is required');
            return {
                claimKey,
                kind: CLAIM_KIND[claimKey],
                numericParam: 0n,
                hashParam: hashDomain('field', field),
                description: `Holds a degree in ${field}`,
            };
        }
        case 'graduated_from_accredited':
            return {
                claimKey,
                kind: CLAIM_KIND[claimKey],
                numericParam: 0n,
                hashParam: ZERO32,
                description: 'Graduated from an accredited institution',
            };
        case 'degree_level_at_least': {
            const level = String(params.min_level ?? '') as DegreeLevel;
            return {
                claimKey,
                kind: CLAIM_KIND[claimKey],
                numericParam: degreeLevelIndex(level),
                hashParam: ZERO32,
                description: `Holds at least a ${level} degree`,
            };
        }
        case 'gpa_above': {
            const threshold = Number(params.threshold);
            if (Number.isNaN(threshold)) throw new Error('Claim parameter "threshold" is required');
            return {
                claimKey,
                kind: CLAIM_KIND[claimKey],
                numericParam: BigInt(Math.round(threshold * 100)),
                hashParam: ZERO32,
                description: `GPA is above ${threshold}`,
            };
        }
    }
}

/** Proof key exactly as the circuit computes it (via the pure circuit). */
export function proofKeyOf(commitment: Uint8Array, claim: PreparedClaim): Uint8Array {
    return pureCircuits.computeProofKey(
        commitment,
        claim.kind,
        claim.numericParam,
        claim.hashParam,
    );
}

/**
 * Pre-flight check mirroring the circuit's asserts, so the UI can tell the
 * student "your certificate does not satisfy this claim" before spending
 * proving time (an unsatisfied claim can never produce a valid proof).
 */
export function satisfiesClaim(cert: AcademicCert, claim: PreparedClaim): boolean {
    switch (claim.claimKey) {
        case 'has_degree_in': {
            const a = cert.fieldOfStudyHash;
            const b = claim.hashParam;
            return a.length === b.length && a.every((v, i) => v === b[i]);
        }
        case 'graduated_from_accredited':
            return cert.accredited;
        case 'degree_level_at_least':
            return cert.degreeLevel >= claim.numericParam;
        case 'gpa_above':
            return cert.gpaTimes100 > claim.numericParam;
    }
}
