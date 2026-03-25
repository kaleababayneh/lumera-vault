/**
 * Cascade Module — Upload & download encrypted vault documents
 * Uses Lumera's permanent decentralized storage.
 */

import {
    createLumeraClient,
    type LumeraClient,
    getKeplrSigner,
} from '@lumera-protocol/sdk-js';
import { getConnectedAddress, isWalletConnected } from './wallet';
import { CHAIN_ID, GAS_PRICE } from './config';

let _client: LumeraClient | null = null;

export async function initializeCascadeClient(): Promise<void> {
    if (!isWalletConnected()) throw new Error('Wallet must be connected first.');

    const address = getConnectedAddress();
    if (!address) throw new Error('Cannot get wallet address.');

    try {
        const signer = await getKeplrSigner(CHAIN_ID);
        _client = await createLumeraClient({
            preset:   'testnet',
            signer,
            address,
            gasPrice: GAS_PRICE,
        });
        console.log('✅ Cascade client ready');
    } catch (err) {
        console.error('Failed to init Cascade client:', err);
        throw err;
    }
}

export function getCascadeClient(): LumeraClient | null {
    return _client;
}

export function isCascadeReady(): boolean {
    return _client !== null;
}

/**
 * Upload raw bytes to Cascade permanent storage.
 * Returns the action ID for later retrieval.
 */
export async function uploadToCascade(
    data:          Uint8Array,
    fileName:      string,
    isPublic:      boolean,
    onProgress?:   (pct: number) => void
): Promise<string> {
    if (!_client) throw new Error('Cascade client not initialized.');

    onProgress?.(5);

    // 25 hours × 30 = ~750 hours; tune as needed for production
    const expirationTime = Math.floor(Date.now() / 1000) + 90_000 * 30;

    const result = await _client.Cascade.uploader.uploadFile(data, {
        fileName,
        isPublic,
        expirationTime: expirationTime.toString(),
        taskOptions: {
            pollInterval: 2000,
            timeout:      300_000,
        },
    });

    onProgress?.(100);

    const actionId =
        (result as { action_id?: string }).action_id ??
        result.taskId ??
        `vault-${Date.now()}`;

    return actionId;
}

/**
 * Download raw bytes from Cascade by action ID.
 */
export async function downloadFromCascade(
    actionId:    string,
    onProgress?: (pct: number) => void
): Promise<Uint8Array> {
    if (!_client) throw new Error('Cascade client not initialized.');

    onProgress?.(10);

    const stream = await _client.Cascade.downloader.download(actionId);
    onProgress?.(30);

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }

    onProgress?.(80);

    const total  = chunks.reduce((n, c) => n + c.length, 0);
    const result = new Uint8Array(total);
    let offset   = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }

    onProgress?.(100);
    return result;
}
