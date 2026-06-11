/**
 * Lumera Vault — Entry Point
 * "Issue once, prove forever"
 *
 * Cascade (Lumera) stores the encrypted certificate; Midnight (preprod)
 * holds its commitment + Cascade pointer and verifies ZK claims about it.
 *
 * IMPORTANT: the midnight stack (wasm modules with top-level await) is loaded
 * via dynamic import. Importing it statically from the entry makes Rollup
 * emit a cross-chunk evaluation order that deadlocks the bundle before any
 * event listener is attached (verified with the boot bisection probe) — the
 * dynamic path evaluates the exact same modules and completes.
 */

import './globals';
import './css/style.css';
import type { NetworkId } from '@midnight-ntwrk/midnight-js-network-id';

// Surface ANY uncaught failure in the page itself — a silent console-only
// crash otherwise looks like "buttons don't respond".
function bootError(message: string): void {
    console.error('[boot]', message);
    const el = document.getElementById('status-message');
    if (el) {
        el.textContent = `⚠️ ${message} — open the browser console for details.`;
        el.className = 'status-message status-error';
    }
}
window.addEventListener('error', (e) => { if (e.message) bootError(`Unexpected error: ${e.message}`); });
window.addEventListener('unhandledrejection', (e) =>
    bootError(`Unexpected error: ${String((e as PromiseRejectionEvent).reason)}`));

async function boot(): Promise<void> {
    console.log('🎓 Lumera Vault initializing…');

    const { MIDNIGHT_NETWORK_ID } = await import('./config');
    const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
    setNetworkId(MIDNIGHT_NETWORK_ID as NetworkId);
    console.log(`🌙 Midnight network: ${MIDNIGHT_NETWORK_ID}`);

    // Capture share links (#cert/… or #verify/…) before the hash is cleared.
    const { parseUrlFragment } = await import('./links');
    const fragment = parseUrlFragment();
    if (fragment) {
        sessionStorage.setItem('lv_pending_fragment', JSON.stringify(fragment));
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const { initUI, showStatus } = await import('./ui');
    try {
        await initUI();
        console.log('✅ Lumera Vault ready');
    } catch (err) {
        console.error('Initialization error:', err);
        showStatus(`Startup error: ${String(err)}`, 'error', 0);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot().catch(e => bootError(String(e))));
} else {
    void boot().catch(e => bootError(String(e)));
}
