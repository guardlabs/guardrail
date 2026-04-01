import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

function createEnv(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://conduit:conduit@127.0.0.1:5432/conduit",
    CONDUIT_PUBLIC_BACKEND_URL: "http://127.0.0.1:3000",
    CONDUIT_PUBLIC_FRONTEND_URL: "http://127.0.0.1:5173",
    CONDUIT_MIN_FUNDING_WEI: "500000000000000",
    CONDUIT_SUPPORTED_CHAIN_IDS: "84532",
    CONDUIT_REQUEST_TTL_HOURS: "24",
    CONDUIT_BUNDLER_URL_8453: "https://bundler-mainnet.example.com",
    CONDUIT_PUBLIC_RPC_URL_8453: "https://rpc-mainnet.example.com",
    CONDUIT_BUNDLER_URL_84532: "https://bundler.example.com",
    CONDUIT_PUBLIC_RPC_URL_84532: "https://rpc.example.com",
    ...overrides,
  };
}

describe("readConfig", () => {
  it("requires per-chain bundler and rpc URLs for supported chains", () => {
    expect(() =>
      readConfig(
        createEnv({
          CONDUIT_BUNDLER_URL_84532: "",
        }),
      ),
    ).toThrow(/CONDUIT_BUNDLER_URL_84532/i);
  });

  it("rejects unsupported chain ids", () => {
    expect(() =>
      readConfig(
        createEnv({
          CONDUIT_SUPPORTED_CHAIN_IDS: "1",
        }),
      ),
    ).toThrow(/Unsupported chainId 1/i);
  });

  it("parses a valid production-style config", () => {
    expect(readConfig(createEnv())).toMatchObject({
      port: 3000,
      publicBackendUrl: "http://127.0.0.1:3000/",
      frontendBaseUrl: "http://127.0.0.1:5173/",
      supportedChainIds: [84532],
      bundlerUrlsByChain: {
        84532: "https://bundler.example.com",
      },
      rpcUrlsByChain: {
        84532: "https://rpc.example.com",
      },
    });
  });

  it("parses multiple supported chains when both runtime maps are configured", () => {
    expect(
      readConfig(
        createEnv({
          CONDUIT_SUPPORTED_CHAIN_IDS: "8453,84532",
        }),
      ),
    ).toMatchObject({
      supportedChainIds: [8453, 84532],
      bundlerUrlsByChain: {
        8453: "https://bundler-mainnet.example.com",
        84532: "https://bundler.example.com",
      },
      rpcUrlsByChain: {
        8453: "https://rpc-mainnet.example.com",
        84532: "https://rpc.example.com",
      },
    });
  });
});
