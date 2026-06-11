import { defineConfig } from 'vite';
import path from 'path';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import nodePolyfills from '@rolldown/plugin-node-polyfills';

export default defineConfig({
    plugins: [
        wasm(),
        topLevelAwait({
            promiseExportName: '__tla',
            promiseImportName: (i) => `__tla_${i}`,
        }),
        nodePolyfills(),
        {
            // libsodium-wrappers-sumo resolves its core via a bare relative
            // import that Vite cannot find; point it at the ESM build.
            name: 'resolve-libsodium-sumo',
            resolveId(id, importer) {
                if (id === './libsodium-sumo.mjs' && importer?.includes('libsodium-wrappers-sumo')) {
                    return path.resolve(
                        process.cwd(),
                        'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
                    );
                }
                return null;
            },
        },
    ],
    define: {
        global: 'globalThis',
        'process.env': '{}',
    },
    resolve: {
        alias: {
            buffer: 'buffer',
            process: 'process/browser',
            // isomorphic-ws browser build only has a default export; the shim
            // adds the named WebSocket export @midnight-ntwrk packages expect.
            'isomorphic-ws': path.resolve(__dirname, 'src/shims/isomorphic-ws.js'),
            'libsodium-sumo': path.resolve(
                process.cwd(),
                'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
            ),
        },
    },
    optimizeDeps: {
        include: ['buffer', 'process'],
        exclude: ['libsodium-sumo', 'libsodium-wrappers-sumo'],
    },
    build: {
        target: 'esnext',
    },
})
