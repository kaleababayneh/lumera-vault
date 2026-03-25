/**
 * UI Module — Lumera Vault
 *
 * Manages all DOM interactions across four tabs:
 *   Vault | Generate Proof | Verify | History
 */

import {
    connectWallet,
    disconnectWallet,
    getConnectedAddress,
    isWalletConnected,
    isKeplrInstalled,
    formatAddress,
    initializeWalletState,
} from './wallet';
import {
    initializeCascadeClient,
} from './cascade';
import { initCrypto } from './crypto';
import {
    initVault,
    uploadDocument,
    listDocuments,
    getDocument,
    deleteDocument,
    warmupVaultKey,
    type VaultDocument,
} from './vault';
import {
    generateProof,
    verifyProof,
    listProofs,
    deleteProof,
    getDustBalance,
    type ProofRecord,
} from './proof';
import {
    type SchemaType,
    SCHEMAS,
    SCHEMA_TYPES,
    getSchema,
} from './schemas';
import {
    deserializeProof,
    parseProofFromUrl,
    type MidnightProof,
    type VerificationResult,
} from './midnight';
import { DUST_PER_PROOF } from './config';

// ── State ─────────────────────────────────────────────────────────────────────

// Upload wizard state
let uploadSchemaType: SchemaType | null = null;

// Prove wizard state
let proveDocumentId:  string | null = null;
let proveClaimType:   string | null = null;
let proveSchemaType:  SchemaType | null = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

export async function initUI(): Promise<void> {
    await initCrypto();

    // Wire wallet button
    const walletBtn = q<HTMLButtonElement>('#wallet-button');
    walletBtn.addEventListener('click', handleWalletClick);

    // Tab navigation
    qa('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => switchTab((btn as HTMLElement).dataset.tab!));
    });

    // Vault tab
    q('#open-upload-modal').addEventListener('click', openUploadModal);
    q('#close-upload-modal').addEventListener('click', closeUploadModal);
    q('#upload-overlay').addEventListener('click', closeUploadModal);

    // Prove tab
    qa('.prove-step-back').forEach(btn => {
        (btn as HTMLElement).addEventListener('click', () => {
            const to = Number((btn as HTMLElement).dataset.to);
            showProveStep(to);
        });
    });
    q('#generate-proof-button').addEventListener('click', handleGenerateProof);

    // Verify tab
    q('#verify-button').addEventListener('click', handleVerifyProof);
    q('#verify-input').addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') handleVerifyProof();
    });

    // Check Keplr
    if (!isKeplrInstalled()) {
        walletBtn.textContent = '↗ Install Keplr';
        walletBtn.addEventListener('click', () => window.open('https://www.keplr.app/', '_blank'), { once: true });
        showStatus('Keplr wallet extension not detected. Some features require it.', 'warning');
    }

    // Restore session
    initializeWalletState();
    if (isWalletConnected()) {
        try {
            await initializeCascadeClient();
            await initVault();
            updateWalletUI();
            renderAll();
            showStatus('Welcome back! Session restored.', 'success');
        } catch (err) {
            console.warn('Session restore failed:', err);
            disconnectWallet();
            updateWalletUI();
        }
    }

    // Handle verify link in URL
    const pendingProof = parseProofFromUrl();
    if (pendingProof) {
        // Clear hash after capture
        window.history.replaceState({}, document.title, window.location.pathname);
        switchTab('verify');
        displayVerifyResult(verifyProof(pendingProof), pendingProof);
    }
}

// ── Wallet ────────────────────────────────────────────────────────────────────

async function handleWalletClick(): Promise<void> {
    if (isWalletConnected()) {
        disconnectWallet();
        updateWalletUI();
        disableAppNav();
        showStatus('Wallet disconnected.', 'info');
        return;
    }

    const btn = q<HTMLButtonElement>('#wallet-button');
    btn.disabled  = true;
    btn.textContent = 'Connecting…';

    try {
        await connectWallet();
        await initializeCascadeClient();
        await initVault();
        updateWalletUI();
        renderAll();
        showStatus('Wallet connected! Vault ready.', 'success');
    } catch (err) {
        btn.disabled    = false;
        btn.textContent = 'Connect Keplr';
        showStatus(`Connection failed: ${String(err)}`, 'error');
    }
}

