/**
 * Browser wiring of the compiled certificate contract.
 *
 * The prover/verifier keys and ZKIR artifacts are copied into public/ by
 * `npm run contract:compile`, so they are served from the app origin and
 * fetched on demand (FetchZkConfigProvider + withCompiledFileAssets).
 */

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
    Contract,
    witnesses,
    type CertificatePrivateState,
    type Witnesses,
} from '@lumera-vault/contract';
import type { CertContract } from './common-types';

export const CompiledCertificateContract = CompiledContract.make<CertContract>(
    'LumeraVaultCertificates',
    Contract<CertificatePrivateState, Witnesses<CertificatePrivateState>>,
).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(window.location.origin),
);
