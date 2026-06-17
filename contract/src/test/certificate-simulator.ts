/**
 * Testbed for exercising the certificate registry circuits without a live network
 * Each method wraps an impure circuit call and keeps the CircuitContext in
 * sync, exactly as the on-chain transcript would evolve.
 */

import {
    type CircuitContext,
    QueryContext,
    sampleContractAddress,
    createConstructorContext,
    emptyZswapLocalState,
    type ContractAddress,
    CostModel,
} from '@midnight-ntwrk/compact-runtime';
import {
    Contract,
    ledger,
    type AcademicCert,
    type Ledger,
} from '../managed/contract/index.js';
import {
    witnesses,
    createCertificatePrivateState,
    type CertificatePrivateState,
} from '../witnesses.js';

export class CertificateSimulator {
    readonly contract: Contract<CertificatePrivateState>;
    readonly contractAddress: ContractAddress;
    circuitContext: CircuitContext<CertificatePrivateState>;

    constructor(deployerCoinPublicKeyHex: string) {
        this.contractAddress = sampleContractAddress();
        this.contract = new Contract<CertificatePrivateState>(witnesses);

        const { currentPrivateState, currentContractState, currentZswapLocalState } =
            this.contract.initialState(
                createConstructorContext(
                    createCertificatePrivateState(),
                    deployerCoinPublicKeyHex,
                ),
            );

        this.circuitContext = {
            currentPrivateState,
            currentZswapLocalState,
            costModel: CostModel.initialCostModel(),
            currentQueryContext: new QueryContext(
                currentContractState.data,
                this.contractAddress,
            ),
        };
    }

    /** Switch the caller wallet (determines ownPublicKey() / issuer checks). */
    switchUser(coinPublicKeyHex: string): void {
        this.circuitContext.currentZswapLocalState =
            emptyZswapLocalState(coinPublicKeyHex);
    }

    /** Load a certificate into private state (what certificateWitness reads). */
    setCertificate(cert: AcademicCert): void {
        this.circuitContext.currentPrivateState =
            createCertificatePrivateState(cert);
    }

    getLedger(): Ledger {
        return ledger(this.circuitContext.currentQueryContext.state);
    }

    issueCertificate(commitment: Uint8Array, cascadeId: string): void {
        const res = this.contract.impureCircuits.issueCertificate(
            this.circuitContext, commitment, cascadeId);
        this.circuitContext = res.context;
    }

    revokeCertificate(commitment: Uint8Array): void {
        const res = this.contract.impureCircuits.revokeCertificate(
            this.circuitContext, commitment);
        this.circuitContext = res.context;
    }

    addIssuer(issuerEntityId: Uint8Array): void {
        const res = this.contract.impureCircuits.addIssuer(
            this.circuitContext, issuerEntityId);
        this.circuitContext = res.context;
    }

    proveDegreeInField(requiredFieldHash: Uint8Array): void {
        const res = this.contract.impureCircuits.proveDegreeInField(
            this.circuitContext, requiredFieldHash);
        this.circuitContext = res.context;
    }

    proveAccredited(): void {
        const res = this.contract.impureCircuits.proveAccredited(this.circuitContext);
        this.circuitContext = res.context;
    }

    proveDegreeLevelAtLeast(minLevel: bigint): void {
        const res = this.contract.impureCircuits.proveDegreeLevelAtLeast(
            this.circuitContext, minLevel);
        this.circuitContext = res.context;
    }

    proveGpaAbove(thresholdTimes100: bigint): void {
        const res = this.contract.impureCircuits.proveGpaAbove(
            this.circuitContext, thresholdTimes100);
        this.circuitContext = res.context;
    }
}