function updateWalletUI(): void {
    const btn    = q<HTMLButtonElement>('#wallet-button');
    const status = q('#wallet-status');
    const nav    = q('#tab-nav');

    if (isWalletConnected()) {
        const addr = getConnectedAddress()!;
        btn.textContent   = 'Disconnect';
        btn.className     = 'btn-disconnect';
        btn.disabled      = false;
        status.textContent = formatAddress(addr);
        status.className  = 'wallet-address';
        nav.classList.remove('disabled');
        updateDustDisplay();
    } else {
        btn.textContent  = 'Connect Keplr';
        btn.className    = 'btn-primary';
        btn.disabled     = false;
        status.textContent = '';
        status.className = '';
        nav.classList.add('disabled');
        q('#dust-balance').classList.add('hidden');
    }
}

function updateDustDisplay(): void {
    const addr = getConnectedAddress();
    if (!addr) return;
    const balance = getDustBalance(addr);
    q('#dust-amount').textContent = balance.toLocaleString();
    q('#dust-balance').classList.remove('hidden');
}

function disableAppNav(): void {
    q('#tab-nav').classList.add('disabled');
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab: string): void {

    qa('.tab-button').forEach(btn => {
        (btn as HTMLButtonElement).classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });
    qa('.tab-content').forEach(el => {
        (el as HTMLElement).classList.toggle('active', (el as HTMLElement).id === `tab-${tab}`);
    });

    if (tab === 'prove') {
        renderProveDocumentList();
        // Pre-warm the vault key so the Keplr signing prompt appears here
        // (a natural moment) rather than mid-proof-generation.
        if (isWalletConnected()) {
            warmupVaultKey().catch(err => {
                showStatus(`⚠️ Could not unlock vault key: ${String(err)}`, 'warning', 8000);
            });
        }
    }
    if (tab === 'history') renderHistory();
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderAll(): void {
    renderVaultTab();
    updateDustDisplay();
}

// ── VAULT TAB ─────────────────────────────────────────────────────────────────

function renderVaultTab(): void {
    const container = q('#vault-documents-container');
    const docs      = listDocuments();

    q<HTMLButtonElement>('#open-upload-modal').disabled = !isWalletConnected();

    if (docs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔒</div>
                <p>Your vault is empty.</p>
                <p class="empty-sub">Upload a document to get started — it will be encrypted and stored permanently on Lumera's Cascade network.</p>
            </div>`;
        return;
    }

    container.innerHTML = docs.map(doc => buildDocumentCard(doc)).join('');

    // Wire buttons
    container.querySelectorAll<HTMLButtonElement>('[data-action="prove"]').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab('prove');
            proveDocumentId = btn.dataset.docid!;
            proveSchemaType = btn.dataset.schema as SchemaType;
            showProveStep(2);
            renderProveClaimList();
        });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Remove this document from your vault index? (The encrypted data on Cascade is permanent.)')) return;
            deleteDocument(btn.dataset.docid!);
            renderVaultTab();
            showStatus('Document removed from vault index.', 'info');
        });
    });
}

function buildDocumentCard(doc: VaultDocument): string {
    const schema     = getSchema(doc.schemaType);
    const dateStr    = new Date(doc.uploadedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const sizeKb     = (doc.sizeBytes / 1024).toFixed(1);
    const isLocal    = doc.cascadeActionId.startsWith('local_');
    const storageBadge = isLocal
        ? '<span class="badge badge-warning">Local</span>'
        : '<span class="badge badge-success">Cascade</span>';

    return `
        <div class="document-card" data-docid="${doc.documentId}">
            <div class="doc-card-header">
                <div class="doc-icon" style="background: ${schema.accentColor}22; color: ${schema.accentColor}">
                    ${schema.icon}
                </div>
                <div class="doc-meta">
                    <h3 class="doc-title">${escHtml(doc.title)}</h3>
                    <div class="doc-badges">
                        <span class="badge" style="background: ${schema.accentColor}22; color: ${schema.accentColor}">${schema.label}</span>
                        ${storageBadge}
                    </div>
                </div>
            </div>
            <div class="doc-card-body">
                <div class="doc-detail">
                    <span class="doc-detail-label">Uploaded</span>
                    <span>${escHtml(dateStr)}</span>
                </div>
                <div class="doc-detail">
                    <span class="doc-detail-label">Size</span>
                    <span>${sizeKb} KB</span>
                </div>
                <div class="doc-detail doc-detail-mono">
                    <span class="doc-detail-label">Commitment</span>
                    <span title="${doc.documentCommitment}" class="mono truncate">${doc.documentCommitment.slice(0, 20)}…</span>
                </div>
                ${!isLocal ? `<div class="doc-detail doc-detail-mono">
                    <span class="doc-detail-label">Cascade ID</span>
                    <span class="mono truncate">${escHtml(doc.cascadeActionId)}</span>
                </div>` : ''}
            </div>
            <div class="doc-card-actions">
                <button class="btn-primary btn-sm" data-action="prove" data-docid="${doc.documentId}" data-schema="${doc.schemaType}">
                    🔐 Generate Proof
                </button>
                <button class="btn-ghost btn-sm" data-action="delete" data-docid="${doc.documentId}">
                    🗑 Remove
                </button>
            </div>
        </div>`;
}

// ── UPLOAD MODAL ──────────────────────────────────────────────────────────────

function openUploadModal(): void {
    if (!isWalletConnected()) { showStatus('Connect your wallet first.', 'warning'); return; }
    uploadSchemaType = null;
    showUploadStep(1);
    q('#upload-modal').classList.remove('hidden');
    q('#upload-overlay').classList.remove('hidden');
    renderSchemaGrid();
}

function closeUploadModal(): void {
    q('#upload-modal').classList.add('hidden');
    q('#upload-overlay').classList.add('hidden');
    showUploadStep(1);
    uploadSchemaType = null;
}

function showUploadStep(step: number): void {
    [1, 2, 3].forEach(n => {
        const el = document.getElementById(`upload-step-${n}`);
        if (el) el.classList.toggle('hidden', n !== step);
    });
}

function renderSchemaGrid(): void {
    const grid = q('#schema-grid');
    grid.innerHTML = SCHEMA_TYPES.map(type => {
        const s = SCHEMAS[type];
        return `
            <button class="schema-card" data-schema="${type}" style="--accent: ${s.accentColor}">
                <span class="schema-card-icon">${s.icon}</span>
                <span class="schema-card-label">${s.label}</span>
                <span class="schema-card-desc">${s.description}</span>
            </button>`;
    }).join('');

    grid.querySelectorAll<HTMLButtonElement>('[data-schema]').forEach(btn => {
        btn.addEventListener('click', () => {
            uploadSchemaType = btn.dataset.schema as SchemaType;
            q('#upload-step2-schema-label').textContent = `${SCHEMAS[uploadSchemaType].icon} ${SCHEMAS[uploadSchemaType].label}`;
            renderDocumentFieldsForm(uploadSchemaType);
            showUploadStep(2);
        });
    });
}

function renderDocumentFieldsForm(schemaType: SchemaType): void {
    const schema = getSchema(schemaType);
    const form   = q('#document-fields-form');

    const fieldsHtml = Object.entries(schema.fields).map(([key, def]) => {
        const required = def.optional ? '' : ' <span class="required">*</span>';
        let input      = '';

        if (def.type === 'enum' && def.values) {
            input = `<select id="field_${key}" name="${key}" ${def.optional ? '' : 'required'}>
                ${def.values.map(v => `<option value="${v}">${v}</option>`).join('')}
            </select>`;
        } else if (def.type === 'boolean') {
            input = `<label class="checkbox-label">
                <input type="checkbox" id="field_${key}" name="${key}" />
                <span>Yes</span>
            </label>`;
        } else if (def.type === 'number') {
            const minAttr = def.min !== undefined ? `min="${def.min}"` : '';
            const maxAttr = def.max !== undefined ? `max="${def.max}"` : '';
            input = `<input type="number" id="field_${key}" name="${key}" placeholder="${def.placeholder ?? ''}" ${minAttr} ${maxAttr} step="any" ${def.optional ? '' : 'required'} />`;
        } else if (def.type === 'date') {
            input = `<input type="date" id="field_${key}" name="${key}" ${def.optional ? '' : 'required'} />`;
        } else if (def.type === 'string_array') {
            input = `<input type="text" id="field_${key}" name="${key}" placeholder="${def.placeholder ?? 'comma-separated values'}" ${def.optional ? '' : 'required'} />`;
        } else {
            input = `<input type="text" id="field_${key}" name="${key}" placeholder="${def.placeholder ?? ''}" ${def.optional ? '' : 'required'} />`;
        }

        return `
            <div class="form-group">
                <label for="field_${key}">${def.label}${required}</label>
                ${input}
                ${def.type === 'string_array' ? '<span class="field-hint">Separate multiple values with commas</span>' : ''}
            </div>`;
    }).join('');

    form.innerHTML = `
        <div class="form-group">
            <label for="doc-title">Document Title <span class="required">*</span></label>
            <input type="text" id="doc-title" placeholder="My Computer Science Diploma" required />
        </div>
        ${fieldsHtml}
        <div class="upload-cost-notice">
            <span class="cost-icon">🌙</span> Generating proofs costs <strong>${DUST_PER_PROOF} DUST</strong> per proof
        </div>
        <div class="upload-actions">
            <button type="button" id="back-to-step1" class="btn-ghost">← Back</button>
            <button type="button" id="encrypt-upload-button" class="btn-primary">
                🔒 Encrypt & Store
            </button>
        </div>`;

    q('#back-to-step1').addEventListener('click', () => showUploadStep(1));
    q('#encrypt-upload-button').addEventListener('click', handleEncryptUpload);
}

async function handleEncryptUpload(): Promise<void> {
    if (!uploadSchemaType) return;

    const title = (q<HTMLInputElement>('#doc-title')).value.trim();
    if (!title) { showStatus('Please enter a document title.', 'error'); return; }

    const schema = getSchema(uploadSchemaType);
    const fields: Record<string, unknown> = {};

    let valid = true;
    for (const [key, def] of Object.entries(schema.fields)) {
        const el = document.getElementById(`field_${key}`) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) continue;

        if (def.type === 'boolean') {
            fields[key] = (el as HTMLInputElement).checked;
        } else if (def.type === 'number') {
            const val = (el as HTMLInputElement).value.trim();
            if (!def.optional && val === '') { valid = false; el.classList.add('error'); continue; }
            fields[key] = val !== '' ? parseFloat(val) : undefined;
        } else if (def.type === 'string_array') {
            const val = el.value.trim();
            fields[key] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
        } else {
            const val = el.value.trim();
            if (!def.optional && val === '') { valid = false; el.classList.add('error'); continue; }
            fields[key] = val;
        }
    }

    if (!valid) { showStatus('Please fill in all required fields.', 'error'); return; }

    showUploadStep(3);

    try {
        await uploadDocument({
            title,
            schemaType: uploadSchemaType,
            fields,
            onProgress: (pct, label) => {
                const fillEl = document.getElementById('upload-progress-fill') as HTMLElement | null;
                if (fillEl) fillEl.style.width = `${pct}%`;
                const textEl = document.getElementById('upload-progress-text') as HTMLElement | null;
                if (textEl) textEl.textContent = label;
            },
        });

        closeUploadModal();
        renderVaultTab();
        showStatus(`✅ "${escHtml(title)}" encrypted and stored on Cascade!`, 'success');
    } catch (err) {
        showUploadStep(2);
        showStatus(`Upload failed: ${String(err)}`, 'error');
    }
}

// ── PROVE TAB ─────────────────────────────────────────────────────────────────

function renderProveDocumentList(): void {
    showProveStep(1);
    proveDocumentId = null;
    proveClaimType  = null;
    proveSchemaType = null;

    const container = q('#prove-documents-container');
    const docs      = listDocuments();

    if (docs.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No documents in vault. Upload a document first.</p></div>`;
        return;
    }

    container.innerHTML = docs.map(doc => {
        const schema = getSchema(doc.schemaType);
        return `
            <button class="selectable-card" data-docid="${doc.documentId}" data-schema="${doc.schemaType}">
                <span class="sel-card-icon" style="color: ${schema.accentColor}">${schema.icon}</span>
                <span class="sel-card-info">
                    <span class="sel-card-title">${escHtml(doc.title)}</span>
                    <span class="sel-card-sub">${schema.label}</span>
                </span>
                <span class="sel-card-arrow">→</span>
            </button>`;
    }).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-docid]').forEach(btn => {
        btn.addEventListener('click', () => {
            proveDocumentId = btn.dataset.docid!;
            proveSchemaType = btn.dataset.schema as SchemaType;
            q('#prove-selected-doc').textContent = docs.find(d => d.documentId === proveDocumentId)?.title ?? '';
            renderProveClaimList();
            showProveStep(2);
        });
    });
}

