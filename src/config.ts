/**
 * Lumera Vault — Chain & App Configuration
 */

// ── Lumera Testnet ──────────────────────────────────────────────────────────
export const CHAIN_ID   = 'lumera-testnet-2';
export const CHAIN_NAME = 'Lumera Testnet';
export const RPC_ENDPOINT = 'https://rpc.testnet.lumera.io';
export const LCD_ENDPOINT = 'https://lcd.testnet.lumera.io';

// Token
export const DENOM         = 'ulume';
export const DISPLAY_DENOM = 'LUME';
export const DECIMALS      = 6;
export const GAS_PRICE     = '0.025ulume';

// Lumescope
export const LUMESCOPE_API_BASE = import.meta.env.VITE_LUMESCOPE_API_BASE as string | undefined;
export const LUMESCOPE_LIMIT    = 500;

// ── Midnight simulation ─────────────────────────────────────────────────────
/** Prefix used on simulated Midnight contract addresses */
export const MIDNIGHT_CONTRACT_PREFIX = 'mid1vault';
/** Simulated DUST balance for demo purposes */
export const INITIAL_DUST_BALANCE = 1_000;
/** Cost in DUST per proof generation */
export const DUST_PER_PROOF = 1;
/** Midnight network version tag embedded in proof objects */
export const MIDNIGHT_NETWORK_VERSION = 'midnight-testnet-sim-v1';

// ── Vault local storage keys ────────────────────────────────────────────────
export const VAULT_INDEX_KEY_PREFIX = 'lumera_vault_index_';
export const PROOFS_KEY_PREFIX      = 'lumera_vault_proofs_';
export const DUST_BALANCE_KEY       = 'lumera_vault_dust_balance';
export const SESSION_WALLET_KEY     = 'lumera_vault_wallet_session';

// ── Keplr chain info ────────────────────────────────────────────────────────
export const LUMERA_CHAIN_INFO = {
    chainId: CHAIN_ID,
    chainName: CHAIN_NAME,
    rpc: RPC_ENDPOINT,
    rest: LCD_ENDPOINT,
    bip44: { coinType: 118 },
    bech32Config: {
        bech32PrefixAccAddr:    'lumera',
        bech32PrefixAccPub:     'lumerapub',
        bech32PrefixValAddr:    'lumeravaloper',
        bech32PrefixValPub:     'lumeravaloperpub',
        bech32PrefixConsAddr:   'lumeravalcons',
        bech32PrefixConsPub:    'lumeravalconspub',
    },
    currencies: [{ coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: DECIMALS }],
    feeCurrencies: [{
        coinDenom: DISPLAY_DENOM,
        coinMinimalDenom: DENOM,
        coinDecimals: DECIMALS,
        gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 },
    }],
    stakeCurrency: { coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: DECIMALS },
    features: ['stargate', 'ibc-transfer'],
};
