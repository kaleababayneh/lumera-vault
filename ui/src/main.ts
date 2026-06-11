/**
 * Lumera Vault — Entry Point
 * "Issue once, prove forever"
 *
 * Cascade (Lumera) stores the encrypted certificate; Midnight (preprod)
 * holds its commitment + Cascade pointer and verifies ZK claims about it.
 */

import './globals';
import './css/style.css';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MIDNIGHT_NETWORK_ID } from './config';
import { initUI, showStatus } from './ui';
import { parseUrlFragment } from './links';

setNetworkId(MIDNIGHT_NETWORK_ID as NetworkId);

document.addEventListener('DOMContentLoaded', async () => {
    console.log(`🎓 Lumera Vault initializing… (Midnight ${MIDNIGHT_NETWORK_ID})`);

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
