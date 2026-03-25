import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
    plugins: [
        wasm(),
        topLevelAwait(),
        nodePolyfills({
            protocolImports: true,
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
        }),
        {
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
        'process.env': {},
        global: 'globalThis',
    },
    optimizeDeps: {
        esbuildOptions: {
            define: { global: 'globalThis' },
        },
        exclude: [
            'libsodium-sumo',
            'libsodium-wrappers-sumo',
            'undici',
            '@bokuweb/zstd-wasm',
        ],
    },
    build: {
        commonjsOptions: {
            transformMixedEsModules: true,
            ignore: ['util/types'],
        },
        target: 'esnext',
        rollupOptions: {
            external: [/^node:/],
        },
    },
    resolve: {
        mainFields: ['browser', 'module', 'main'],
        conditions: ['browser', 'import', 'default'],
        alias: {
            'libsodium-sumo': path.resolve(
                process.cwd(),
                'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
            ),
            'util': 'util/',
        },
    },
    assetsInclude: ['**/*.wasm'],
    server: {
        fs: { allow: ['..'] },
    },
});
