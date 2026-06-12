# Lumera Vault 🎓

> **Issue once, prove forever.**

A school issues an academic certificate; the encrypted document lives **permanently on
[Lumera Cascade](https://lumera.io)**, its commitment hash + Cascade pointer are anchored
on **[Midnight](https://midnight.network) (preprod)**, and the student later proves
selective claims about it without revealing the certificate.

Compact contract compiled & deployed on Midnight preprod, proofs via either
the [1AM wallet](https://1am.xyz)'s ProofStation or local proof server, and 
permanent storage through [cascade-api](https://github.com/kaleababayneh/cascade-api)
(no Keplr / Lumera wallet needed in the browser).

---

## How it works

```
┌─ SCHOOL (1AM wallet) ──────────────────────────────────────────────┐
│ fill certificate → encrypt (XChaCha20-Poly1305, random key)        │
│   → POST cascade-api /upload          → action_id   (Lumera, perm) │
│   → issueCertificate(commitment, action_id)         (Midnight tx)  │
│   → hand student a link: #cert/<action_id + decryption key>        │
└────────────────────────────────────────────────────────────────────┘
┌─ STUDENT (1AM wallet) ─────────────────────────────────────────────┐
│ paste link → GET cascade-api /download/{action_id} → decrypt local │
│ pick claim (e.g. "GPA > 3.0") → prove* circuit:                    │
│   witness = full certificate (never leaves device)                 │
│   circuit asserts: commitment registered ∧ not revoked ∧ claim     │
│   → ZK proof via ProofStation (~2–5 s, 0 fees)                     │
│   → claim record lands on the Midnight ledger                      │
│ → hand verifier a link: #verify/<claim + params (+ identity)>      │
└────────────────────────────────────────────────────────────────────┘
┌─ VERIFIER (no wallet) ─────────────────────────────────────────────┐
│ paste link → query Midnight indexer:                               │
│   recompute proofKey (pure circuit) → claimProofs.member(key) ✓    │
│   certificate registered ✓ · not revoked ✓ · params match ✓        │
│   identity (optional): recompute salted studentIdHash ✓            │
└────────────────────────────────────────────────────────────────────┘
```

A claim record can **only** exist on the ledger if every `assert` held inside the ZK
circuit, so `claimProofs.member(proofKey)` *is* the verification. The proof key is
reproducible by anyone (`computeProofKey` is an exported pure circuit), which is what
makes wallet-less verification possible.

### The contract (`contract/src/certificate.compact`)

| Circuit | Caller | Purpose |
|---|---|---|
| `issueCertificate(commitment, cascadeId)` | school | Anchor commitment + Cascade pointer |
| `revokeCertificate(commitment)` | school | Mark revoked (pointer preserved) |
| `addIssuer(entityId)` | school | Register another issuer wallet |
| `proveDegreeInField(fieldHash)` | student | ZK: field of study matches |
| `proveAccredited()` | student | ZK: institution accredited |
| `proveDegreeLevelAtLeast(minLevel)` | student | ZK: degree level ≥ minimum |
| `proveGpaAbove(threshold×100)` | student | ZK: GPA strictly above threshold |
| `entityId / computeCommitment / computeProofKey` | anyone | **Pure** circuits — also callable from TS so app & circuit can never disagree on hashing |

Certificate fields enter circuits as normalized BLAKE2b hashes / range-bounded ints;
`salt` blinds the commitment; `studentIdHash` (salted) binds proofs to a person without
putting any PII on-chain.

---

## Getting started

### Prerequisites

- Node.js ≥ 20, plus the [compact toolchain](https://docs.midnight.network):
  `curl -fsSL https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | bash && compact update`
- [1AM wallet](https://1am.xyz/install-beta) browser extension, set to **preprod**
- A cascade-api key (see [api.lumera.help docs](https://github.com/kaleababayneh/cascade-api))

### Project layout (npm workspaces)

```
contract/            # @lumera-vault/contract
  src/certificate.compact   # the Compact contract
  src/witnesses.ts          # witness implementations
  src/managed/              # compact compiler output (generated)
  src/test/                 # vitest circuit simulator tests
  dist/                     # built package (generated)
ui/                  # @lumera-vault/ui — Vite app, depends on the contract pkg
  src/                      # app + midnight/cascade integration
  public/keys|zkir          # ZK assets copied from contract (generated)
```

### Setup

```bash
cp ui/.env.example ui/.env  # fill VITE_CASCADE_API_KEY (and VITE_CONTRACT_ADDRESS once deployed)
npm install
npm run build:contract      # compact compile (ZK keygen, ~1 min) + contract package build
npm run build:start         # frontend build + serve → http://localhost:8081
npm run test                # contract simulator tests (no network needed)
```

Day-to-day: after frontend changes just re-run `npm run build:start` — it does
NOT recompile the contract. Re-run `npm run build:contract` only when a
`.compact` file or the witnesses change. (`npm run build` = both in sequence;
`npm run start` serves the existing `ui/dist` without rebuilding.)

### First run (one-time)

1. Open the app, **Connect 1AM Wallet** (preprod).
2. ⚙️ **Registry Settings → Deploy New Registry** — your wallet becomes the school/issuer.
   Put the printed address into `.env` as `VITE_CONTRACT_ADDRESS` so students/verifiers
   default to it (they can also set it in ⚙️).
3. **Issue** tab: fill the certificate → it uploads to Cascade (30–60 s) and anchors on
   Midnight → copy the `#cert/…` link for the student.
4. As the student (any browser): **My Certificates** → paste link → import. **Prove** →
   pick claim → ZK proof lands on-chain → copy the `#verify/…` link.
5. As the verifier (no wallet): **Verify** → paste link → live checks against the
   Midnight indexer.

---

## Privacy model

- **On Cascade (public, permanent):** only XChaCha20-Poly1305 ciphertext. The key never
  touches the backend — it travels inside the school→student link.
- **On Midnight:** commitment (salt-blinded hash), Cascade action id, and — per proof —
  the claim kind/params + salted `studentIdHash`. Issuing tx ↔ proof tx linkage is
  public (same commitment); certificate *contents* are never derivable.
- **Identity disclosure is student-controlled:** the verify link optionally carries
  (name, id, idSalt); the verifier recomputes the salted hash and matches it against the
  on-chain record. Omit it for anonymous proofs.
- Future work: a MerkleTree-based membership proof would also hide *which* certificate a
  proof refers to.

## Notes & credits

- Proof flow modeled on **[vaxzk](https://github.com/bochaco/vaxzk)** (MIT) — vaccination
  certificates on Midnight; `src/midnight/in-memory-private-state.ts` and the simulator
  test harness are adapted from it.
- 1AM integration per the official AI reference: <https://1am.xyz/ai.txt> (dust-free:
  ProofStation proves, balances and sponsors fees — users pay 0).
- Storage via **cascade-api**'s public instance at `https://api.lumera.help`
  (`VITE_CASCADE_API_BASE` to self-host). API keys are quota-capped bearer tokens; a
  browser-exposed key is the documented pattern for demos — rotate if abused.
- After any `.compact` or witness change run `npm run build:contract`
  (regenerates `contract/src/managed/` + `contract/dist/`); the next
  `npm run build:start` re-copies `ui/public/keys|zkir` automatically
  (compact compiler ≥ 0.31, language ≥ 0.20).
- Wallet detection enumerates every `window.midnight` connector with API v4
  (1AM preferred, Lace works too) — pattern borrowed from the kaamos htlc-ui.

## License

MIT
