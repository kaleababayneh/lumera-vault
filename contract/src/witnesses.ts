/**
 * Witness implementations for the certificate registry contract.
 *
 * The single witness — certificateWitness() — feeds the student's full
 * (private) certificate into the prove* circuits. The certificate never
 * leaves the device; only the ZK proof and the disclosed claim record do.
 */

import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type {
    AcademicCert,
    Ledger,
    Witnesses,
} from './managed/contract/index.js';

export interface CertificatePrivateState {
    readonly currentCert: AcademicCert;
}

export const emptyCert = (): AcademicCert => ({
    institutionHash:  new Uint8Array(32),
    studentIdHash:    new Uint8Array(32),
    degreeLevel:      0n,
    fieldOfStudyHash: new Uint8Array(32),
    graduationYear:   0n,
    accredited:       false,
    gpaTimes100:      0n,
    salt:             new Uint8Array(32),
});

export const createCertificatePrivateState = (
    cert?: AcademicCert,
): CertificatePrivateState => ({
    currentCert: cert ?? emptyCert(),
});

export const witnesses: Witnesses<CertificatePrivateState> = {
    certificateWitness: ({
        privateState,
    }: WitnessContext<Ledger, CertificatePrivateState>): [
        CertificatePrivateState,
        AcademicCert,
    ] => [privateState, privateState.currentCert],
};