function renderProveClaimList(): void {
    if (!proveSchemaType) return;
    const schema    = getSchema(proveSchemaType);
    const container = q('#prove-claims-container');

    container.innerHTML = Object.entries(schema.claims).map(([claimKey, claimDef]) => `
        <button class="selectable-card" data-claim="${claimKey}">
            <span class="sel-card-icon" style="color: ${schema.accentColor}">🔐</span>
            <span class="sel-card-info">
                <span class="sel-card-title">${claimDef.label}</span>
                <span class="sel-card-sub">${claimDef.description}</span>
            </span>
            <span class="sel-card-arrow">→</span>
        </button>`).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-claim]').forEach(btn => {
        btn.addEventListener('click', () => {
            proveClaimType = btn.dataset.claim!;
            q('#prove-selected-claim').textContent = schema.claims[proveClaimType]?.label ?? '';
            renderProveParamsForm();
            showProveStep(3);
        });
    });
}

function renderProveParamsForm(): void {
    if (!proveSchemaType || !proveClaimType) return;
    const claimDef   = getSchema(proveSchemaType).claims[proveClaimType];
    const container  = q('#prove-params-form');

    // Populate the step-3 breadcrumb with the document title
    const docTitleEl = document.getElementById('prove-selected-doc-3');
    if (docTitleEl && proveDocumentId) {
        docTitleEl.textContent = getDocument(proveDocumentId)?.title ?? '';
    }

    if (claimDef.params.length === 0) {
        container.innerHTML = `<p class="no-params-notice">No parameters needed — this claim is self-contained.</p>`;
        return;
    }

    container.innerHTML = claimDef.params.map(param => {
        let input = '';
        if (param.type === 'enum' && param.values) {
            input = `<select id="param_${param.name}" name="${param.name}">
                ${param.values.map(v => `<option value="${v}">${v}</option>`).join('')}
            </select>`;
        } else if (param.type === 'number') {
            input = `<input type="number" id="param_${param.name}" placeholder="${param.placeholder ?? ''}" step="any" />`;
        } else {
            input = `<input type="text" id="param_${param.name}" placeholder="${param.placeholder ?? ''}" />`;
        }
        return `<div class="form-group"><label for="param_${param.name}">${param.label}</label>${input}</div>`;
    }).join('');
}

