/**
 * 1AM Wallet Module — Midnight dApp connector (API v4).
 *
 * The 1AM wallet injects at window.midnight['1am']. Users never need dust or
 * NIGHT — ProofStation sponsors all transaction fees server-side.
 * Integration reference: https://1am.xyz/ai.txt
 */

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { MIDNIGHT_NETWORK_ID, SESSION_WALLET_KEY } from '../config';

let _api: ConnectedAPI | null = null;
let _shieldedAddress: string | null = null;

/** Poll for the extension for up to ~5s (it can inject late). */
export function detect1amWallet(): Promise<InitialAPI | null> {
    return new Promise((resolve) => {
        const found = window.midnight?.['1am'];
        if (found) { resolve(found); return; }
        let attempts = 0;
        const interval = setInterval(() => {
            const w = window.midnight?.['1am'];
            if (w) { clearInterval(interval); resolve(w); }
            else if (++attempts > 50) { clearInterval(interval); resolve(null); }
        }, 100);
    });
}

export async function connect1amWallet(): Promise<ConnectedAPI> {
    const wallet = await detect1amWallet();
    if (!wallet) {
        throw new Error('1AM wallet not detected. Install it from https://1am.xyz/install-beta and reload.');
    }
    const api = await wallet.connect(MIDNIGHT_NETWORK_ID);
    const { shieldedAddress } = await api.getShieldedAddresses();

    _api = api;
    _shieldedAddress = shieldedAddress;
    sessionStorage.setItem(SESSION_WALLET_KEY, JSON.stringify({ network: MIDNIGHT_NETWORK_ID }));
    return api;
}

/** Re-connect silently if a session marker exists (e.g. after reload). */
export async function restore1amSession(): Promise<ConnectedAPI | null> {
    if (!sessionStorage.getItem(SESSION_WALLET_KEY)) return null;
    try {
        return await connect1amWallet();
    } catch {
        sessionStorage.removeItem(SESSION_WALLET_KEY);
        return null;
    }
}

export function disconnect1amWallet(): void {
    _api = null;
    _shieldedAddress = null;
    sessionStorage.removeItem(SESSION_WALLET_KEY);
}

export function getConnectedApi(): ConnectedAPI | null {
    return _api;
}

export function isWalletConnected(): boolean {
    return _api !== null;
}

export function getShieldedAddress(): string | null {
    return _shieldedAddress;
}

export function formatAddress(address: string): string {
    if (address.length <= 20) return address;
    return `${address.slice(0, 12)}…${address.slice(-8)}`;
}
