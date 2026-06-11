/**
 * UI Module — Lumera Vault
 *
 * Tabs: Issue (school) | My Certificates (student) | Prove (student)
 *       | Verify (anyone, wallet-less) | History
 *
 * Storage: Lumera Cascade via cascade-api (no Lumera wallet needed).
 * Chain:   Midnight preprod via the 1AM wallet (fees sponsored — gasless).
 */

import {
    connectWallet,
    disconnectWallet,
    restoreWalletSession,
    isWalletConnected,
    getConnectedApi,
    getWalletName,
    getShieldedAddress,
    formatAddress,
} from './midnight/wallet';
import { buildProviders } from './midnight/providers';
import { CertificateRegistry } from './midnight/registry';
import type { CertProviders } from './midnight/common-types';
import {
    encodeCertificate,
    commitmentOf,
    newSalts,
    prepareClaim,
    satisfiesClaim,
    type CertificateFields,
    type ClaimKey,
} from './midnight/encoding';
import { verifyClaimOnChain, type OnChainVerificationResult } from './midnight/verifier';
import {
    publishCertificateDocument,
    importCertificateFromLink,
    listStudentCerts,
    getStudentCert,
    removeStudentCert,
    listIssued,
    recordIssued,
    markIssuedRevoked,
    listProofHistory,
    addProofHistory,
    removeProofHistory,
    type CertificateDocument,
} from './vault';
import {
    buildCertShareLink,
    buildVerifyLink,
    parseShareInput,
    parseUrlFragment,
    bytesToB64u,
    b64uToBytes,
    type CertShareLinkPayload,
    type VerifyLinkPayload,
    type ParsedFragment,
} from './links';
import { cascadeHealth, isCascadeConfigured } from './cascade';
import { initCrypto, toHex } from './crypto';
import { CERT_FORM_FIELDS, CLAIMS, CLAIM_KEYS, type FieldDef } from './schemas';
import {
    CONTRACT_ADDRESS_KEY,
    DEFAULT_CONTRACT_ADDRESS,
    MIDNIGHT_NETWORK_ID,
    CASCADE_API_BASE,
    DEGREE_LEVELS,
} from './config';

// ── State ─────────────────────────────────────────────────────────────────────

let providers: CertProviders | null = null;
let registry:  CertificateRegistry | null = null;

let proveCertActionId: string | null = null;
let proveClaimKey:     ClaimKey | null = null;

// ── Contract address ──────────────────────────────────────────────────────────

function getContractAddress(): string {
    return localStorage.getItem(CONTRACT_ADDRESS_KEY) ?? DEFAULT_CONTRACT_ADDRESS;
}

function setContractAddress(address: string): void {
    localStorage.setItem(CONTRACT_ADDRESS_KEY, address.trim());
    registry = null; // force re-join on next use
}

// ── Boot ──────────────────────────────────────────────────────────────────────

export async function initUI(): Promise<void> {
    // NOTE: no awaits before the event listeners are wired — if any async init
    // hangs or fails, the buttons must still respond. Crypto (libsodium) is
    // initialized lazily inside the flows that actually hash/encrypt.
    q<HTMLButtonElement>('#wallet-button').addEventListener('click', handleWalletClick);

    qa('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => switchTab((btn as HTMLElement).dataset.tab!));
    });

    // Issue tab
    renderIssueForm();
    q('#issue-button').addEventListener('click', handleIssueCertificate);

    // Certificates tab
    q('#import-button').addEventListener('click', handleImportClick);

    // Prove tab
    qa('.prove-step-back').forEach(btn => {
        (btn as HTMLElement).addEventListener('click', () => {
            showProveStep(Number((btn as HTMLElement).dataset.to));
            if ((btn as HTMLElement).dataset.to === '1') renderProveCertList();
        });
    });
    q('#generate-proof-button').addEventListener('click', handleGenerateProof);

    // Verify tab
    q('#verify-button').addEventListener('click', () => void handleVerifyClick());
    q('#verify-input').addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
            e.preventDefault();
            void handleVerifyClick();
        }
    });

    // Settings modal
    q('#open-settings').addEventListener('click', openSettings);
    q('#close-settings').addEventListener('click', closeSettings);
    q('#settings-overlay').addEventListener('click', closeSettings);
    q('#save-contract-address').addEventListener('click', handleSaveContractAddress);
    q('#deploy-registry-button').addEventListener('click', () => void handleDeployRegistry());

    renderAll();

    // All listeners wired and first paint done — the boot watchdog stands down.
    (window as unknown as { __LV_READY?: boolean }).__LV_READY = true;

    if (!isCascadeConfigured()) {
        showStatus('⚠️ VITE_CASCADE_API_KEY is not set — Cascade uploads will fail. See .env.example.', 'warning', 10000);
    }

    // Silent wallet session restore (only re-connects if previously connected).
    restoreWalletSession()
        .then(api => {
            if (api) return afterWalletConnected();
        })
        .catch(() => { /* user can connect manually */ });

    // Handle share links in the URL.
    const pending = sessionStorage.getItem('lv_pending_fragment');
    if (pending) {
        sessionStorage.removeItem('lv_pending_fragment');
        try {
            await handleIncomingFragment(JSON.parse(pending) as ParsedFragment);
        } catch (err) {
            showStatus(`Could not handle the shared link: ${String(err)}`, 'error');
        }
    } else {
        const frag = parseUrlFragment();
        if (frag) {
            window.history.replaceState({}, document.title, window.location.pathname);
            await handleIncomingFragment(frag);
        }
    }
}

