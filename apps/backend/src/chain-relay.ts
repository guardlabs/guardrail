import type { AppConfig } from "./config.js";

export type RelayTarget = "rpc" | "bundler";

export type ChainRelayService = {
  relay(input: {
    chainId: number;
    target: RelayTarget;
    payload: unknown;
  }): Promise<unknown>;
};

function resolveTargetUrl(
  config: AppConfig,
  chainId: number,
  target: RelayTarget,
) {
  if (!config.supportedChainIds.includes(chainId)) {
    return null;
  }

  if (target === "rpc") {
    return config.rpcUrlsByChain[chainId] ?? null;
  }

  return config.bundlerUrlsByChain[chainId] ?? null;
}

export function createChainRelayService(config: AppConfig): ChainRelayService {
  return {
    async relay({ chainId, target, payload }) {
      const targetUrl = resolveTargetUrl(config, chainId, target);

      if (!targetUrl) {
        throw new Error(
          `Missing ${target} relay target for supported chain ${chainId}.`,
        );
      }

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responsePayload = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(
          `${target} relay failed with status ${response.status}: ${JSON.stringify(responsePayload)}`,
        );
      }

      return responsePayload;
    },
  };
}
