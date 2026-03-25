/**
 * Wallet Module — Keplr integration for Lumera Vault
 */

import { CHAIN_ID, LUMERA_CHAIN_INFO, SESSION_WALLET_KEY } from './config';

let connectedAddress: string | null = null;
let connectedName: string | null = null;
let _isConnected = false;

export function initializeWalletState(): void {
    const saved = sessionStorage.getItem(SESSION_WALLET_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved) as { address: string; name: string };
            connectedAddress = parsed.address;
            connectedName    = parsed.name;
            _isConnected     = true;
        } catch {
            sessionStorage.removeItem(SESSION_WALLET_KEY);
        }
    }
}

export function isKeplrInstalled(): boolean {
    return typeof window.keplr !== 'undefined';
}

export function isWalletConnected(): boolean {
    return _isConnected && connectedAddress !== null;
}

export function getConnectedAddress(): string | null {
    return connectedAddress;
}

export function getConnectedName(): string | null {
    return connectedName;
}

export function formatAddress(address: string): string {
    if (address.length <= 16) return address;
    return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

export async function connectWallet(): Promise<string> {
    if (!isKeplrInstalled()) {
        throw new Error('Keplr wallet is not installed. Please install from https://www.keplr.app/');
    }

    const keplr = window.keplr!;

    await (keplr as unknown as { experimentalSuggestChain(info: unknown): Promise<void> })
        .experimentalSuggestChain(LUMERA_CHAIN_INFO);

    await keplr.enable(CHAIN_ID);

    const key = await keplr.getKey(CHAIN_ID);
    connectedAddress = key.bech32Address;
    connectedName    = key.name;
    _isConnected     = true;

    sessionStorage.setItem(
        SESSION_WALLET_KEY,
        JSON.stringify({ address: connectedAddress, name: connectedName })
    );

    return connectedAddress;
}

export function disconnectWallet(): void {
    connectedAddress = null;
    connectedName    = null;
    _isConnected     = false;
    sessionStorage.removeItem(SESSION_WALLET_KEY);
}

/**
 * Sign an arbitrary message — used to derive deterministic encryption keys.
 */
export async function signMessage(message: string): Promise<Uint8Array> {
    if (!isKeplrInstalled()) throw new Error('Keplr not installed');
    if (!connectedAddress)   throw new Error('Wallet not connected');

    const result = await window.keplr!.signArbitrary(CHAIN_ID, connectedAddress, message);

    const binary = atob(result.signature);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