async function handleIncomingFragment(frag: ParsedFragment): Promise<void> {
    if (frag.kind === 'cert') {
        switchTab('certs');
        q<HTMLTextAreaElement>('#import-input').value = buildCertShareLink(frag.payload);
        await runImport(frag.payload);
    } else {
        switchTab('verify');
        q<HTMLTextAreaElement>('#verify-input').value = buildVerifyLink(frag.payload);
        await runVerify(frag.payload);
    }
}

// ── Wallet ────────────────────────────────────────────────────────────────────

async function handleWalletClick(): Promise<void> {
    if (isWalletConnected()) {
        disconnectWallet();
        providers = null;
        registry = null;
        updateWalletUI();
        showStatus('Wallet disconnected.', 'info');
        return;
    }

    const btn = q<HTMLButtonElement>('#wallet-button');
    btn.disabled = true;
    btn.textContent = 'Connecting…';

    try {
        await connectWallet();
        await afterWalletConnected();
        showStatus(`Connected to ${getWalletName() ?? 'wallet'} on Midnight ${MIDNIGHT_NETWORK_ID} — fees sponsored ⚡`, 'success');
    } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Connect 1AM Wallet';
        showStatus(`Connection failed: ${String(err)}`, 'error', 9000);
    }
}

async function afterWalletConnected(): Promise<void> {
    const api = getConnectedApi();
    if (!api) return;
    providers = await buildProviders(api);
    updateWalletUI();
}

function updateWalletUI(): void {
    const btn    = q<HTMLButtonElement>('#wallet-button');
    const status = q('#wallet-status');

    if (isWalletConnected()) {
        const addr = getShieldedAddress() ?? '';
        btn.textContent = 'Disconnect';
        btn.className = 'btn-disconnect';
        btn.disabled = false;
        status.textContent = `${getWalletName() ?? 'wallet'} · ${formatAddress(addr)}`;
        status.className = 'wallet-address';
        q('#gasless-badge').classList.remove('hidden');
    } else {
        btn.textContent = 'Connect 1AM Wallet';
        btn.className = 'btn-primary';
        btn.disabled = false;
        status.textContent = '';
        status.className = '';
        q('#gasless-badge').classList.add('hidden');
    }
}

/** Join (or return the cached) registry contract. Requires wallet + address. */
async function ensureRegistry(): Promise<CertificateRegistry> {
    if (!providers) {
        throw new Error('Connect the 1AM wallet first.');
    }
    const address = getContractAddress();
    if (!address) {
        throw new Error('No registry contract configured. Open ⚙️ Registry Settings to deploy one or paste an address.');
    }
    if (registry && registry.address === address) return registry;
    registry = await CertificateRegistry.join(providers, address);
    return registry;
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab: string): void {
    qa('.tab-button').forEach(btn => {
        (btn as HTMLButtonElement).classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });
    qa('.tab-content').forEach(el => {
        (el as HTMLElement).classList.toggle('active', (el as HTMLElement).id === `tab-${tab}`);
    });

    if (tab === 'prove')   renderProveCertList();
    if (tab === 'history') renderHistory();
    if (tab === 'certs')   renderStudentCerts();
    if (tab === 'issue')   renderIssuedList();
}

function renderAll(): void {
    renderIssuedList();
    renderStudentCerts();
    renderHistory();
    updateWalletUI();
}

// ── ISSUE TAB ─────────────────────────────────────────────────────────────────

function renderIssueForm(): void {
    const form = q('#issue-fields-form');
    const fieldsHtml = (Object.entries(CERT_FORM_FIELDS) as [string, FieldDef][])
        .map(([key, def]) => fieldInputHtml(`field_${key}`, def))
        .join('');
    form.innerHTML = `
        <div class="form-group">
            <label for="cert-title">Certificate Title <span class="required">*</span></label>
            <input type="text" id="cert-title" placeholder="BSc Computer Engineering — Class of 2025" required />
        </div>
        ${fieldsHtml}`;
}

function fieldInputHtml(id: string, def: FieldDef): string {
    const required = def.optional ? '' : ' <span class="required">*</span>';
    let input: string;
    if (def.type === 'enum' && def.values) {
        input = `<select id="${id}">${def.values.map(v => `<option value="${escAttr(v)}">${escHtml(v)}</option>`).join('')}</select>`;
    } else if (def.type === 'boolean') {
        input = `<label class="checkbox-label"><input type="checkbox" id="${id}" checked /><span>Yes</span></label>`;
    } else if (def.type === 'number') {
        const attrs = [
            def.min !== undefined ? `min="${def.min}"` : '',
            def.max !== undefined ? `max="${def.max}"` : '',
            `step="${def.step ?? 'any'}"`,
        ].join(' ');
        input = `<input type="number" id="${id}" placeholder="${escAttr(def.placeholder ?? '')}" ${attrs} />`;
    } else {
        input = `<input type="text" id="${id}" placeholder="${escAttr(def.placeholder ?? '')}" />`;
    }
    return `<div class="form-group"><label for="${id}">${escHtml(def.label)}${required}</label>${input}</div>`;
}

