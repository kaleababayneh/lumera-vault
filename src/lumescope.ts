/**
 * Lumescope API Client — index Cascade actions for the vault
 */

import { LUMESCOPE_API_BASE, LUMESCOPE_LIMIT } from './config';

export interface LumescopeAction {
    id:           string;
    type:         string;
    creator:      string;
    state:        string;
    decoded?: {
        data_hash: string;
        file_name: string;
        public:    boolean;
        [key: string]: unknown;
    };
    mime_type?:   string;
    size?:        number;
    block_height?: number;
}

interface LumescopeResponse {
    items: LumescopeAction[];
    cursor?: string;
    total?:  number;
}

export async function getActionsByCreator(
    creatorAddress: string,
    type = 'ACTION_TYPE_CASCADE',
    limit = LUMESCOPE_LIMIT
): Promise<LumescopeAction[]> {
    if (!LUMESCOPE_API_BASE) return [];

    const params = new URLSearchParams({
        creator: creatorAddress,
        limit:   limit.toString(),
        type,
    });

    const url = `${LUMESCOPE_API_BASE}/v1/actions?${params.toString()}`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Lumescope HTTP ${resp.status}`);
        const data = await resp.json() as LumescopeResponse;
        return data.items ?? [];
    } catch (err) {
        console.warn('Lumescope unavailable:', err);
        return [];
    }
}
