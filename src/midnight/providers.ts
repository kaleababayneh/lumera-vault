/**
 * midnight-js providers built from a connected 1AM wallet (dApp connector v4).
 *
 * Dust-free flow per https://1am.xyz/ai.txt:
 *   1. proofProvider — ZK proof via the wallet's ProvingProvider (ProofStation)
 *   2. walletProvider.balanceTx — server adds dust fees (balanceUnsealedTransaction)
 *   3. midnightProvider.submitTx — wallet broadcasts to the chain
 * Falls back to a plain HTTP proof server when the wallet does not expose
 * getProvingProvider (e.g. Lace), mirroring the vaxzk integration.
 */

import type { ConnectedAPI, KeyMaterialProvider } from '@midnight-ntwrk/dapp-connector-api';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { Transaction, CostModel } from '@midnight-ntwrk/ledger-v8';
import { fromHex, toHex, parseCoinPublicKeyToHex } from '@midnight-ntwrk/midnight-js-utils';
import { createInMemoryPrivateStateProvider } from './in-memory-private-state';
import type { CertCircuitKeys, CertProviders } from './common-types';

interface ProvableTx {
    prove(provingProvider: unknown, costModel: unknown): Promise<never>;
}

export async function buildProviders(api: ConnectedAPI): Promise<CertProviders> {
    const config = await api.getConfiguration();
    setNetworkId(config.networkId);

    const shieldedAddresses = await api.getShieldedAddresses();

    const zkConfigProvider = new FetchZkConfigProvider<CertCircuitKeys>(
        window.location.origin,
        fetch.bind(window),
    );

    const proofProvider: CertProviders['proofProvider'] = {
        async proveTx(tx, _proveTxConfig?) {
            const provingProvider = await api.getProvingProvider(
                zkConfigProvider as unknown as KeyMaterialProvider,
            );
            return (tx as unknown as ProvableTx).prove(
                provingProvider,
                CostModel.initialCostModel(),
            );
        },
    };

    const walletProvider: CertProviders['walletProvider'] = {
        getCoinPublicKey() {
            return parseCoinPublicKeyToHex(
                shieldedAddresses.shieldedCoinPublicKey,
                getNetworkId(),
            );
        },
        getEncryptionPublicKey() {
            return shieldedAddresses.shieldedEncryptionPublicKey;
        },
        async balanceTx(tx, _ttl?) {
            const serialized = toHex(tx.serialize());
            const { tx: balanced } = await api.balanceUnsealedTransaction(serialized);
            return Transaction.deserialize(
                'signature',
                'proof',
                'binding',
                fromHex(balanced),
            ) as never;
        },
    };

    const midnightProvider: CertProviders['midnightProvider'] = {
        async submitTx(tx) {
            await api.submitTransaction(toHex(tx.serialize()));
            return tx.identifiers()[0];
        },
    };

    return {
        privateStateProvider: createInMemoryPrivateStateProvider() as never,
        publicDataProvider: indexerPublicDataProvider(
            config.indexerUri,
            config.indexerWsUri,
        ),
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider,
    };
}