function collectCertificateFields(): { title: string; fields: CertificateFields } {
    const title = q<HTMLInputElement>('#cert-title').value.trim();
    if (!title) throw new Error('Certificate title is required.');

    const getStr = (key: string): string =>
        (document.getElementById(`field_${key}`) as HTMLInputElement | HTMLSelectElement).value.trim();

    const studentName    = getStr('studentName');
    const studentId      = getStr('studentId');
    const institution    = getStr('institution');
    const degreeType     = getStr('degreeType') as CertificateFields['degreeType'];
    const fieldOfStudy   = getStr('fieldOfStudy');
    const yearRaw        = getStr('graduationYear');
    const accredited     = (document.getElementById('field_accredited') as HTMLInputElement).checked;
    const gpaRaw         = getStr('gpa');

    if (!studentName || !studentId || !institution || !fieldOfStudy || !yearRaw) {
        throw new Error('Please fill in all required fields.');
    }
    const graduationYear = parseInt(yearRaw, 10);
    if (Number.isNaN(graduationYear)) throw new Error('Graduation year must be a number.');
    const gpa = gpaRaw === '' ? null : Number(gpaRaw);
    if (gpa !== null && (Number.isNaN(gpa) || gpa < 0 || gpa > 4)) {
        throw new Error('GPA must be between 0 and 4.');
    }

    return {
        title,
        fields: { studentName, studentId, institution, degreeType, fieldOfStudy, graduationYear, accredited, gpa },
    };
}

async function handleIssueCertificate(): Promise<void> {
    let title: string;
    let fields: CertificateFields;
    try {
        ({ title, fields } = collectCertificateFields());
    } catch (err) {
        showStatus(String(err instanceof Error ? err.message : err), 'error');
        return;
    }

    const progress = (pct: number, label: string) => {
        q<HTMLElement>('#issue-progress-fill').style.width = `${pct}%`;
        q('#issue-progress-text').textContent = label;
    };

    q('#issue-form-panel').classList.add('hidden');
    q('#issue-result-panel').classList.add('hidden');
    q('#issue-progress-panel').classList.remove('hidden');

    try {
        await initCrypto();

        // The registry must be reachable before we inscribe anything permanent.
        progress(2, 'Joining registry contract…');
        const reg = await ensureRegistry();

        // 1. Encode + commit.
        progress(8, 'Computing certificate commitment…');
        const { salt, idSalt } = newSalts();
        const cert = encodeCertificate(fields, salt, idSalt);
        const commitment = commitmentOf(cert);
        const commitmentB64 = bytesToB64u(commitment);

        // 2. Encrypt + inscribe on Cascade (30–60s).
        const doc: CertificateDocument = {
            v: 2,
            type: 'lumera-vault/academic-credential',
            title,
            fields,
            salt: bytesToB64u(salt),
            idSalt: bytesToB64u(idSalt),
            commitment: commitmentB64,
            contractAddress: reg.address,
            issuedAt: Date.now(),
        };
        const published = await publishCertificateDocument(doc, (pct, label) =>
            progress(8 + Math.round(pct * 0.52), label));

        // 3. Anchor on Midnight: commitment + Cascade pointer.
        progress(64, 'Anchoring on Midnight (ZK proof via ProofStation)…');
        const tx = await reg.issueCertificate(commitment, published.actionId);

        progress(96, 'Building student share link…');
        const shareLink = buildCertShareLink({
            v: 2,
            actionId: published.actionId,
            key: published.keyB64u,
            title,
        });

        recordIssued({
            title,
            studentName: fields.studentName,
            actionId: published.actionId,
            commitment: commitmentB64,
            shareLink,
            txHash: tx.txHash,
            issuedAt: Date.now(),
            revoked: false,
        });

        progress(100, 'Done');
        renderIssueResult({ title, fields, actionId: published.actionId, cascadeTx: published.txHash, midnightTx: tx.txHash, commitmentB64, shareLink });
        renderIssuedList();
        showStatus('✅ Certificate issued: stored on Cascade & anchored on Midnight.', 'success', 8000);
    } catch (err) {
        q('#issue-progress-panel').classList.add('hidden');
        q('#issue-form-panel').classList.remove('hidden');
        showStatus(`Issuing failed: ${friendlyError(err)}`, 'error', 12000);
        return;
    }
    q('#issue-progress-panel').classList.add('hidden');
}

interface IssueResultInfo {
    title:         string;
    fields:        CertificateFields;
    actionId:      string;
    cascadeTx:     string;
    midnightTx:    string;
    commitmentB64: string;
    shareLink:     string;
}

function renderIssueResult(r: IssueResultInfo): void {
    const panel = q('#issue-result-panel');
    panel.classList.remove('hidden');
    panel.innerHTML = `
        <div class="proof-result-card proof-pass">
            <div class="proof-verdict-badge verdict-pass">✅ CERTIFICATE ISSUED</div>
            <h3 class="proof-description">${escHtml(r.title)} — ${escHtml(r.fields.studentName)}</h3>
            <div class="proof-details-grid">
                <div class="proof-detail"><span class="proof-detail-label">Cascade Action ID</span><span class="mono">${escHtml(r.actionId)}</span></div>
                <div class="proof-detail"><span class="proof-detail-label">Lumera Tx</span><span class="mono truncate" title="${escAttr(r.cascadeTx)}">${escHtml(r.cascadeTx.slice(0, 20))}…</span></div>
                <div class="proof-detail"><span class="proof-detail-label">Midnight Tx</span><span class="mono truncate" title="${escAttr(r.midnightTx)}">${escHtml(r.midnightTx.slice(0, 20))}…</span></div>
                <div class="proof-detail"><span class="proof-detail-label">Commitment</span><span class="mono truncate" title="${escAttr(r.commitmentB64)}">${escHtml(r.commitmentB64.slice(0, 24))}…</span></div>
            </div>
            <div class="proof-share-section">
                <p class="share-label">Hand this link to the student — it contains the Cascade pointer <em>and</em> the decryption key:</p>
                <div class="share-row">
                    <input id="issue-share-link" type="text" readonly value="${escAttr(r.shareLink)}" />
                    <button id="copy-issue-link" class="btn-primary btn-sm">Copy</button>
                </div>
            </div>
            <div style="margin-top:1rem;">
                <button id="issue-another" class="btn-ghost btn-sm">+ Issue Another</button>
            </div>
        </div>`;

    q('#copy-issue-link').addEventListener('click', () => copyToClipboard(r.shareLink, '#copy-issue-link'));
    q('#issue-another').addEventListener('click', () => {
        panel.classList.add('hidden');
        q('#issue-form-panel').classList.remove('hidden');
    });
}

