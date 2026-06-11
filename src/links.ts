/**
 * Shareable link encoding.
 *
 *   #cert/<payload>    school → student   (Cascade pointer + decryption key)
 *   #verify/<payload>  student → verifier (on-chain claim reference)
 *
 * Payloads are URL-safe base64 JSON. Self-contained (no sodium dependency)
 * so links can be parsed before crypto is initialized.
 */

import type { ClaimKey } from './midnight/encoding';

export interface CertShareLinkPayload {
    v:        2;
    /** Cascade action id holding the encrypted certificate document. */
    actionId: string;
    /** base64url XChaCha20-Poly1305 document key. */
    key:      string;
    title?:   string;
}

export interface DisclosedIdentity {
    name:   string;
    id:     string;
    /** hex-encoded idSalt — preimage material for studentIdHash. */
    idSalt: string;
}

export interface VerifyLinkPayload {
    v:               2;
    contractAddress: string;
    /** base64url certificate commitment. */
    commitment:      string;
    claimKey:        ClaimKey;
    claimParams:     Record<string, string | number>;
    txHash?:         string;
    /** Present only when the student chose to disclose identity. */
    identity?:       DisclosedIdentity;
}

// ── base64url (no padding) ───────────────────────────────────────────────────

export function bytesToB64u(bytes: Uint8Array): string {
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function b64uToBytes(s: string): Uint8Array {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function encodePayload(obj: unknown): string {
    return bytesToB64u(new TextEncoder().encode(JSON.stringify(obj)));
}

function decodePayload<T>(encoded: string): T {
    return JSON.parse(new TextDecoder().decode(b64uToBytes(encoded))) as T;
}

// ── Builders ─────────────────────────────────────────────────────────────────

function appOrigin(): string {
    return `${window.location.origin}${window.location.pathname}`;
}

export function buildCertShareLink(p: CertShareLinkPayload): string {
    return `${appOrigin()}#cert/${encodePayload(p)}`;
}

export function buildVerifyLink(p: VerifyLinkPayload): string {
    return `${appOrigin()}#verify/${encodePayload(p)}`;
}

// ── Parsers ──────────────────────────────────────────────────────────────────

export type ParsedFragment =
    | { kind: 'cert';   payload: CertShareLinkPayload }
    | { kind: 'verify'; payload: VerifyLinkPayload };

/** Parse a pasted link or a raw fragment payload. */
export function parseShareInput(input: string): ParsedFragment | null {
    const text = input.trim();
    const m = text.match(/#(cert|verify)\/([A-Za-z0-9_-]+)/);
    if (m) {
        try {
            return m[1] === 'cert'
                ? { kind: 'cert',   payload: decodePayload<CertShareLinkPayload>(m[2]) }
                : { kind: 'verify', payload: decodePayload<VerifyLinkPayload>(m[2]) };
        } catch {
            return null;
        }
    }
    // Raw base64 payload (no fragment marker): try both shapes.
    try {
        const p = decodePayload<Record<string, unknown>>(text);
        if (p.actionId && p.key) return { kind: 'cert', payload: p as unknown as CertShareLinkPayload };
        if (p.contractAddress && p.claimKey) return { kind: 'verify', payload: p as unknown as VerifyLinkPayload };
    } catch { /* fall through */ }
    return null;
}

/** Parse the current URL fragment, if it carries a share payload. */
export function parseUrlFragment(): ParsedFragment | null {
    return window.location.hash ? parseShareInput(window.location.hash) : null;
}
