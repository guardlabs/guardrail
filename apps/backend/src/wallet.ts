import type {
  DeploymentState,
  FundingState,
  OwnerPublicArtifacts,
  RegularValidatorInitArtifact,
  WalletConfig,
  WalletContext,
  WalletRequestStatus,
} from "@guardlabs/guardrail-core";
import type { AppConfig } from "./config.js";
import { buildFundingState } from "./funding.js";

export type PreparedWallet = {
  ownerPublicArtifacts: OwnerPublicArtifacts;
  regularValidatorInitArtifact: RegularValidatorInitArtifact;
  counterfactualWalletAddress: string;
  funding: FundingState;
  deployment: DeploymentState;
  walletContext: WalletContext;
  status: Extract<WalletRequestStatus, "owner_bound" | "ready">;
};

export type WalletProvisioningService = {
  finalizeProvisioning(input: {
    owner: OwnerPublicArtifacts;
    regularValidatorInitArtifact: RegularValidatorInitArtifact;
    walletConfig: WalletConfig;
    agentAddress: string;
    backendAddress: string;
    counterfactualWalletAddress: string;
  }): Promise<PreparedWallet>;
  refreshFunding(input: {
    owner: OwnerPublicArtifacts;
    regularValidatorInitArtifact: RegularValidatorInitArtifact;
    walletConfig: WalletConfig;
    agentAddress: string;
    backendAddress: string;
    counterfactualWalletAddress: string;
  }): Promise<PreparedWallet>;
};

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
    balanceWei: await fetchBalanceWei(
      rpcUrl,
      input.counterfactualWalletAddress,
    ),
    checkedAt: new Date().toISOString(),
    minimumRequiredWei: input.config.minFundingWei,
  });
}

async function fetchCodeHex(rpcUrl: string, address: string) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_getCode",
      params: [address, "latest"],
    }),
  });

  if (!response.ok) {
    throw new Error(`Code RPC failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    error?: { message?: string };
    result?: string;
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? "Code RPC failed");
  }

  if (payload.result === undefined) {
    throw new Error("Code RPC returned no result");
  }

  return payload.result;
}

async function resolveDeployment(input: {
  chainId: number;
  counterfactualWalletAddress: string;
  config: AppConfig;
}) {
  const rpcUrl =
    input.config.rpcUrlsByChain[input.chainId] ??
    input.config.bundlerUrlsByChain[input.chainId];

  if (!rpcUrl) {
    return {
      status: "undeployed" as const,
    };
  }

  const codeHex = await fetchCodeHex(rpcUrl, input.counterfactualWalletAddress);

  return {
    status: codeHex !== "0x" ? ("deployed" as const) : ("undeployed" as const),
    checkedAt: new Date().toISOString(),
  };
}

function buildWalletContext(input: {
  owner: OwnerPublicArtifacts;
  walletConfig: WalletConfig;
  agentAddress: string;
  backendAddress: string;
  counterfactualWalletAddress: string;
}): WalletContext {
  return {
    walletAddress: input.counterfactualWalletAddress,
    chainId: input.walletConfig.chainId,
    kernelVersion: input.walletConfig.kernelVersion,
    entryPointVersion: input.walletConfig.entryPointVersion,
    owner: input.owner,
    agentAddress: input.agentAddress,
    backendAddress: input.backendAddress,
    weightedValidator: input.walletConfig.regularValidator,
  };
}

export function createWalletProvisioningService(
  config: AppConfig,
): WalletProvisioningService {
  return {
    async finalizeProvisioning(input) {
      const funding = await resolveFunding({
        chainId: input.walletConfig.chainId,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        config,
      });
      const deployment = await resolveDeployment({
        chainId: input.walletConfig.chainId,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        config,
      });
      const walletContext = buildWalletContext(input);

      return {
        ownerPublicArtifacts: input.owner,
        regularValidatorInitArtifact: input.regularValidatorInitArtifact,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        funding,
        deployment,
        walletContext,
        status: funding.status === "verified" ? "ready" : "owner_bound",
      };
    },
    async refreshFunding(input) {
      const funding = await resolveFunding({
        chainId: input.walletConfig.chainId,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        config,
      });
      const deployment = await resolveDeployment({
        chainId: input.walletConfig.chainId,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        config,
      });
      const walletContext = buildWalletContext(input);

      return {
        ownerPublicArtifacts: input.owner,
        regularValidatorInitArtifact: input.regularValidatorInitArtifact,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        funding,
        deployment,
        walletContext,
        status: funding.status === "verified" ? "ready" : "owner_bound",
      };
    },
  };
}
