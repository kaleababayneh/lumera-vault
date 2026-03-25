/**
 * Lumera Vault — Entry Point
 * "Notarize once, prove forever"
 */

import './css/style.css';
import { initUI, showStatus } from './ui';
import { parseProofFromUrl } from './midnight';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔐 Lumera Vault initializing…');

    // If there is a verify link in the URL, store it before the hash gets cleared
    const pendingProof = parseProofFromUrl();
    if (pendingProof) {
        sessionStorage.setItem('lv_pending_verify', JSON.stringify(pendingProof));
    }

    try {
        await initUI();
        console.log('✅ Lumera Vault ready');
    } catch (err) {
        console.error('Initialization error:', err);
        showStatus(`Startup error: ${String(err)}`, 'error', 0);
    }
});