function showProveStep(step: number): void {
    [1, 2, 3, 4].forEach(n => {
        const el = document.getElementById(`prove-step-${n}`);
        if (el) el.classList.toggle('hidden', n !== step);
    });
}

async function handleGenerateProof(): Promise<void> {
    if (!proveDocumentId || !proveClaimType || !proveSchemaType) return;

    const claimDef    = getSchema(proveSchemaType).claims[proveClaimType];
    const claimParams: Record<string, unknown> = {};

    for (const param of claimDef.params) {
        const el = document.getElementById(`param_${param.name}`) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) continue;
        if (param.type === 'number') {
            const val = (el as HTMLInputElement).value.trim();
            if (!val) { showStatus(`Parameter "${param.label}" is required.`, 'error'); return; }
            claimParams[param.name] = parseFloat(val);
        } else {
            const val = el.value.trim();
            if (!val) { showStatus(`Parameter "${param.label}" is required.`, 'error'); return; }
            claimParams[param.name] = val;
        }
    }

    const btn = q<HTMLButtonElement>('#generate-proof-button');
    btn.disabled    = true;
    btn.textContent = '⚡ Generating…';

    showProveStep(4);
    renderProofInProgress();

    try {
        const result = await generateProof({
            documentId:  proveDocumentId,
            claimType:   proveClaimType,
            claimParams,
            onProgress: (pct, label) => updateProofProgress(pct, label),
        });

        btn.disabled    = false;
        btn.textContent = '⚡ Generate ZK Proof';

        renderProofResult(result.proof, result.proofLink);
        updateDustDisplay();
    } catch (err) {
        btn.disabled    = false;
        btn.textContent = '⚡ Generate ZK Proof';
        showProveStep(3);
        showStatus(`Proof generation failed: ${String(err)}`, 'error');
    }
}

