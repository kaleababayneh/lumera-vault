# Lumera Vault 🔐

> **Notarize once, prove forever.**

A ZK-verified document vault built on **Lumera's Cascade** permanent decentralized storage and a production-realistic simulation of the **Midnight** zero-knowledge proof protocol.

---

## What it does

Users upload sensitive documents (academic credentials, income statements, medical records, property deeds, identity documents), encrypted end-to-end and stored permanently on Lumera Cascade. They can then generate **Midnight ZK proofs** that prove specific *claims* about their documents — without ever revealing the underlying document.

### Example flows

| Document | Claim proven | What the verifier learns |
|---|---|---|
| University diploma | "Has a Computer Science degree" | ✅ / ❌ — nothing else |
| Income statement | "Annual income exceeds $60,000" | ✅ / ❌ — exact salary stays private |
| Medical record | "Vaccinated for COVID-19" | ✅ / ❌ — full history stays private |
| Property deed | "Property assessed above $200,000" | ✅ / ❌ — address/value stays private |
| Passport | "Is 21 years of age or older" | ✅ / ❌ — date of birth stays private |

---

## Architecture

```
User → Fill document fields
     → Encrypt (XChaCha20-Poly1305) with wallet-derived key
     → Upload to Cascade (permanent, decentralized)
     → Commitment hash stored with the action
               ↓
Midnight Compact contract (simulated) registers document schema
               ↓
User selects claim → fills parameters
               ↓
Midnight proof generated locally (Groth16 simulation):
  • Witness hash = BLAKE2b(fields | claimType | params | salt)
  • π_A, π_B, π_C = BLAKE2b(witnessHash | "ZK_GROTH16_Pi_*")
  • Nullifier    = BLAKE2b(commitment | claimType | params)
  • VK           = BLAKE2b("MIDNIGHT_CIRCUIT_VK:<schema>:<claim>:v1")
  • verificationHash = BLAKE2b(π_A | π_C | verdict | nullifier | VK)
               ↓
Proof bundle encoded as URL-safe base64 → shareable link
               ↓
Verifier pastes link → structural integrity check passes → verdict displayed
```

### Midnight simulation vs real Midnight

| Aspect | This app (simulation) | Real Midnight |
|---|---|---|
| Proof generation | BLAKE2b-derived Groth16-like points | Actual Groth16 over BLS12-377 |
| Zero-knowledge | Computationally binding | Cryptographically zero-knowledge |
| Verification | Hash consistency check | Bilinear pairing check |
| Circuit definition | TypeScript switch/case | Compact language circuits |
| Contract addresses | `mid1vault_*_v1` prefixes | On-chain Midnight addresses |
| Network | Simulated | Midnight testnet / mainnet |
| Privacy guarantee | UX demonstration | Mathematical ZK guarantee |

---

## Tech stack

- **Lumera Cascade** — permanent, decentralized storage via `@lumera-protocol/sdk-js`
- **Keplr** — wallet for signing and authentication on Lumera testnet
- **libsodium** (`libsodium-wrappers-sumo`) — XChaCha20-Poly1305 encryption + BLAKE2b hashing
- **TypeScript + Vite** — typed, fast build toolchain
- **DUST token** — Midnight's privacy-native token (simulated balance, 1 DUST/proof)

---

## Getting started

### Prerequisites

- [Keplr wallet](https://www.keplr.app/) browser extension
- Node.js ≥ 18

### Setup

```bash
cp .env.example .env
# Edit .env — set VITE_LUMESCOPE_API_BASE if available

npm install
npm run dev
```

Open http://localhost:5173, connect Keplr (Lumera Testnet), then:

1. **Upload** a document (fields are entered manually)
2. **Generate Proof** — select document → select claim → fill parameters → copy link
3. Share the proof link with a verifier
4. **Verify** — verifier pastes the link → sees ✅ / ❌ result with no access to the document

---

## Document schemas

| Schema | Available claims |
|---|---|
| 🎓 Academic Credential | has_degree_in, graduated_from_accredited, degree_level_at_least, gpa_above |
| 💰 Income Statement | income_above, is_employed, income_in_range, income_above_x_times_rent |
| 🏥 Medical Record | vaccinated_for, no_known_allergies, allergy_free_of, medically_fit |
| 🏠 Property Deed | is_property_owner, property_value_above, purchased_before |
| 🪪 Identity Document | is_adult, age_above, nationality_is |

---

## Security notes

- Document fields never leave the browser — only the encrypted ciphertext goes to Cascade
- Proof generation runs entirely on-device; the plaintext witness is discarded after proof construction
- Proof links are self-contained (no server required for verification)
- In production, replace the BLAKE2b simulation with actual Midnight Compact circuits for full ZK guarantees

---

## License

MIT
