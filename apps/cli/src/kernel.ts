import {
  getSupportedChainById,
  type LocalWalletRequest,
  type WalletRequest,
} from "@agent-wallet/shared";
import { createWeightedKernelRuntime } from "@agent-wallet/zerodev";
import type { Chain, Hex, TypedData, TypedDataDefinition } from "viem";

function getChain(chainId: number): Chain {
  const supportedChain = getSupportedChainById(chainId);

  if (!supportedChain) {
    throw new Error(`Unsupported chain ${chainId} for CLI wallet hydration.`);
  }

  return supportedChain.viemChain;
}

function resolveRuntimeConfiguration(chainId: number, backendBaseUrl: string) {
  if (!backendBaseUrl) {
    throw new Error(
      "Missing backend URL in local wallet state. Re-create the wallet or set a backend URL before calling it.",
    );
  }

  const baseUrl = backendBaseUrl.replace(/\/+$/, "");

  return {
    rpcUrl: `${baseUrl}/v1/chains/${chainId}/rpc`,
    bundlerUrl: `${baseUrl}/v1/chains/${chainId}/bundler`,
  };
}

async function hydrateKernelRuntime(localRequest: LocalWalletRequest) {
  if (!localRequest.walletAddress) {
    throw new Error("Local wallet state is missing the wallet address.");
  }

  const chain = getChain(localRequest.chainId);
  const { rpcUrl, bundlerUrl } = resolveRuntimeConfiguration(
    localRequest.chainId,
    localRequest.backendBaseUrl,
  );

  return createWeightedKernelRuntime({
    chain,
    walletId: localRequest.walletId,
    walletAddress: localRequest.walletAddress as `0x${string}`,
    walletConfig: localRequest.walletConfig,
    ownerPublicArtifacts: localRequest.ownerPublicArtifacts,
    regularValidatorInitArtifact: localRequest.regularValidatorInitArtifact,
    backendBaseUrl: localRequest.backendBaseUrl,
    agentPrivateKey: localRequest.agentPrivateKey as `0x${string}`,
    rpcUrl,
    bundlerUrl,
  });
}

export async function hydrateReadyWalletRequest(input: {
  walletRequest: WalletRequest;
  localRequest: LocalWalletRequest;
}) {
  if (input.walletRequest.status !== "ready" || !input.walletRequest.walletContext) {
    throw new Error("Wallet is not ready for CLI hydration.");
  }

  const runtime = await hydrateKernelRuntime({
    ...input.localRequest,
    walletAddress: input.walletRequest.walletContext.walletAddress,
    walletConfig: input.walletRequest.walletConfig,
    ownerPublicArtifacts: input.walletRequest.ownerPublicArtifacts,
    regularValidatorInitArtifact: input.walletRequest.regularValidatorInitArtifact,
    backendAddress: input.walletRequest.backendAddress,
  });

  if (
    runtime.kernelAccount.address.toLowerCase() !==
    input.walletRequest.walletContext.walletAddress.toLowerCase()
  ) {
    throw new Error("Hydrated account address does not match the backend wallet context.");
  }

  return {
    walletAddress: runtime.kernelAccount.address,
  };
}

export async function callReadyWalletTransaction(input: {
  localRequest: LocalWalletRequest;
  call: {
    to: `0x${string}`;
    data: `0x${string}`;
    valueWei: string;
  };
}) {
  if (input.localRequest.lastKnownStatus !== "ready" || !input.localRequest.walletAddress) {
    throw new Error("Local wallet is not ready for contract calls.");
  }

  const runtime = await hydrateKernelRuntime(input.localRequest);
  const transactionHash = await runtime.kernelClient.sendTransaction({
    to: input.call.to,
    data: input.call.data,
    value: BigInt(input.call.valueWei),
  });

  return {
    walletAddress: runtime.kernelAccount.address,
    transactionHash,
  };
}

export async function ensureReadyWalletDeployed(input: {
  localRequest: LocalWalletRequest;
}) {
  if (input.localRequest.lastKnownStatus !== "ready" || !input.localRequest.walletAddress) {
    throw new Error("Local wallet is not ready for deployment checks.");
  }

  const runtime = await hydrateKernelRuntime(input.localRequest);
  const code = await runtime.publicClient.getCode({
    address: runtime.kernelAccount.address,
  });

  if (code && code !== "0x") {
    return {
      walletAddress: runtime.kernelAccount.address,
      deployed: true,
      deployedByThisCall: false,
    };
  }

  const transactionHash = await runtime.kernelClient.sendTransaction({
    to: input.localRequest.agentAddress as `0x${string}`,
    data: "0x",
    value: 0n,
  });

  await runtime.publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  return {
    walletAddress: runtime.kernelAccount.address,
    deployed: true,
    deployedByThisCall: true,
    transactionHash,
  };
}

export async function signReadyWalletTypedData(input: {
  localRequest: LocalWalletRequest;
  typedData: TypedDataDefinition<TypedData, string>;
}) {
  if (input.localRequest.lastKnownStatus !== "ready" || !input.localRequest.walletAddress) {
    throw new Error("Local wallet is not ready for typed-data signing.");
  }

  const runtime = await hydrateKernelRuntime(input.localRequest);
  const signature = await runtime.kernelAccount.signTypedData(input.typedData);

  return {
    walletAddress: runtime.kernelAccount.address,
    signature: signature as Hex,
  };
}
