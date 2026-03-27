import { createHash } from "node:crypto";
import type {
  FundingState,
  OwnerPublicArtifacts,
  PermissionScope,
  WalletContext,
  WalletRequestStatus,
} from "@agent-wallet/shared";
import type { AppConfig } from "./config.js";
import { buildFundingState } from "./funding.js";

export type PreparedWallet = {
  ownerPublicArtifacts: OwnerPublicArtifacts;
  counterfactualWalletAddress: string;
  funding: FundingState;
  walletContext?: WalletContext;
  status: Extract<WalletRequestStatus, "owner_bound" | "ready">;
};

export type WalletProvisioningService = {
  finalizeProvisioning(input: {
    owner: OwnerPublicArtifacts;
    scope: PermissionScope;
    sessionPublicKey: string;
    counterfactualWalletAddress: string;
    serializedPermissionAccount: string;
  }): Promise<PreparedWallet>;
  refreshFunding(input: {
    owner: OwnerPublicArtifacts;
    scope: PermissionScope;
    sessionPublicKey: string;
    counterfactualWalletAddress: string;
    serializedPermissionAccount: string;
  }): Promise<PreparedWallet>;
};

function derivePolicyDigest(scope: PermissionScope) {
  return `0x${createHash("sha256").update(JSON.stringify(scope)).digest("hex")}`;
}

async function fetchBalanceWei(rpcUrl: string, address: string) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });

  if (!response.ok) {
    throw new Error(`Balance RPC failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    error?: { message?: string };
    result?: string;
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? "Balance RPC failed");
  }

  if (!payload.result) {
    throw new Error("Balance RPC returned no result");
  }

  return BigInt(payload.result).toString();
}

async function resolveFunding(input: {
  chainId: number;
  counterfactualWalletAddress: string;
  config: AppConfig;
}) {
  const rpcUrl =
    input.config.rpcUrlsByChain[input.chainId] ??
    input.config.bundlerUrlsByChain[input.chainId];

  if (!rpcUrl) {
    return {
      status: "unverified" as const,
      minimumRequiredWei: input.config.minFundingWei,
    };
  }

  return buildFundingState({
    balanceWei: await fetchBalanceWei(rpcUrl, input.counterfactualWalletAddress),
    checkedAt: new Date().toISOString(),
    minimumRequiredWei: input.config.minFundingWei,
  });
}

function buildWalletContext(input: {
  owner: OwnerPublicArtifacts;
  scope: PermissionScope;
  sessionPublicKey: string;
  counterfactualWalletAddress: string;
  serializedPermissionAccount: string;
}): WalletContext {
  return {
    walletAddress: input.counterfactualWalletAddress,
    chainId: input.scope.chainId,
    kernelVersion: "3.1",
    sessionPublicKey: input.sessionPublicKey,
    owner: input.owner,
    scope: input.scope,
    policyDigest: derivePolicyDigest(input.scope),
    serializedPermissionAccount: input.serializedPermissionAccount,
  };
}

export function createWalletProvisioningService(
  config: AppConfig,
): WalletProvisioningService {
  return {
    async finalizeProvisioning(input) {
      const funding = await resolveFunding({
        chainId: input.scope.chainId,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        config,
      });

      const walletContext = buildWalletContext(input);

      return {
        ownerPublicArtifacts: input.owner,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        funding,
        walletContext,
        status: funding.status === "verified" ? "ready" : "owner_bound",
      };
    },
    async refreshFunding(input) {
      const funding = await resolveFunding({
        chainId: input.scope.chainId,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        config,
      });

      const walletContext = buildWalletContext(input);

      return {
        ownerPublicArtifacts: input.owner,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        funding,
        walletContext,
        status: funding.status === "verified" ? "ready" : "owner_bound",
      };
    },
  };
}
