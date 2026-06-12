/**
 * Midnight wallet connector (dApp connector API v4).
 *
 * Detection follows the kaamos BrowserHtlcManager pattern: enumerate every
 * wallet injected under window.midnight and pick one whose apiVersion is
 * 4.x — 1AM is preferred when present, but Lace or any other v4 connector
 * works too.
 */

import '@midnight-ntwrk/dapp-connector-api'; // pulls in the global Window.midnight typing
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { MIDNIGHT_NETWORK_ID, SESSION_WALLET_KEY } from '../config';

const COMPATIBLE_API_MAJOR = '4.';

let _api: ConnectedAPI | null = null;
let _walletName: string | null = null;
let _shieldedAddress: string | null = null;

function isCompatible(w: unknown): w is InitialAPI {
    return (
        !!w &&
        typeof w === 'object' &&
        'apiVersion' in w &&
        String((w as InitialAPI).apiVersion).startsWith(COMPATIBLE_API_MAJOR)
    );
}

function findCompatibleWallet(): InitialAPI | null {
    const injected = window.midnight;
    if (!injected) return null;
    const oneAm = injected['1am'];
    if (isCompatible(oneAm)) return oneAm;
    return Object.values(injected).find(isCompatible) ?? null;
}

/** Poll for an injected compatible wallet (extensions can inject late). */
export function detectWallet(timeoutMs = 5_000): Promise<InitialAPI | null> {
    return new Promise((resolve) => {
        const found = findCompatibleWallet();
        if (found) { resolve(found); return; }
        const started = Date.now();
        const interval = setInterval(() => {
            const w = findCompatibleWallet();
            if (w) { clearInterval(interval); resolve(w); }
            else if (Date.now() - started > timeoutMs) { clearInterval(interval); resolve(null); }
        }, 100);
    });
}

export async function connectWallet(): Promise<ConnectedAPI> {
    const wallet = await detectWallet();
    if (!wallet) {
        const seen = window.midnight ? Object.keys(window.midnight).join(', ') : 'none';
        throw new Error(
            `No compatible Midnight wallet found (injected: ${seen}). ` +
            'Install 1AM (https://1am.xyz/install-beta), unlock it, and reload the page.',
        );
    }

    console.info(`[wallet] connecting via ${wallet.name} (api ${wallet.apiVersion}) on ${MIDNIGHT_NETWORK_ID}`);
    let api: ConnectedAPI;
    try {
        api = await wallet.connect(MIDNIGHT_NETWORK_ID);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `${wallet.name} refused the connection: ${msg}. ` +
            `Make sure the wallet is unlocked, set to "${MIDNIGHT_NETWORK_ID}", and that this site is authorized.`,
        );
    }

    const status = await api.getConnectionStatus().catch(() => null);
    console.info('[wallet] connection status:', status);

    const { shieldedAddress } = await api.getShieldedAddresses();

    _api = api;
    _walletName = wallet.name;
    _shieldedAddress = shieldedAddress;
    sessionStorage.setItem(SESSION_WALLET_KEY, JSON.stringify({ network: MIDNIGHT_NETWORK_ID }));
    return api;
}

/** Re-connect silently if a session marker exists (e.g. after reload). */
export async function restoreWalletSession(): Promise<ConnectedAPI | null> {
    if (!sessionStorage.getItem(SESSION_WALLET_KEY)) return null;
    try {
        return await connectWallet();
    } catch {
        sessionStorage.removeItem(SESSION_WALLET_KEY);
        return null;
    }
}

export function disconnectWallet(): void {
    _api = null;
    _walletName = null;
    _shieldedAddress = null;
    sessionStorage.removeItem(SESSION_WALLET_KEY);
}

export function getConnectedApi(): ConnectedAPI | null {
    return _api;
}

export function isWalletConnected(): boolean {
    return _api !== null;
}

export function getWalletName(): string | null {
    return _walletName;
}

export function getShieldedAddress(): string | null {
    return _shieldedAddress;
}

export function formatAddress(address: string): string {
    if (address.length <= 20) return address;
    return `${address.slice(0, 12)}…${address.slice(-8)}`;
}
