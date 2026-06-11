/**
 * CertificateRegistry — typed facade over the deployed contract.
 *
 * Issue/revoke run as the school wallet; prove* run as the student wallet
 * with the certificate loaded into local private state right before the
 * circuit call (the witness reads it from there).
 */

import {
    deployContract,
    findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
    createCertificatePrivateState,
    type AcademicCert,
} from '@lumera-vault/contract';
import { getCompiledCertificateContract } from './contract';
import {
    certPrivateStateKey,
    type CertProviders,
    type DeployedCertContract,
    type TxInfo,
} from './common-types';

export class CertificateRegistry {
    readonly address: ContractAddress;
    private readonly deployed: DeployedCertContract;
    private readonly providers: CertProviders;

    private constructor(deployed: DeployedCertContract, providers: CertProviders) {
        this.deployed = deployed;
        this.providers = providers;
        this.address = deployed.deployTxData.public.contractAddress;
    }

    /** Deploy a fresh registry; the deployer wallet becomes the first issuer. */
    static async deploy(providers: CertProviders): Promise<CertificateRegistry> {
        const deployed = await deployContract(providers, {
            compiledContract: getCompiledCertificateContract(),
            privateStateId: certPrivateStateKey,
            initialPrivateState: createCertificatePrivateState(),
        });
        return new CertificateRegistry(deployed as DeployedCertContract, providers);
    }

    /** Join an existing registry by address. */
    static async join(
        providers: CertProviders,
        contractAddress: ContractAddress,
    ): Promise<CertificateRegistry> {
        providers.privateStateProvider.setContractAddress?.(contractAddress);
        const deployed = await findDeployedContract(providers, {
            contractAddress,
            compiledContract: getCompiledCertificateContract(),
            privateStateId: certPrivateStateKey,
            initialPrivateState: createCertificatePrivateState(),
        });
        return new CertificateRegistry(deployed as DeployedCertContract, providers);
    }

    // ── School (issuer) ──────────────────────────────────────────────────────

    async issueCertificate(commitment: Uint8Array, cascadeId: string): Promise<TxInfo> {
        const txData = await this.deployed.callTx.issueCertificate(commitment, cascadeId);
        return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
    }

    async revokeCertificate(commitment: Uint8Array): Promise<TxInfo> {
        const txData = await this.deployed.callTx.revokeCertificate(commitment);
        return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
    }

    async addIssuer(issuerEntityId: Uint8Array): Promise<TxInfo> {
        const txData = await this.deployed.callTx.addIssuer(issuerEntityId);
        return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
    }

    // ── Student (holder) ─────────────────────────────────────────────────────

    /** Load the certificate into private state so certificateWitness() finds it. */
    private async setCurrentCert(cert: AcademicCert): Promise<void> {
        await this.providers.privateStateProvider.set(
            certPrivateStateKey,
            createCertificatePrivateState(cert),
        );
    }

    async proveDegreeInField(cert: AcademicCert, requiredFieldHash: Uint8Array): Promise<TxInfo> {
        await this.setCurrentCert(cert);
        const txData = await this.deployed.callTx.proveDegreeInField(requiredFieldHash);
        return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
    }

    async proveAccredited(cert: AcademicCert): Promise<TxInfo> {
        await this.setCurrentCert(cert);
        const txData = await this.deployed.callTx.proveAccredited();
        return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
    }

    async proveDegreeLevelAtLeast(cert: AcademicCert, minLevel: bigint): Promise<TxInfo> {
        await this.setCurrentCert(cert);
        const txData = await this.deployed.callTx.proveDegreeLevelAtLeast(minLevel);
        return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
    }

    async proveGpaAbove(cert: AcademicCert, thresholdTimes100: bigint): Promise<TxInfo> {
        await this.setCurrentCert(cert);
        const txData = await this.deployed.callTx.proveGpaAbove(thresholdTimes100);
        return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
    }
}