function renderIssuedList(): void {
    const container = q('#issued-list-container');
    const issued = listIssued();
    if (issued.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📜</div><p>No certificates issued from this browser yet.</p></div>`;
        return;
    }
    container.innerHTML = issued.map((e, i) => `
        <div class="history-row">
            <div class="history-left">
                <span class="history-schema-icon" style="color:#6366f1">🎓</span>
                <div class="history-meta">
                    <div class="history-title">${escHtml(e.title)} — ${escHtml(e.studentName)} ${e.revoked ? '<span class="badge badge-error">Revoked</span>' : ''}</div>
                    <div class="history-sub">Cascade #${escHtml(e.actionId)} · ${new Date(e.issuedAt).toLocaleString()}</div>
                    <div class="history-proofid mono" title="${escAttr(e.commitment)}">${escHtml(e.commitment.slice(0, 28))}…</div>
                </div>
            </div>
            <div class="history-right">
                <button class="btn-ghost btn-xs" data-action="copy-issued" data-i="${i}">Copy Link</button>
                ${e.revoked ? '' : `<button class="btn-ghost btn-xs" data-action="revoke" data-i="${i}">⛔ Revoke</button>`}
            </div>
        </div>`).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-action="copy-issued"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const e = listIssued()[Number(btn.dataset.i)];
            if (e) void navigator.clipboard.writeText(e.shareLink).then(() => showStatus('Share link copied.', 'info', 2500));
        });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-action="revoke"]').forEach(btn => {
        btn.addEventListener('click', () => void handleRevoke(Number(btn.dataset.i)));
    });
}

async function handleRevoke(index: number): Promise<void> {
    const entry = listIssued()[index];
    if (!entry) return;
    if (!confirm(`Revoke "${entry.title}" for ${entry.studentName}? Verifiers will see it as revoked.`)) return;
    try {
        const reg = await ensureRegistry();
        showStatus('Submitting revocation to Midnight…', 'info', 0);
        await reg.revokeCertificate(b64uToBytes(entry.commitment));
        markIssuedRevoked(entry.commitment);
        renderIssuedList();
        showStatus('Certificate revoked on-chain.', 'success');
    } catch (err) {
        showStatus(`Revocation failed: ${friendlyError(err)}`, 'error', 9000);
    }
}

// ── MY CERTIFICATES TAB ───────────────────────────────────────────────────────

async function handleImportClick(): Promise<void> {
    const input = q<HTMLTextAreaElement>('#import-input').value.trim();
    if (!input) { showStatus('Paste a certificate link first.', 'warning'); return; }
    const parsed = parseShareInput(input);
    if (!parsed || parsed.kind !== 'cert') {
        showStatus('That does not look like a certificate link (expected …#cert/…).', 'error');
        return;
    }
    await runImport(parsed.payload);
}

async function runImport(payload: CertShareLinkPayload): Promise<void> {
    const progressEl = q('#import-progress');
    progressEl.classList.remove('hidden');
    const progress = (pct: number, label: string) => {
        q<HTMLElement>('#import-progress-fill').style.width = `${pct}%`;
        q('#import-progress-text').textContent = label;
    };
    try {
        await initCrypto();
        const cert = await importCertificateFromLink(payload, progress);
        progressEl.classList.add('hidden');
        q<HTMLTextAreaElement>('#import-input').value = '';
        renderStudentCerts();
        showStatus(`✅ "${cert.title}" imported — fetched from Cascade and decrypted locally.`, 'success');
    } catch (err) {
        progressEl.classList.add('hidden');
        showStatus(`Import failed: ${friendlyError(err)}`, 'error', 10000);
    }
}

function certSummary(doc: CertificateDocument): string {
    const f = doc.fields;
    return `${f.degreeType} in ${f.fieldOfStudy}, ${f.institution} (${f.graduationYear})`;
}

function renderStudentCerts(): void {
    const container = q('#student-certs-container');
    const certs = listStudentCerts();
    if (certs.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎓</div><p>No certificates yet.</p><p class="empty-sub">Paste the share link from your school above.</p></div>`;
        return;
    }
    container.innerHTML = certs.map(c => `
        <div class="document-card">
            <div class="doc-card-header">
                <div class="doc-icon" style="background:#6366f122; color:#6366f1">🎓</div>
                <div class="doc-meta">
                    <h3 class="doc-title">${escHtml(c.title)}</h3>
                    <div class="doc-badges">
                        <span class="badge" style="background:#6366f122; color:#6366f1">${escHtml(c.doc.fields.studentName)}</span>
                        <span class="badge badge-success">Cascade #${escHtml(c.actionId)}</span>
                    </div>
                </div>
            </div>
            <div class="doc-card-body">
                <div class="doc-detail"><span class="doc-detail-label">Certificate</span><span>${escHtml(certSummary(c.doc))}</span></div>
                <div class="doc-detail"><span class="doc-detail-label">Imported</span><span>${new Date(c.importedAt).toLocaleDateString()}</span></div>
                <div class="doc-detail doc-detail-mono"><span class="doc-detail-label">Commitment</span><span class="mono truncate" title="${escAttr(c.doc.commitment)}">${escHtml(c.doc.commitment.slice(0, 22))}…</span></div>
                <div class="doc-detail doc-detail-mono"><span class="doc-detail-label">Registry</span><span class="mono truncate" title="${escAttr(c.doc.contractAddress)}">${escHtml(c.doc.contractAddress.slice(0, 22))}…</span></div>
            </div>
            <div class="doc-card-actions">
                <button class="btn-primary btn-sm" data-action="prove-cert" data-id="${escAttr(c.actionId)}">🔐 Prove a Claim</button>
                <button class="btn-ghost btn-sm" data-action="copy-cert-link" data-id="${escAttr(c.actionId)}">Copy Link</button>
                <button class="btn-ghost btn-sm" data-action="remove-cert" data-id="${escAttr(c.actionId)}">🗑 Remove</button>
            </div>
        </div>`).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-action="prove-cert"]').forEach(btn => {
        btn.addEventListener('click', () => {
            proveCertActionId = btn.dataset.id!;
            switchTab('prove');
            const cert = getStudentCert(proveCertActionId);
            if (cert) {
                q('#prove-selected-cert').textContent = cert.title;
                renderProveClaimList();
                showProveStep(2);
            }
        });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-action="copy-cert-link"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const c = getStudentCert(btn.dataset.id!);
            if (!c) return;
            const link = buildCertShareLink({ v: 2, actionId: c.actionId, key: c.keyB64u, title: c.title });
            void navigator.clipboard.writeText(link).then(() => showStatus('Certificate link copied.', 'info', 2500));
        });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-action="remove-cert"]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Remove this certificate from this browser? (It stays on Cascade forever — re-import any time with the link.)')) return;
            removeStudentCert(btn.dataset.id!);
            renderStudentCerts();
        });
    });
}

