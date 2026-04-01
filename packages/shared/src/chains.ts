import type { Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

export type SupportedChain = {
  id: number;
  key: string;
  name: string;
  frontendRuntimeKey: string;
  officialUsdcAddress: string;
  officialUsdcDecimals: number;
  viemChain: Chain;
};

export const supportedChains: SupportedChain[] = [
  {
    id: 8453,
    key: "base",
    name: "Base",
    frontendRuntimeKey: "BASE",
    officialUsdcAddress: "0x833589fCD6EDB6E08f4c7C32D4f71b54bdA02913",
    officialUsdcDecimals: 6,
    viemChain: base,
  },
  {
    id: 84532,
    key: "base-sepolia",
    name: "Base Sepolia",
    frontendRuntimeKey: "BASE_SEPOLIA",
    officialUsdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    officialUsdcDecimals: 6,
    viemChain: baseSepolia,
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