function renderProofInProgress(): void {
    q('#prove-result-container').innerHTML = `
        <div class="proof-generating">
            <div class="zk-spinner"></div>
            <p id="proof-gen-label" class="proof-gen-label">Initializing circuit…</p>
            <div class="proof-progress-bar"><div id="proof-progress-fill" style="width:0%"></div></div>
            <div class="midnight-steps">
                <div class="mid-step" id="mid-step-1">⏳ Decrypting document locally</div>
                <div class="mid-step" id="mid-step-2">⏳ Running Compact circuit</div>
                <div class="mid-step" id="mid-step-3">⏳ Generating Groth16 proof points</div>
                <div class="mid-step" id="mid-step-4">⏳ Computing nullifier & VK</div>
                <div class="mid-step" id="mid-step-5">⏳ Submitting to Midnight</div>
            </div>
        </div>`;
}

function updateProofProgress(pct: number, label: string): void {
    const fillEl = document.getElementById('proof-progress-fill');
    if (fillEl) fillEl.style.width = `${pct}%`;
    const labelEl = document.getElementById('proof-gen-label');
    if (labelEl) labelEl.textContent = label;

    // Animate steps
    const steps = [5, 25, 56, 75, 90];
    steps.forEach((threshold, i) => {
        const stepEl = document.getElementById(`mid-step-${i + 1}`);
        if (!stepEl) return;
        if (pct >= threshold) {
            stepEl.textContent = stepEl.textContent!.replace('⏳', '✅');
            stepEl.classList.add('done');
        }
    });
}

