/**
 * Browser wiring of the compiled certificate contract.
 *
 * The prover/verifier keys and ZKIR artifacts are copied into public/ by the
 * ui copy-zk-assets script, so they are served from the app origin and
 * fetched on demand (FetchZkConfigProvider + withCompiledFileAssets).
 *
 * Construction is lazy: building the CompiledContract at module scope would
 * make any failure inside compact-js kill the whole bundle before a single
 * event listener is attached.
 */

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
    Contract,
    witnesses,
    type CertificatePrivateState,
    type Witnesses,
} from '@lumera-vault/contract';
import type { CertContract } from './common-types';

const build = () =>
    CompiledContract.make<CertContract>(
        'LumeraVaultCertificates',
        Contract<CertificatePrivateState, Witnesses<CertificatePrivateState>>,
    ).pipe(
        CompiledContract.withWitnesses(witnesses),
        CompiledContract.withCompiledFileAssets(window.location.origin),
    );

let _compiled: ReturnType<typeof build> | null = null;

export function getCompiledCertificateContract(): ReturnType<typeof build> {
    if (!_compiled) _compiled = build();
    return _compiled;
}
