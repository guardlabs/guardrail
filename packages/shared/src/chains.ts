export const BASE_SEPOLIA_CHAIN_ID = 84532;

export type SupportedChain = {
  id: number;
  key: string;
  name: string;
  frontendRuntimeKey: string;
};

export const supportedChains: SupportedChain[] = [
  {
    id: BASE_SEPOLIA_CHAIN_ID,
    key: "base-sepolia",
    name: "Base Sepolia",
    frontendRuntimeKey: "BASE_SEPOLIA",
  },
];

export const SUPPORTED_CHAIN_IDS = supportedChains.map(
  (chain) => chain.id,
) as number[];

export function isSupportedChainId(chainId: number) {
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}

export function getSupportedChainById(chainId: number) {
  return supportedChains.find((chain) => chain.id === chainId);
}