// ── PROVE TAB ─────────────────────────────────────────────────────────────────

function showProveStep(step: number): void {
    [1, 2, 3, 4].forEach(n => {
        const el = document.getElementById(`prove-step-${n}`);
        if (el) el.classList.toggle('hidden', n !== step);
    });
}

function renderProveCertList(): void {
    showProveStep(1);
    proveClaimKey = null;

    const container = q('#prove-certs-container');
    const certs = listStudentCerts();
    if (certs.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No certificates imported. Go to 🎓 My Certificates and paste your share link first.</p></div>`;
        return;
    }
    container.innerHTML = certs.map(c => `
        <button class="selectable-card" data-id="${escAttr(c.actionId)}">
            <span class="sel-card-icon" style="color:#6366f1">🎓</span>
            <span class="sel-card-info">
                <span class="sel-card-title">${escHtml(c.title)}</span>
                <span class="sel-card-sub">${escHtml(certSummary(c.doc))}</span>
            </span>
            <span class="sel-card-arrow">→</span>
        </button>`).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            proveCertActionId = btn.dataset.id!;
            const cert = getStudentCert(proveCertActionId);
            q('#prove-selected-cert').textContent = cert?.title ?? '';
            renderProveClaimList();
            showProveStep(2);
        });
    });
}

function renderProveClaimList(): void {
    const container = q('#prove-claims-container');
    container.innerHTML = CLAIM_KEYS.map(key => {
        const def = CLAIMS[key];
        return `
        <button class="selectable-card" data-claim="${key}">
            <span class="sel-card-icon" style="color:#6366f1">🔐</span>
            <span class="sel-card-info">
                <span class="sel-card-title">${escHtml(def.label)}</span>
                <span class="sel-card-sub">${escHtml(def.description)}</span>
            </span>
            <span class="sel-card-arrow">→</span>
        </button>`;
    }).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-claim]').forEach(btn => {
        btn.addEventListener('click', () => {
            proveClaimKey = btn.dataset.claim as ClaimKey;
            q('#prove-selected-claim').textContent = CLAIMS[proveClaimKey].label;
            const certTitle = getStudentCert(proveCertActionId ?? '')?.title ?? '';
            q('#prove-selected-cert-3').textContent = certTitle;
            renderProveParamsForm();
            showProveStep(3);
        });
    });
}

function renderProveParamsForm(): void {
    if (!proveClaimKey) return;
    const def = CLAIMS[proveClaimKey];
    const container = q('#prove-params-form');
    if (def.params.length === 0) {
        container.innerHTML = `<p class="no-params-notice">No parameters needed — this claim is self-contained.</p>`;
        return;
    }
    container.innerHTML = def.params.map(param => {
        let input: string;
        if (param.type === 'enum' && param.values) {
            input = `<select id="param_${param.name}">${param.values.map(v => `<option value="${escAttr(v)}">${escHtml(v)}</option>`).join('')}</select>`;
        } else if (param.type === 'number') {
            input = `<input type="number" id="param_${param.name}" placeholder="${escAttr(param.placeholder ?? '')}" step="any" />`;
        } else {
            input = `<input type="text" id="param_${param.name}" placeholder="${escAttr(param.placeholder ?? '')}" />`;
        }
        return `<div class="form-group"><label for="param_${param.name}">${escHtml(param.label)}</label>${input}</div>`;
    }).join('');
}

function collectClaimParams(): Record<string, string | number> {
    if (!proveClaimKey) return {};
    const out: Record<string, string | number> = {};
    for (const param of CLAIMS[proveClaimKey].params) {
        const el = document.getElementById(`param_${param.name}`) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) continue;
        const raw = el.value.trim();
        if (!raw) throw new Error(`Parameter "${param.label}" is required.`);
        out[param.name] = param.type === 'number' ? Number(raw) : raw;
    }
    return out;
}

async function handleGenerateProof(): Promise<void> {
    if (!proveCertActionId || !proveClaimKey) return;
    const studentCert = getStudentCert(proveCertActionId);
    if (!studentCert) { showStatus('Certificate not found in vault.', 'error'); return; }
    await initCrypto();

    let claimParams: Record<string, string | number>;
    try {
        claimParams = collectClaimParams();
    } catch (err) {
        showStatus(String(err instanceof Error ? err.message : err), 'error');
        return;
    }
    const discloseIdentity = q<HTMLInputElement>('#prove-disclose-identity').checked;

    const doc = studentCert.doc;
    const cert = encodeCertificate(doc.fields, b64uToBytes(doc.salt), b64uToBytes(doc.idSalt));
    const commitment = commitmentOf(cert);
    if (bytesToB64u(commitment) !== doc.commitment) {
        showStatus('Certificate document is inconsistent (commitment mismatch) — contact the issuer.', 'error', 10000);
        return;
    }

    const claim = prepareClaim(proveClaimKey, claimParams);

    // Pre-flight: an unsatisfied claim can never produce a valid ZK proof.
    if (!satisfiesClaim(cert, claim)) {
        showStatus(`❌ Your certificate does not satisfy "${claim.description}" — no proof is possible. (This is the ZK guarantee working.)`, 'warning', 10000);
        return;
    }

    const btn = q<HTMLButtonElement>('#generate-proof-button');
    btn.disabled = true;
    btn.textContent = '⚡ Proving…';
    showProveStep(4);
    renderProofInProgress();

    try {
        const reg = await ensureRegistry();
        if (reg.address !== doc.contractAddress) {
            showStatus(`Note: this certificate was issued on registry ${doc.contractAddress.slice(0, 18)}… — switching to it.`, 'info', 6000);
            setContractAddress(doc.contractAddress);
        }
        const reg2 = await ensureRegistry();

        markProofStep(1);
        let tx;
        switch (claim.claimKey) {
            case 'has_degree_in':
                tx = await reg2.proveDegreeInField(cert, claim.hashParam); break;
            case 'graduated_from_accredited':
                tx = await reg2.proveAccredited(cert); break;
            case 'degree_level_at_least':
                tx = await reg2.proveDegreeLevelAtLeast(cert, claim.numericParam); break;
            case 'gpa_above':
                tx = await reg2.proveGpaAbove(cert, claim.numericParam); break;
        }
        markProofStep(4);

        const link = buildVerifyLink({
            v: 2,
            contractAddress: doc.contractAddress,
            commitment: doc.commitment,
            claimKey: claim.claimKey,
            claimParams,
            txHash: tx.txHash,
            identity: discloseIdentity
                ? {
                      name: doc.fields.studentName,
                      id: doc.fields.studentId,
                      idSalt: toHex(b64uToBytes(doc.idSalt)),
                  }
                : undefined,
        });

        addProofHistory({
            description: claim.description,
            certTitle: studentCert.title,
            link,
            txHash: tx.txHash,
            when: Date.now(),
        });

        renderProofResult(claim.description, tx.txHash, link, discloseIdentity);
        showStatus('✅ ZK proof recorded on Midnight.', 'success');
    } catch (err) {
        showProveStep(3);
        showStatus(`Proof generation failed: ${friendlyError(err)}`, 'error', 12000);
    } finally {
        btn.disabled = false;
        btn.textContent = '⚡ Generate ZK Proof';
    }
}

function renderProofInProgress(): void {
    q('#prove-result-container').innerHTML = `
        <div class="proof-generating">
            <div class="zk-spinner"></div>
            <p id="proof-gen-label" class="proof-gen-label">Running the Compact circuit…</p>
            <div class="midnight-steps">
                <div class="mid-step" id="mid-step-1">⏳ Loading certificate witness</div>
                <div class="mid-step" id="mid-step-2">⏳ Generating ZK proof (ProofStation, ~2–5s)</div>
                <div class="mid-step" id="mid-step-3">⏳ Balancing transaction (fees sponsored)</div>
                <div class="mid-step" id="mid-step-4">⏳ Submitting to Midnight preprod</div>
            </div>
        </div>`;
}

function markProofStep(upTo: number): void {
    for (let i = 1; i <= upTo; i++) {
        const el = document.getElementById(`mid-step-${i}`);
        if (el) {
            el.textContent = (el.textContent ?? '').replace('⏳', '✅');
            el.classList.add('done');
        }
    }
}

function renderProofResult(description: string, txHash: string, link: string, identityDisclosed: boolean): void {
    q('#prove-result-container').innerHTML = `
        <div class="proof-result-card proof-pass">
            <div class="proof-verdict-badge verdict-pass">✅ PROOF RECORDED ON MIDNIGHT</div>
            <h3 class="proof-description">${escHtml(description)}</h3>
            <div class="proof-details-grid">
                <div class="proof-detail"><span class="proof-detail-label">Midnight Tx</span><span class="mono truncate" title="${escAttr(txHash)}">${escHtml(txHash.slice(0, 24))}…</span></div>
                <div class="proof-detail"><span class="proof-detail-label">Network</span><span>Midnight ${escHtml(MIDNIGHT_NETWORK_ID)}</span></div>
                <div class="proof-detail"><span class="proof-detail-label">Identity</span><span>${identityDisclosed ? 'Disclosed to verifier' : 'Not disclosed'}</span></div>
                <div class="proof-detail"><span class="proof-detail-label">Cost</span><span>0 — sponsored by ProofStation ⚡</span></div>
            </div>
            <div class="proof-share-section">
                <p class="share-label">Share this link with the verifier:</p>
                <div class="share-row">
                    <input type="text" readonly value="${escAttr(link)}" />
                    <button id="copy-proof-link" class="btn-primary btn-sm">Copy</button>
                </div>
            </div>
        </div>`;
    q('#copy-proof-link').addEventListener('click', () => copyToClipboard(link, '#copy-proof-link'));
}

// ── VERIFY TAB ────────────────────────────────────────────────────────────────

async function handleVerifyClick(): Promise<void> {
    const input = q<HTMLTextAreaElement>('#verify-input').value.trim();
    if (!input) { showStatus('Paste a proof link first.', 'warning'); return; }
    const parsed = parseShareInput(input);
    if (!parsed || parsed.kind !== 'verify') {
        showStatus('That does not look like a proof link (expected …#verify/…).', 'error');
        return;
    }
    await runVerify(parsed.payload);
}

async function runVerify(payload: VerifyLinkPayload): Promise<void> {
    const container = q('#verify-result');
    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="proof-generating">
            <div class="zk-spinner"></div>
            <p class="proof-gen-label">Querying the Midnight indexer…</p>
        </div>`;
    try {
        await initCrypto();
        const result = await verifyClaimOnChain(payload);
        renderVerifyResult(result, payload);
    } catch (err) {
        container.innerHTML = `<div class="verify-result-card proof-invalid"><div class="verify-error">${escHtml(friendlyError(err))}</div></div>`;
    }
}

function renderVerifyResult(result: OnChainVerificationResult, payload: VerifyLinkPayload): void {
    const container = q('#verify-result');
    const checksHtml = result.checks.map(c => `
        <div class="mid-step ${c.ok ? 'done' : ''}" style="${c.ok ? '' : 'color:#ef4444;'}">
            ${c.ok ? '✅' : '❌'} ${escHtml(c.label)}${c.detail ? ` <span class="mono" style="opacity:.7; font-size:.85em;">· ${escHtml(c.detail)}</span>` : ''}
        </div>`).join('');

    container.innerHTML = `
        <div class="verify-result-card ${result.valid ? 'proof-pass' : 'proof-fail'}">
            <div class="verify-header">
                <div class="verify-icon">${result.valid ? '✅' : '❌'}</div>
                <div>
                    <div class="verify-verdict ${result.valid ? 'verdict-pass' : 'verdict-fail'}">
                        ${result.valid ? 'CLAIM VERIFIED ON-CHAIN' : 'VERIFICATION FAILED'}
                    </div>
                    <div class="verify-summary">${escHtml(result.description)}</div>
                </div>
            </div>

            <div class="midnight-steps" style="margin-top:1rem;">${checksHtml}</div>

            <div class="verify-details" style="margin-top:1rem;">
                ${payload.identity ? `<div class="proof-detail"><span class="proof-detail-label">Student</span><span>${escHtml(payload.identity.name)} (${escHtml(payload.identity.id)})</span></div>` : ''}
                <div class="proof-detail"><span class="proof-detail-label">Registry</span><span class="mono truncate" title="${escAttr(payload.contractAddress)}">${escHtml(payload.contractAddress.slice(0, 26))}…</span></div>
                ${result.cascadeId ? `<div class="proof-detail"><span class="proof-detail-label">Document</span><span>Lumera Cascade action #${escHtml(result.cascadeId)} (encrypted)</span></div>` : ''}
                ${payload.txHash ? `<div class="proof-detail"><span class="proof-detail-label">Proof Tx</span><span class="mono truncate" title="${escAttr(payload.txHash)}">${escHtml(payload.txHash.slice(0, 26))}…</span></div>` : ''}
                <div class="proof-detail"><span class="proof-detail-label">Network</span><span>Midnight ${escHtml(MIDNIGHT_NETWORK_ID)} · checked live via indexer</span></div>
            </div>

            <div class="verify-disclaimer">
                🌙 Verified against the Midnight ${escHtml(MIDNIGHT_NETWORK_ID)} ledger — the document itself stays encrypted on Lumera Cascade.
            </div>
        </div>`;
}

// ── HISTORY TAB ───────────────────────────────────────────────────────────────

function renderHistory(): void {
    const container = q('#proof-history-container');
    const records = listProofHistory();
    if (records.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No proofs generated yet.</p></div>`;
        return;
    }
    container.innerHTML = records.map(r => `
        <div class="history-row">
            <div class="history-left">
                <span class="history-schema-icon" style="color:#6366f1">🔐</span>
                <div class="history-meta">
                    <div class="history-title">${escHtml(r.description)}</div>
                    <div class="history-sub">${escHtml(r.certTitle)} · ${new Date(r.when).toLocaleString()}</div>
                    <div class="history-proofid mono" title="${escAttr(r.txHash)}">${escHtml(r.txHash.slice(0, 30))}…</div>
                </div>
            </div>
            <div class="history-right">
                <button class="btn-ghost btn-xs" data-action="copy-link" data-link="${escAttr(r.link)}">Copy Link</button>
                <button class="btn-ghost btn-xs" data-action="delete-proof" data-tx="${escAttr(r.txHash)}">🗑</button>
            </div>
        </div>`).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-action="copy-link"]').forEach(btn => {
        btn.addEventListener('click', () => {
            void navigator.clipboard.writeText(btn.dataset.link!).then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy Link'; }, 2000);
            });
        });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-action="delete-proof"]').forEach(btn => {
        btn.addEventListener('click', () => {
            removeProofHistory(btn.dataset.tx!);
            renderHistory();
        });
    });
}

