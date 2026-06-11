/**
 * Lumera Vault — Entry Point
 * "Issue once, prove forever"
 *
 * Cascade (Lumera) stores the encrypted certificate; Midnight (preprod)
 * holds its commitment + Cascade pointer and verifies ZK claims about it.
 */

import './css/style.css';
import { initUI, showStatus } from './ui';
import { parseUrlFragment } from './links';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎓 Lumera Vault initializing…');

    // Capture share links (#cert/… or #verify/…) before the hash is cleared.
    const fragment = parseUrlFragment();
    if (fragment) {
        sessionStorage.setItem('lv_pending_fragment', JSON.stringify(fragment));
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    try {
        await initUI();
        console.log('✅ Lumera Vault ready');
    } catch (err) {
        console.error('Initialization error:', err);
        showStatus(`Startup error: ${String(err)}`, 'error', 0);
    }
});
