/**
 * Shared types for the certificate registry midnight-js integration.
 * Modeled on the vaxzk contract-api layer (MIT, github.com/bochaco/vaxzk).
 */

import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type {
    CertificatePrivateState,
    Contract,
    Witnesses,
} from '@lumera-vault/contract';

export const certPrivateStateKey = 'LumeraVaultCertificateState';
export type CertPrivateStateId = typeof certPrivateStateKey;

export type CertContract = Contract<
    CertificatePrivateState,
    Witnesses<CertificatePrivateState>
>;

/** The circuit names that require ZK proving keys. */
export type CertCircuitKeys = Exclude<
    keyof CertContract['impureCircuits'],
    number | symbol
>;

export type CertProviders = MidnightProviders<
    CertCircuitKeys,
    CertPrivateStateId,
    CertificatePrivateState
>;

export type DeployedCertContract = FoundContract<CertContract>;

export interface TxInfo {
    txHash:      string;
    blockHeight: number;
}