function renderProofResult(proof: MidnightProof, proofLink: string): void {
    const verdict = proof.satisfiesClaim;
    const schema  = getSchema(proof.schemaType);

    q('#prove-result-container').innerHTML = `
        <div class="proof-result-card ${verdict ? 'proof-pass' : 'proof-fail'}">
            <div class="proof-verdict-badge ${verdict ? 'verdict-pass' : 'verdict-fail'}">
                ${verdict ? '✅ CLAIM SATISFIED' : '❌ CLAIM NOT MET'}
            </div>
            <h3 class="proof-description">${escHtml(proof.claimDescription)}</h3>

            <div class="proof-details-grid">
                <div class="proof-detail">
                    <span class="proof-detail-label">Schema</span>
                    <span>${schema.icon} ${schema.label}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Claim</span>
                    <span>${escHtml(proof.claimType)}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Proof ID</span>
                    <span class="mono">${proof.proofId}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Midnight Tx</span>
                    <span class="mono truncate">${proof.midnightTxHash.slice(0, 20)}…</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Contract</span>
                    <span class="mono">${proof.contractId}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Document Commitment</span>
                    <span class="mono truncate">${proof.documentCommitment.slice(0, 24)}…</span>
                </div>
            </div>

            <div class="groth16-section">
                <div class="groth16-label">Groth16 Proof Transcript</div>
                <div class="groth16-points">
                    <div><span class="point-label">π_A</span><span class="mono proof-point">${proof.proof.a}</span></div>
                    <div><span class="point-label">π_B·x</span><span class="mono proof-point">${proof.proof.b[0]}</span></div>
                    <div><span class="point-label">π_B·y</span><span class="mono proof-point">${proof.proof.b[1]}</span></div>
                    <div><span class="point-label">π_C</span><span class="mono proof-point">${proof.proof.c}</span></div>
                </div>
            </div>

            <div class="proof-share-section">
                <p class="share-label">Share this proof link with the verifier:</p>
                <div class="share-row">
                    <input id="proof-link-value" type="text" readonly value="${escAttr(proofLink)}" />
                    <button id="copy-proof-link" class="btn-primary btn-sm">Copy</button>
                </div>
            </div>
        </div>`;

    q('#copy-proof-link').addEventListener('click', () => {
        navigator.clipboard.writeText(proofLink).then(() => {
            const btn = q<HTMLButtonElement>('#copy-proof-link');
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
        });
    });
}

