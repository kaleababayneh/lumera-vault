/**
 * Cascade Module — permanent file storage on Lumera Cascade via cascade-api.
 *
 * The cascade-api backend (https://github.com/kaleababayneh/cascade-api) holds
 * the Lumera key and pays the on-chain fee, so the browser only needs an API
 * key — no Keplr / Lumera wallet involvement.
 *
 *   POST /upload              multipart "file", Authorization: Bearer <key>
 *   GET  /download/{actionId} open, streams the original bytes
 *   GET  /healthz             open, liveness + uploader ulume balance
 */

import {
    CASCADE_API_BASE,
    CASCADE_API_KEY,
    CASCADE_UPLOAD_TIMEOUT_MS,
    CASCADE_DOWNLOAD_TIMEOUT_MS,
} from './config';

export interface CascadeUploadResult {
    actionId:    string;
    txHash:      string;
    blockHeight: number;
    sizeBytes:   number;
}

export interface CascadeHealth {
    ok:            boolean;
    chainId:       string;
    uploader:      string;
    ulumeBalance:  number;
    authRequired:  boolean;
    warning?:      string;
}

export function isCascadeConfigured(): boolean {
    return CASCADE_API_KEY.length > 0;
}

export async function cascadeHealth(): Promise<CascadeHealth> {
    const res = await fetch(`${CASCADE_API_BASE}/healthz`, {
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`cascade-api health check failed: HTTP ${res.status}`);
    const j = await res.json() as Record<string, unknown>;
    return {
        ok:           j.ok === true,
        chainId:      String(j.chain_id ?? ''),
        uploader:     String(j.uploader ?? ''),
        ulumeBalance: Number(j.ulume_balance ?? 0),
        authRequired: j.auth_required === true,
        warning:      typeof j.warning === 'string' ? j.warning : undefined,
    };
}

/**
 * Upload raw bytes to Cascade permanent storage.
 * Typical end-to-end latency is 30–60s (RaptorQ encoding + Lumera tx +
 * SuperNode replication) — the progress callback is staged, not byte-level.
 */
export async function uploadToCascade(
    data:        Uint8Array,
    fileName:    string,
    onProgress?: (pct: number, label: string) => void,
): Promise<CascadeUploadResult> {
    if (!isCascadeConfigured()) {
        throw new Error('Cascade API key not configured. Set VITE_CASCADE_API_KEY in .env');
    }

    onProgress?.(10, 'Sending to cascade-api…');

    const fd = new FormData();
    fd.append('file', new Blob([data as BlobPart], { type: 'application/octet-stream' }), fileName);

    // Staged progress while the backend runs the Cascade registration (30–60s).
    let pct = 15;
    const ticker = setInterval(() => {
        pct = Math.min(90, pct + 3);
        onProgress?.(pct, 'Inscribing on Lumera Cascade (30–60s)…');
    }, 2_500);

    let res: Response;
    try {
        res = await fetch(`${CASCADE_API_BASE}/upload`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${CASCADE_API_KEY}` },
            body:    fd,
            signal:  AbortSignal.timeout(CASCADE_UPLOAD_TIMEOUT_MS),
        });
    } finally {
        clearInterval(ticker);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Cascade upload failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }

    const j = await res.json() as Record<string, unknown>;
    onProgress?.(100, 'Stored permanently on Cascade');

    return {
        actionId:    String(j.action_id ?? ''),
        txHash:      String(j.tx_hash ?? ''),
        blockHeight: Number(j.block_height ?? 0),
        sizeBytes:   Number(j.size_bytes ?? data.length),
    };
}

/**
 * Download raw bytes from Cascade by action id (no auth required).
 * ~10s warm (backend cache), ~30s cold (full SuperNode round-trip).
 */
export async function downloadFromCascade(
    actionId:    string,
    onProgress?: (pct: number, label: string) => void,
): Promise<Uint8Array> {
    if (!/^\d+$/.test(actionId)) {
        throw new Error(`Invalid Cascade action id "${actionId}" (digits only)`);
    }

    onProgress?.(15, 'Requesting from Cascade…');

    let pct = 20;
    const ticker = setInterval(() => {
        pct = Math.min(85, pct + 5);
        onProgress?.(pct, 'Reconstructing from SuperNode network…');
    }, 2_000);

    let res: Response;
    try {
        res = await fetch(`${CASCADE_API_BASE}/download/${encodeURIComponent(actionId)}`, {
            signal: AbortSignal.timeout(CASCADE_DOWNLOAD_TIMEOUT_MS),
        });
    } finally {
        clearInterval(ticker);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Cascade download failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(100, 'Downloaded');
    return buf;
}
