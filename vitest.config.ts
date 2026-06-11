import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['contract/src/test/**/*.test.ts'],
        testTimeout: 15_000,
    },
});
