export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const supportedChains = [
  {
    id: BASE_SEPOLIA_CHAIN_ID,
    key: "base-sepolia",
    name: "Base Sepolia",
  },
] as const;

export const SUPPORTED_CHAIN_IDS = supportedChains.map(
  (chain) => chain.id,
) as number[];

export function isSupportedChainId(chainId: number) {
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}
