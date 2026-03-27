import {
  PROJECT_DEFAULT_BACKEND_URL,
  PROJECT_DEFAULT_FRONTEND_URL,
  SUPPORTED_CHAIN_IDS,
} from "@agent-wallet/shared";

export const DEFAULT_PORT = 3000;
export const DEFAULT_MIN_FUNDING_WEI = "500000000000000";
export const DEFAULT_REQUEST_TTL_HOURS = 24;

export type AppConfig = {
  port: number;
  databaseUrl: string;
  publicBackendUrl: string;
  frontendBaseUrl: string;
  minFundingWei: string;
  requestTtlHours: number;
  supportedChainIds: number[];
  bundlerUrlsByChain: Record<number, string>;
  rpcUrlsByChain: Record<number, string>;
};

function parseSupportedChainIds(rawValue: string | undefined) {
  if (!rawValue) {
    return [...SUPPORTED_CHAIN_IDS];
  }

  return rawValue
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function collectChainUrlMap(
  env: NodeJS.ProcessEnv,
  chainIds: number[],
  prefix: string,
) {
  return chainIds.reduce<Record<number, string>>((accumulator, chainId) => {
    const value = env[`${prefix}_${chainId}`];

    if (!value) {
      return accumulator;
    }

    return {
      ...accumulator,
      [chainId]: value,
    };
  }, {});
}

export function readConfig(env = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const supportedChainIds = parseSupportedChainIds(
    env.AGENT_WALLET_SUPPORTED_CHAIN_IDS,
  );

  return {
    port: Number(env.PORT ?? DEFAULT_PORT),
    databaseUrl,
    publicBackendUrl:
      env.AGENT_WALLET_PUBLIC_BACKEND_URL ?? PROJECT_DEFAULT_BACKEND_URL,
    frontendBaseUrl:
      env.AGENT_WALLET_PUBLIC_FRONTEND_URL ?? PROJECT_DEFAULT_FRONTEND_URL,
    minFundingWei: env.AGENT_WALLET_MIN_FUNDING_WEI ?? DEFAULT_MIN_FUNDING_WEI,
    requestTtlHours: Number(
      env.AGENT_WALLET_REQUEST_TTL_HOURS ?? DEFAULT_REQUEST_TTL_HOURS,
    ),
    supportedChainIds,
    bundlerUrlsByChain: collectChainUrlMap(
      env,
      supportedChainIds,
      "AGENT_WALLET_BUNDLER_URL",
    ),
    rpcUrlsByChain: collectChainUrlMap(
      env,
      supportedChainIds,
      "AGENT_WALLET_PUBLIC_RPC_URL",
    ),
  };
}
