import {
  type BackendSignerTypedDataPayload,
  getSupportedChainById,
  type LocalWalletRequest,
  type WalletRequest,
} from "@guardlabs/guardrail-core";
import { createWeightedKernelRuntime } from "@guardlabs/guardrail-kernel";
import { validateProvisioningArtifacts } from "@guardlabs/guardrail-kernel/validation";
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

function assertLocalProvisioningArtifactsAreValid(
  localRequest: LocalWalletRequest,
) {
  if (
    !localRequest.walletAddress ||
    !localRequest.ownerPublicArtifacts ||
    !localRequest.regularValidatorInitArtifact
  ) {
    return;
  }

  const validation = validateProvisioningArtifacts({
    walletAddress: localRequest.walletAddress as `0x${string}`,
    walletConfig: localRequest.walletConfig,
    owner: localRequest.ownerPublicArtifacts,
    regularValidatorInitArtifact: localRequest.regularValidatorInitArtifact,
    expectedOrigin: new URL(localRequest.provisioningUrl).origin,
  });

  if (!validation.ok) {
    throw new Error(
      `Stored provisioning artifacts are invalid: ${validation.message} Re-provision the wallet before retrying deployment or signing.`,
    );
  }
}

async function hydrateKernelRuntime(localRequest: LocalWalletRequest) {
  if (!localRequest.walletAddress) {
    throw new Error("Local wallet state is missing the wallet address.");
  }

  assertLocalProvisioningArtifactsAreValid(localRequest);

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

function toBackendTypedDataPayload(
  typedData: TypedDataDefinition<TypedData, string>,
): BackendSignerTypedDataPayload {
  return {
    domain: (typedData.domain ??
      {}) as unknown as BackendSignerTypedDataPayload["domain"],
    types: typedData.types as unknown as BackendSignerTypedDataPayload["types"],
    primaryType: typedData.primaryType as string,
    message: (typedData.message ??
      {}) as unknown as BackendSignerTypedDataPayload["message"],
  };
}

export async function hydrateReadyWalletRequest(input: {
  walletRequest: WalletRequest;
  localRequest: LocalWalletRequest;
}) {
  if (
    input.walletRequest.status !== "ready" ||
    !input.walletRequest.walletContext
  ) {
    throw new Error("Wallet is not ready for CLI hydration.");
  }

  const runtime = await hydrateKernelRuntime({
    ...input.localRequest,
    walletAddress: input.walletRequest.walletContext.walletAddress,
    walletConfig: input.walletRequest.walletConfig,
    ownerPublicArtifacts: input.walletRequest.ownerPublicArtifacts,
    regularValidatorInitArtifact:
      input.walletRequest.regularValidatorInitArtifact,
    backendAddress: input.walletRequest.backendAddress,
  });

  if (
    runtime.kernelAccount.address.toLowerCase() !==
    input.walletRequest.walletContext.walletAddress.toLowerCase()
  ) {
    throw new Error(
      "Hydrated account address does not match the backend wallet context.",
    );
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
  if (
    input.localRequest.lastKnownStatus !== "ready" ||
    !input.localRequest.walletAddress
  ) {
    throw new Error("Local wallet is not ready for contract calls.");
  }

  const runtime = await hydrateKernelRuntime(input.localRequest);
  runtime.backendRemoteSigner.beginUserOperationSigning({
    kind: "single_call",
    to: input.call.to,
    value: input.call.valueWei,
    data: input.call.data,
  });

  try {
    const transactionHash = await runtime.kernelClient.sendTransaction({
      to: input.call.to,
      data: input.call.data,
      value: BigInt(input.call.valueWei),
    });

    return {
      walletAddress: runtime.kernelAccount.address,
      transactionHash,
    };
  } finally {
    runtime.backendRemoteSigner.clearSigningContext();
  }
}

export async function ensureReadyWalletDeployed(input: {
  localRequest: LocalWalletRequest;
}) {
  if (
    input.localRequest.lastKnownStatus !== "ready" ||
    !input.localRequest.walletAddress
  ) {
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

  runtime.backendRemoteSigner.beginDeployWalletSigning();

  try {
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
  } finally {
    runtime.backendRemoteSigner.clearSigningContext();
  }
}

export async function signReadyWalletTypedData(input: {
  localRequest: LocalWalletRequest;
  typedData: TypedDataDefinition<TypedData, string>;
}) {
  if (
    input.localRequest.lastKnownStatus !== "ready" ||
    !input.localRequest.walletAddress
  ) {
    throw new Error("Local wallet is not ready for typed-data signing.");
  }

  const runtime = await hydrateKernelRuntime(input.localRequest);
  runtime.backendRemoteSigner.beginTypedDataSigning(
    toBackendTypedDataPayload(input.typedData),
  );

  try {
    const signature = await runtime.kernelAccount.signTypedData(
      input.typedData,
    );

    return {
      walletAddress: runtime.kernelAccount.address,
      signature: signature as Hex,
    };
  } finally {
    runtime.backendRemoteSigner.clearSigningContext();
  }
}
