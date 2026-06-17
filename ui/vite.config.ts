// Vite configuration for the midnight-js browser stack, ported from the
// wasm chunking for onchain-runtime, node polyfills with Buffer/process
// globals, and top-level-await support — plus this app's libsodium-sumo and
// isomorphic-ws fixes.
import { defineConfig } from 'vite';
import path from 'path';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
    cacheDir: './.vite',
    build: {
        target: 'esnext',
        minify: false,
        commonjsOptions: {
            transformMixedEsModules: true,
            extensions: ['.js', '.cjs'],
            ignoreDynamicRequires: true,
        },
    },
    plugins: [
        nodePolyfills({
            include: ['buffer', 'process', 'util', 'stream', 'events', 'fs', 'path', 'crypto'],
            globals: { Buffer: true, global: true, process: true },
            protocolImports: true,
        }),
        wasm(),
        // NOTE: no vite-plugin-top-level-await — build target is esnext, so
        // native TLA is emitted; the plugin's wrapper can deadlock the bundle.
        {
            // Force the wasm-backed runtime through the normal module graph
            // when imported from compact-runtime.
            name: 'wasm-module-resolver',
            resolveId(source, importer) {
                if (
                    source === '@midnight-ntwrk/onchain-runtime-v3' &&
                    importer &&
                    importer.includes('@midnight-ntwrk/compact-runtime')
                ) {
                    return { id: source, external: false, moduleSideEffects: true };
                }
                return null;
            },
        },
        {
            // libsodium-wrappers-sumo resolves its core via a bare relative
            // import that Vite cannot find; point it at the ESM build.
            name: 'resolve-libsodium-sumo',
            resolveId(id, importer) {
                if (id === './libsodium-sumo.mjs' && importer?.includes('libsodium-wrappers-sumo')) {
                    return path.resolve(
                        __dirname,
                        '../node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
                    );
                }
                return null;
            },
        },
    ],
    optimizeDeps: {
        esbuildOptions: {
            target: 'esnext',
            supported: { 'top-level-await': true },
            platform: 'browser',
            format: 'esm',
            loader: { '.wasm': 'binary' },
        },
        include: ['@midnight-ntwrk/compact-runtime', 'buffer', 'process'],
        exclude: [
            '@midnight-ntwrk/onchain-runtime-v3',
            '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
            '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js',
            'libsodium-sumo',
            'libsodium-wrappers-sumo',
        ],
    },
    resolve: {
        extensions: ['.mjs', '.js', '.ts', '.json', '.wasm'],
        mainFields: ['browser', 'module', 'main'],
        alias: {
            buffer: 'buffer',
            process: 'process/browser',
            // isomorphic-ws browser build only has a default export; the shim
            // adds the named WebSocket export @midnight-ntwrk packages expect.
            'isomorphic-ws': path.resolve(__dirname, 'src/shims/isomorphic-ws.js'),
            'libsodium-sumo': path.resolve(
                __dirname,
                '../node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
            ),
        },
    },
    server: {
        fs: { allow: ['..'] },
    },
});