// ── VERIFY TAB ────────────────────────────────────────────────────────────────

function handleVerifyProof(): void {
    const input = (q<HTMLTextAreaElement>('#verify-input')).value.trim();
    if (!input) { showStatus('Paste a proof link or encoded proof.', 'warning'); return; }

    let proof: MidnightProof;

    try {
        // Try URL fragment format: ...#verify/<encoded>
        if (input.includes('#verify/')) {
            const encoded = input.split('#verify/')[1]?.split(/[&?]/)[0] ?? '';
            proof = deserializeProof(encoded);
        } else if (input.startsWith('{')) {
            // Raw JSON
            proof = JSON.parse(input) as MidnightProof;
        } else {
            // Base64-encoded
            proof = deserializeProof(input);
        }
    } catch {
        showStatus('Could not parse the proof. Make sure you pasted the full link.', 'error');
        return;
    }

    const result = verifyProof(proof);
    displayVerifyResult(result, proof);
}

function displayVerifyResult(result: VerificationResult, proof: MidnightProof): void {
    const container = q('#verify-result');
    container.classList.remove('hidden');

    const schema = SCHEMAS[result.schemaType];
    const date   = new Date(result.timestamp).toLocaleString();

    const paramsHtml = Object.entries(result.claimParams).map(([k, v]) =>
        `<div class="proof-detail"><span class="proof-detail-label">${escHtml(k)}</span><span>${escHtml(String(v))}</span></div>`
    ).join('');

    container.innerHTML = `
        <div class="verify-result-card ${result.valid && result.satisfiesClaim ? 'proof-pass' : result.valid ? 'proof-fail' : 'proof-invalid'}">
            <div class="verify-header">
                <div class="verify-icon">
                    ${result.valid ? (result.satisfiesClaim ? '✅' : '❌') : '⛔'}
                </div>
                <div>
                    <div class="verify-verdict ${result.valid ? (result.satisfiesClaim ? 'verdict-pass' : 'verdict-fail') : 'verdict-invalid'}">
                        ${result.valid ? (result.satisfiesClaim ? 'CLAIM VERIFIED' : 'CLAIM NOT MET') : 'PROOF INVALID'}
                    </div>
                    <div class="verify-summary">${escHtml(result.summary)}</div>
                </div>
            </div>

            ${result.valid ? `
            <div class="verify-details">
                <div class="proof-detail">
                    <span class="proof-detail-label">Document Type</span>
                    <span>${schema?.icon ?? ''} ${escHtml(schema?.label ?? result.schemaType)}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Claim</span>
                    <span>${escHtml(result.claimDescription)}</span>
                </div>
                ${paramsHtml}
                <div class="proof-detail">
                    <span class="proof-detail-label">Prover</span>
                    <span class="mono">${escHtml(formatAddress(result.ownerAddress))}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Generated</span>
                    <span>${escHtml(date)}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Proof ID</span>
                    <span class="mono">${escHtml(result.proofId)}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Contract</span>
                    <span class="mono">${escHtml(result.contractId)}</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Nullifier</span>
                    <span class="mono truncate">${proof.nullifier.slice(0, 24)}…</span>
                </div>
                <div class="proof-detail">
                    <span class="proof-detail-label">Network</span>
                    <span class="mono">${escHtml(proof.networkVersion)}</span>
                </div>
                ${proof.expiresAt ? `<div class="proof-detail">
                    <span class="proof-detail-label">Expires</span>
                    <span>${new Date(proof.expiresAt).toLocaleString()}</span>
                </div>` : ''}
            </div>` : `<div class="verify-error">${escHtml(result.error ?? 'Unknown error')}</div>`}

            <div class="verify-disclaimer">
                🌙 Verified on Midnight Protocol (Simulation — ${escHtml(proof.networkVersion)})
            </div>
        </div>`;
}

