import {
  getSupportedChainById,
  GUARDRAIL_DEFAULT_BACKEND_URL,
  GUARDRAIL_DEFAULT_FRONTEND_URL,
  SUPPORTED_CHAIN_IDS,
} from "@guardlabs/guardrail-core";

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

function parsePositiveInteger(
  rawValue: string | undefined,
  fallback: number,
  label: string,
) {
  const value = Number(rawValue ?? fallback);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function parseAbsoluteUrl(
  rawValue: string | undefined,
  fallback: string,
  label: string,
) {
  const value = rawValue ?? fallback;

  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
}

function parseMinFundingWei(rawValue: string | undefined) {
  const value = rawValue ?? DEFAULT_MIN_FUNDING_WEI;

  if (!/^\d+$/.test(value)) {
    throw new Error(
      "GUARDRAIL_MIN_FUNDING_WEI must be an unsigned integer string.",
    );
  }

  return value;
}

function parseSupportedChainIds(rawValue: string | undefined) {
  const chainIds = rawValue
    ? rawValue
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [...SUPPORTED_CHAIN_IDS];

  if (chainIds.length === 0) {
    throw new Error(
      "GUARDRAIL_SUPPORTED_CHAIN_IDS must include at least one supported chain.",
    );
  }

  for (const chainId of chainIds) {
    if (!getSupportedChainById(chainId)) {
      throw new Error(
        `Unsupported chainId ${chainId} in GUARDRAIL_SUPPORTED_CHAIN_IDS.`,
      );
    }
  }

  return chainIds;
}

function collectRequiredChainUrlMap(
  env: NodeJS.ProcessEnv,
  chainIds: number[],
  prefix: string,
  label: string,
) {
  return chainIds.reduce<Record<number, string>>((accumulator, chainId) => {
    const value = env[`${prefix}_${chainId}`];

    if (!value) {
      throw new Error(
        `${prefix}_${chainId} is required for supported chain ${chainId} (${label}).`,
      );
    }

    parseAbsoluteUrl(value, value, `${prefix}_${chainId}`);

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
    env.GUARDRAIL_SUPPORTED_CHAIN_IDS,
  );

  return {
    port: parsePositiveInteger(env.PORT, DEFAULT_PORT, "PORT"),
    databaseUrl,
    publicBackendUrl: parseAbsoluteUrl(
      env.GUARDRAIL_PUBLIC_BACKEND_URL,
      GUARDRAIL_DEFAULT_BACKEND_URL,
      "GUARDRAIL_PUBLIC_BACKEND_URL",
    ),
    frontendBaseUrl: parseAbsoluteUrl(
      env.GUARDRAIL_PUBLIC_FRONTEND_URL,
      GUARDRAIL_DEFAULT_FRONTEND_URL,
      "GUARDRAIL_PUBLIC_FRONTEND_URL",
    ),
    minFundingWei: parseMinFundingWei(env.GUARDRAIL_MIN_FUNDING_WEI),
    requestTtlHours: parsePositiveInteger(
      env.GUARDRAIL_REQUEST_TTL_HOURS,
      DEFAULT_REQUEST_TTL_HOURS,
      "GUARDRAIL_REQUEST_TTL_HOURS",
    ),
    supportedChainIds,
    bundlerUrlsByChain: collectRequiredChainUrlMap(
      env,
      supportedChainIds,
      "GUARDRAIL_BUNDLER_URL",
      "bundler",
    ),
    rpcUrlsByChain: collectRequiredChainUrlMap(
      env,
      supportedChainIds,
      "GUARDRAIL_PUBLIC_RPC_URL",
      "rpc",
    ),
  };
}