// ── SETTINGS MODAL ────────────────────────────────────────────────────────────

function openSettings(): void {
    q('#settings-modal').classList.remove('hidden');
    q('#settings-overlay').classList.remove('hidden');
    q<HTMLInputElement>('#contract-address-input').value = getContractAddress();
    void renderSettingsInfo();
}

function closeSettings(): void {
    q('#settings-modal').classList.add('hidden');
    q('#settings-overlay').classList.add('hidden');
}

function handleSaveContractAddress(): void {
    const addr = q<HTMLInputElement>('#contract-address-input').value.trim();
    setContractAddress(addr);
    showStatus(addr ? 'Registry address saved.' : 'Registry address cleared.', 'success');
    void renderSettingsInfo();
}

async function handleDeployRegistry(): Promise<void> {
    if (!providers) {
        showStatus('Connect the 1AM wallet first — the deploying wallet becomes the school (issuer).', 'warning');
        return;
    }
    if (!confirm('Deploy a new certificate registry on Midnight preprod? Your wallet becomes its issuer.')) return;
    const btn = q<HTMLButtonElement>('#deploy-registry-button');
    btn.disabled = true;
    btn.textContent = '🚀 Deploying… (~10–30s)';
    try {
        const reg = await CertificateRegistry.deploy(providers);
        registry = reg;
        setContractAddress(reg.address);
        registry = reg; // setContractAddress clears the cache; keep the fresh instance
        q<HTMLInputElement>('#contract-address-input').value = reg.address;
        showStatus(`✅ Registry deployed at ${reg.address.slice(0, 20)}… — you are its issuer.`, 'success', 9000);
        await renderSettingsInfo();
    } catch (err) {
        showStatus(`Deploy failed: ${friendlyError(err)}`, 'error', 12000);
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Deploy New Registry';
    }
}

