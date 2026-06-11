import { describe, it, expect, beforeEach } from 'vitest';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { pureCircuits, type AcademicCert } from '../managed/contract/index.js';
import { CertificateSimulator } from './certificate-simulator.js';

setNetworkId('undeployed' as NetworkId);

// Deterministic test identities (ZSwap coin public keys, hex).
const SCHOOL_PK  = '0'.repeat(63) + '1';
const STUDENT_PK = '0'.repeat(63) + '2';

const CASCADE_ID = '15777';

function bytes32(seed: number): Uint8Array {
    const b = new Uint8Array(32);
    b.fill(seed);
    return b;
}

/** A Bachelor in CS, GPA 3.62, accredited — used across the suite. */
function sampleCert(): AcademicCert {
    return {
        institutionHash:  bytes32(11),
        studentIdHash:    bytes32(22),
        degreeLevel:      2n,        // Bachelor
        fieldOfStudyHash: bytes32(33),
        graduationYear:   2025n,
        accredited:       true,
        gpaTimes100:      362n,
        salt:             bytes32(44),
    };
}

describe('certificate registry contract', () => {
    let sim: CertificateSimulator;
    let cert: AcademicCert;
    let commitment: Uint8Array;

    beforeEach(() => {
        sim = new CertificateSimulator(SCHOOL_PK);
        cert = sampleCert();
        commitment = pureCircuits.computeCommitment(cert);
    });

    it('registers the deployer as the first issuer', () => {
        const l = sim.getLedger();
        expect(l.issuers.size()).toBe(1n);
        expect(l.certificates.isEmpty()).toBe(true);
    });

    it('issues a certificate with its Cascade pointer', () => {
        sim.issueCertificate(commitment, CASCADE_ID);
        const l = sim.getLedger();
        expect(l.certificates.member(commitment)).toBe(true);
        const rec = l.certificates.lookup(commitment);
        expect(rec.cascadeId).toBe(CASCADE_ID);
        expect(rec.revoked).toBe(false);
    });

    it('rejects duplicate issuance', () => {
        sim.issueCertificate(commitment, CASCADE_ID);
        expect(() => sim.issueCertificate(commitment, CASCADE_ID))
            .toThrow(/already registered/);
    });

    it('rejects issuance from a non-issuer wallet', () => {
        sim.switchUser(STUDENT_PK);
        expect(() => sim.issueCertificate(commitment, CASCADE_ID))
            .toThrow(/not a registered issuer/);
    });

    it('lets an added issuer issue certificates', () => {
        const studentEntityId = pureCircuits.entityId(
            Uint8Array.from(STUDENT_PK.match(/.{2}/g)!.map(h => parseInt(h, 16))),
        );
        sim.addIssuer(studentEntityId);
        sim.switchUser(STUDENT_PK);
        sim.issueCertificate(commitment, CASCADE_ID);
        expect(sim.getLedger().certificates.member(commitment)).toBe(true);
    });

    describe('claims (student proves with the certificate witness)', () => {
        beforeEach(() => {
            sim.issueCertificate(commitment, CASCADE_ID);
            sim.switchUser(STUDENT_PK);
            sim.setCertificate(cert);
        });

        it('proveGpaAbove succeeds when GPA exceeds the threshold and records the claim under the reproducible proof key', () => {
            sim.proveGpaAbove(300n);

            // TS-side key (pure circuit) must match the key the circuit wrote.
            const key = pureCircuits.computeProofKey(commitment, 4n, 300n, new Uint8Array(32));
            const l = sim.getLedger();
            expect(l.claimProofs.member(key)).toBe(true);

            const rec = l.claimProofs.lookup(key);
            expect(rec.claimKind).toBe(4n);
            expect(rec.numericParam).toBe(300n);
            expect(rec.studentIdHash).toEqual(cert.studentIdHash);
        });

        it('proveGpaAbove fails when the GPA does not exceed the threshold', () => {
            expect(() => sim.proveGpaAbove(380n))
                .toThrow(/GPA does not exceed/);
            expect(() => sim.proveGpaAbove(362n)) // strict inequality
                .toThrow(/GPA does not exceed/);
        });

        it('proveDegreeInField matches only the exact field hash', () => {
            sim.proveDegreeInField(cert.fieldOfStudyHash);
            const key = pureCircuits.computeProofKey(commitment, 1n, 0n, cert.fieldOfStudyHash);
            expect(sim.getLedger().claimProofs.member(key)).toBe(true);

            expect(() => sim.proveDegreeInField(bytes32(99)))
                .toThrow(/field of study does not match/);
        });

        it('proveDegreeLevelAtLeast respects the level ordering', () => {
            sim.proveDegreeLevelAtLeast(2n); // Bachelor >= Bachelor
            expect(() => sim.proveDegreeLevelAtLeast(3n)) // needs Master
                .toThrow(/below the requested minimum/);
        });

        it('proveAccredited fails for non-accredited certificates', () => {
            sim.proveAccredited(); // accredited cert passes

            const nonAccredited = { ...sampleCert(), accredited: false, salt: bytes32(45) };
            const naCommitment = pureCircuits.computeCommitment(nonAccredited);
            sim.switchUser(SCHOOL_PK);
            sim.issueCertificate(naCommitment, '20001');
            sim.switchUser(STUDENT_PK);
            sim.setCertificate(nonAccredited);
            expect(() => sim.proveAccredited()).toThrow(/not accredited/);
        });

        it('rejects proofs for unregistered certificates', () => {
            const unregistered = { ...sampleCert(), salt: bytes32(77) };
            sim.setCertificate(unregistered);
            expect(() => sim.proveGpaAbove(100n))
                .toThrow(/not registered on-chain/);
        });

        it('rejects proofs after revocation', () => {
            sim.switchUser(SCHOOL_PK);
            sim.revokeCertificate(commitment);

            const l = sim.getLedger();
            expect(l.certificates.lookup(commitment).revoked).toBe(true);
            expect(l.certificates.lookup(commitment).cascadeId).toBe(CASCADE_ID);

            sim.switchUser(STUDENT_PK);
            expect(() => sim.proveGpaAbove(100n)).toThrow(/revoked/);
        });

        it('only issuers can revoke', () => {
            expect(() => sim.revokeCertificate(commitment))
                .toThrow(/not a registered issuer/);
        });
    });

    it('commitment is salt-blinded: same fields, different salt → different commitment', () => {
        const certB = { ...sampleCert(), salt: bytes32(45) };
        expect(pureCircuits.computeCommitment(certB)).not.toEqual(commitment);
    });
});