// ── HISTORY TAB ───────────────────────────────────────────────────────────────

function renderHistory(): void {
    const container = q('#proof-history-container');
    const records   = listProofs();

    if (records.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No proofs generated yet.</p></div>`;
        return;
    }

    container.innerHTML = records.map(r => buildHistoryRow(r)).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-action="copy-link"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const link = btn.dataset.link!;
            navigator.clipboard.writeText(link).then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy Link'; }, 2000);
            });
        });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="delete-proof"]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteProof(btn.dataset.proofid!);
            renderHistory();
        });
    });
}

function buildHistoryRow(r: ProofRecord): string {
    const schema  = getSchema(r.proof.schemaType);
    const date    = new Date(r.generatedAt).toLocaleString();
    const verdict = r.proof.satisfiesClaim;

    return `
        <div class="history-row">
            <div class="history-left">
                <span class="history-schema-icon" style="color: ${schema.accentColor}">${schema.icon}</span>
                <div class="history-meta">
                    <div class="history-title">${escHtml(r.proof.claimDescription)}</div>
                    <div class="history-sub">${escHtml(r.documentTitle)} · ${escHtml(date)}</div>
                    <div class="history-proofid mono">${r.proof.proofId}</div>
                </div>
            </div>
            <div class="history-right">
                <span class="badge ${verdict ? 'badge-success' : 'badge-error'}">${verdict ? '✅ Pass' : '❌ Fail'}</span>
                <button class="btn-ghost btn-xs" data-action="copy-link" data-link="${escAttr(r.proofLink)}">Copy Link</button>
                <button class="btn-ghost btn-xs" data-action="delete-proof" data-proofid="${r.proof.proofId}">🗑</button>
            </div>
        </div>`;
}

// ── Status messages ───────────────────────────────────────────────────────────

let _statusTimer: ReturnType<typeof setTimeout> | null = null;

export function showStatus(
    msg:  string,
    type: 'success' | 'error' | 'warning' | 'info' = 'info',
    durationMs = 5000
): void {
    const el = q('#status-message');
    el.textContent = msg;
    el.className   = `status-message status-${type}`;
    el.classList.remove('hidden');

    if (_statusTimer) clearTimeout(_statusTimer);
    if (durationMs > 0) {
        _statusTimer = setTimeout(() => el.classList.add('hidden'), durationMs);
    }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

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