async function renderSettingsInfo(): Promise<void> {
    const info = q('#settings-info');
    const addr = getContractAddress();
    const wallet = isWalletConnected() ? formatAddress(getShieldedAddress() ?? '') : 'not connected';
    info.innerHTML = `
        <div class="proof-detail"><span class="proof-detail-label">Midnight network</span><span>${escHtml(MIDNIGHT_NETWORK_ID)}</span></div>
        <div class="proof-detail"><span class="proof-detail-label">1AM wallet</span><span class="mono">${escHtml(wallet)}</span></div>
        <div class="proof-detail"><span class="proof-detail-label">Registry</span><span class="mono truncate">${escHtml(addr || '— none configured —')}</span></div>
        <div class="proof-detail"><span class="proof-detail-label">cascade-api</span><span class="mono">${escHtml(CASCADE_API_BASE)}</span></div>
        <div class="proof-detail"><span class="proof-detail-label">Cascade status</span><span id="cascade-health-cell">checking…</span></div>
        <div class="proof-detail"><span class="proof-detail-label">Degree levels</span><span>${DEGREE_LEVELS.join(' · ')}</span></div>`;
    try {
        const h = await cascadeHealth();
        const cell = document.getElementById('cascade-health-cell');
        if (cell) {
            cell.textContent = h.ok
                ? `✅ up · ${h.chainId} · uploader balance ${(h.ulumeBalance / 1e6).toFixed(2)} LUME${h.warning ? ' ⚠️' : ''}`
                : '❌ unhealthy';
        }
    } catch {
        const cell = document.getElementById('cascade-health-cell');
        if (cell) cell.textContent = '❌ unreachable';
    }
}

