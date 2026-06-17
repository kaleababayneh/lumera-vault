// Browser globals expected by the midnight-js / wallet stack.
import { Buffer } from 'buffer';

// Vite sets PROD/DEV, but some third-party libraries read NODE_ENV directly.
// @ts-expect-error - support third-party libraries that require `NODE_ENV`.
globalThis.process = {
    env: {
        NODE_ENV: import.meta.env.MODE,
    },
};

// midnight-js serialization paths expect a global Buffer.
(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
