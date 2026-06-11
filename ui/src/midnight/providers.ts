/**
 * midnight-js providers built from a connected wallet (dApp connector v4),
 * following the kaamos BrowserHtlcManager pattern:
 *
 *   - proving is delegated to the wallet (1AM → ProofStation) via
 *     getProvingProvider(zkConfigProvider.asKeyMaterialProvider())
 *     wrapped with the official createProofProvider helper
 *   - walletProvider balances unsealed transactions through the wallet
 *     (the wallet side pays fees — dust-free for the user)
 *   - midnightProvider submits through the wallet as a relayer
 */

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { createProofProvider, type UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import {
    Transaction,
    type Binding,
    type FinalizedTransaction,
    type Proof,
    type SignatureEnabled,
} from '@midnight-ntwrk/ledger-v8';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { createInMemoryPrivateStateProvider } from './in-memory-private-state';
import type { CertCircuitKeys, CertProviders } from './common-types';

/**
 * The exact hex the wallet returned from balancing, keyed by the deserialized
 * transaction object. Submitting these bytes VERBATIM matters: re-serializing
 * through our ledger-v8 can re-encode the wallet's dust spend proof and the
 * node then rejects with "1010 Custom error 170" (InvalidDustSpendProof) when
 * the wallet's fee stack is on a different ledger line.
 */
const balancedTxHex = new WeakMap<object, string>();

export async function buildProviders(api: ConnectedAPI): Promise<CertProviders> {
    const config = await api.getConfiguration();
    const shieldedAddresses = await api.getShieldedAddresses();

    console.info('[providers] wallet configuration:', {
        networkId: config.networkId,
        indexerUri: config.indexerUri,
    });

    const zkConfigProvider = new FetchZkConfigProvider<CertCircuitKeys>(
        window.location.origin,
        fetch.bind(window),
    );

    // The wallet does the actual ZK proving (1AM routes to ProofStation); it
    // pulls prover keys + ZKIR from this origin via the key-material adapter.
    const provingProvider = await api.getProvingProvider(
        zkConfigProvider.asKeyMaterialProvider(),
    );

    const walletProvider: CertProviders['walletProvider'] = {
        getCoinPublicKey() {
            return shieldedAddresses.shieldedCoinPublicKey;
        },
        getEncryptionPublicKey() {
            return shieldedAddresses.shieldedEncryptionPublicKey;
        },
        async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
            const { tx: balanced } = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
            const finalized = Transaction.deserialize<SignatureEnabled, Proof, Binding>(
                'signature',
                'proof',
                'binding',
                fromHex(balanced),
            );
            balancedTxHex.set(finalized as unknown as object, balanced);
            return finalized;
        },
    };

    const midnightProvider: CertProviders['midnightProvider'] = {
        async submitTx(tx: FinalizedTransaction): Promise<string> {
            // Prefer the wallet's own balanced bytes over a re-serialization.
            const exact = balancedTxHex.get(tx as unknown as object);
            await api.submitTransaction(exact ?? toHex(tx.serialize()));
            return tx.identifiers()[0];
        },
    };

    return {
        privateStateProvider: createInMemoryPrivateStateProvider() as never,
        publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
        zkConfigProvider,
        proofProvider: createProofProvider(provingProvider),
        walletProvider,
        midnightProvider,
    };
}