// ── Status / helpers ──────────────────────────────────────────────────────────

let _statusTimer: ReturnType<typeof setTimeout> | null = null;

export function showStatus(
    msg:  string,
    type: 'success' | 'error' | 'warning' | 'info' = 'info',
    durationMs = 5000,
): void {
    const el = q('#status-message');
    el.textContent = msg;
    el.className = `status-message status-${type}`;
    el.classList.remove('hidden');
    if (_statusTimer) clearTimeout(_statusTimer);
    if (durationMs > 0) {
        _statusTimer = setTimeout(() => el.classList.add('hidden'), durationMs);
    }
}

/** Extract a readable message from midnight-js / circuit errors. */
function friendlyError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    // Circuit assert failures arrive as "...failed assert: <our message>"
    const assertMatch = msg.match(/failed assert:?\s*(.+)/i);
    if (assertMatch) return `Contract rejected the transaction: ${assertMatch[1]}`;
    return msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
}

function copyToClipboard(text: string, btnSelector: string): void {
    void navigator.clipboard.writeText(text).then(() => {
        const btn = q<HTMLButtonElement>(btnSelector);
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = prev; }, 2000);
    });
}

function q<T extends Element = Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    return el;
}

function qa(selector: string): NodeListOf<Element> {
    return document.querySelectorAll(selector);
}

function escHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escAttr(s: string): string {
    return escHtml(s);
}
