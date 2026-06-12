/**
 * Lumera Vault — App Configuration
 *
 * Storage: Lumera Cascade via the cascade-api HTTP service (no Lumera wallet
 * needed — the backend signs and pays in ulume).
 * Proofs:  Midnight preprod via the 1AM wallet 
 */

const env = import.meta.env as Record<string, string | undefined>;

// ── Lumera Cascade (via cascade-api) ─────────────────────────────────────────
export const CASCADE_API_BASE = env.VITE_CASCADE_API_BASE ?? 'https://api.lumera.help';
export const CASCADE_API_KEY  = env.VITE_CASCADE_API_KEY ?? '';
/** Upload latency is 30–60s (Cascade tx + SuperNode replication). */
export const CASCADE_UPLOAD_TIMEOUT_MS  = 180_000;
export const CASCADE_DOWNLOAD_TIMEOUT_MS = 120_000;

// ── Midnight ─────────────────────────────────────────────────────────────────
export const MIDNIGHT_NETWORK_ID = env.VITE_MIDNIGHT_NETWORK_ID ?? 'preprod';
/** Used by the wallet-less verifier tab; the wallet's getConfiguration() wins otherwise.
 *  NOTE: the preprod indexer moved to /api/v4 — the old /api/v1 path 308s into a 404. */
export const INDEXER_URI    = env.VITE_INDEXER_URI    ?? 'https://indexer.preprod.midnight.network/api/v4/graphql';
export const INDEXER_WS_URI = env.VITE_INDEXER_WS_URI ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
/** Default registry contract address (can be overridden in the Registry tab). */
export const DEFAULT_CONTRACT_ADDRESS = env.VITE_CONTRACT_ADDRESS ?? '';

// ── Degree levels (order defines the on-chain Uint<8> encoding) ─────────────
export const DEGREE_LEVELS = ['Certificate', 'Associate', 'Bachelor', 'Master', 'PhD'] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

// ── localStorage / sessionStorage keys ──────────────────────────────────────
export const CONTRACT_ADDRESS_KEY = 'lumera_vault_contract_address_v2';
export const ISSUED_INDEX_KEY     = 'lumera_vault_issued_certs_v2';
export const STUDENT_VAULT_KEY    = 'lumera_vault_student_certs_v2';
export const PROOF_HISTORY_KEY    = 'lumera_vault_proof_history_v2';
export const SESSION_WALLET_KEY   = 'lumera_vault_wallet_session_v2';
