/**
 * Certificate registry contract package.
 *
 * Re-exports the compiler-generated module plus the witness implementations.
 * Browser-only wiring (CompiledContract + zk asset locations) lives in
 * src/midnight/contract.ts so this package stays importable under Node
 * (vitest simulator tests).
 */

export * from '../managed/contract/index.js';
export * from './witnesses.js';
