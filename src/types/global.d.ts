// Keplr extension window augmentation
interface Window {
    keplr?: {
        enable(chainId: string): Promise<void>;
        experimentalSuggestChain(chainInfo: unknown): Promise<void>;
        getKey(chainId: string): Promise<{ bech32Address: string; name: string }>;
        signArbitrary(
            chainId: string,
            signer: string,
            data: string
        ): Promise<{ signature: string; pub_key: { type: string; value: string } }>;
    };
}
