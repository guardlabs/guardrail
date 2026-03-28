import {
  getSupportedChainById,
  type LocalWalletRequest,
  type WalletRequest,
} from "@agent-wallet/shared";
import { deserializePermissionAccount } from "@agent-wallet/zerodev/permission-account";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import type { Chain, Hex } from "viem";
import { createPublicClient, http } from "viem";
import { estimateFeesPerGas } from "viem/actions";
import { privateKeyToAccount } from "viem/accounts";

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

export type KernelHydrationDependencies = {
  createPublicClient: (parameters: {
    chain: Chain;
    transport: unknown;
  }) => {
    transport: unknown;
  };
  http: (url: string) => unknown;
  estimateFeesPerGas: (client: unknown) => Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }>;
  privateKeyToAccount: (privateKey: Hex) => {
    address: string;
  };
  toECDSASigner: (parameters: {
    signer: unknown;
  }) => Promise<unknown>;
  deserializePermissionAccount: (
    client: unknown,
    entryPoint: unknown,
    kernelVersion: string,
    serializedPermissionAccount: string,
    signer: unknown,
  ) => Promise<{
    address: string;
  }>;
  createKernelAccountClient: (parameters: {
    account: unknown;
    chain: Chain;
    bundlerTransport: unknown;
    client: unknown;
    userOperation?: {
      estimateFeesPerGas?: (parameters: unknown) => Promise<{
        maxFeePerGas: bigint;
        maxPriorityFeePerGas: bigint;
      }>;
    };
  }) => {
    sendTransaction: (parameters: {
      to: `0x${string}`;
      data: `0x${string}`;
      value: bigint;
    }) => Promise<`0x${string}`>;
  };
};

type HydratedKernelRuntime = {
  walletAddress: string;
  serializedPermissionAccount: string;
  kernelClient: {
    sendTransaction: (parameters: {
      to: `0x${string}`;
      data: `0x${string}`;
      value: bigint;
    }) => Promise<`0x${string}`>;
  };
};

async function hydrateKernelRuntime(
  input: {
    chainId: number;
    backendBaseUrl: string;
    walletAddress: string;
    serializedPermissionAccount: string;
    sessionPrivateKey: string;
  },
  dependencies: Partial<KernelHydrationDependencies> = {},
): Promise<HydratedKernelRuntime> {
  const chain = getChain(input.chainId);
  const { rpcUrl, bundlerUrl } = resolveRuntimeConfiguration(
    input.chainId,
    input.backendBaseUrl,
  );

  const makeTransport = dependencies.http ?? http;
  const publicClient = ((dependencies.createPublicClient ??
    createPublicClient)({
    chain,
    transport: makeTransport(rpcUrl) as ReturnType<typeof http>,
  }) as ReturnType<typeof createPublicClient>);
  const sessionAccount = ((dependencies.privateKeyToAccount ??
    privateKeyToAccount)(
    input.sessionPrivateKey as Hex,
  ) as ReturnType<typeof privateKeyToAccount>);
  const sessionSigner = (await (dependencies.toECDSASigner ?? toECDSASigner)({
    signer: sessionAccount,
  })) as Awaited<ReturnType<typeof toECDSASigner>>;
  const deserializePermissionAccountFn = (
    dependencies.deserializePermissionAccount ?? deserializePermissionAccount
  ) as (...args: unknown[]) => Promise<{ address: string }>;
  const kernelAccount = await deserializePermissionAccountFn(
    publicClient,
    getEntryPoint("0.7"),
    KERNEL_V3_1,
    input.serializedPermissionAccount,
    sessionSigner,
  );

  if (kernelAccount.address.toLowerCase() !== input.walletAddress.toLowerCase()) {
    throw new Error("Hydrated account address does not match the backend wallet context.");
  }

  const createKernelAccountClientFn = (
    dependencies.createKernelAccountClient ?? createKernelAccountClient
  ) as KernelHydrationDependencies["createKernelAccountClient"];

  return {
    walletAddress: kernelAccount.address,
    serializedPermissionAccount: input.serializedPermissionAccount,
    kernelClient: createKernelAccountClientFn({
      account: kernelAccount,
      chain,
      bundlerTransport: makeTransport(bundlerUrl),
      client: publicClient,
      userOperation: {
        estimateFeesPerGas: async () =>
          (dependencies.estimateFeesPerGas ?? estimateFeesPerGas)(
            publicClient,
          ),
      },
    }),
  };
}

export async function hydrateReadyWalletRequest(
  input: {
    walletRequest: WalletRequest;
    localRequest: LocalWalletRequest;
  },
  dependencies: Partial<KernelHydrationDependencies> = {},
) {
  if (
    input.walletRequest.status !== "ready" ||
    !input.walletRequest.walletContext
  ) {
    throw new Error("Wallet is not ready for CLI hydration.");
  }

  const { walletContext } = input.walletRequest;
  const runtime = await hydrateKernelRuntime(
    {
      chainId: walletContext.chainId,
      backendBaseUrl: input.localRequest.backendBaseUrl,
      walletAddress: walletContext.walletAddress,
      serializedPermissionAccount: walletContext.serializedPermissionAccount,
      sessionPrivateKey: input.localRequest.sessionPrivateKey,
    },
    dependencies,
  );

  return {
    walletAddress: runtime.walletAddress,
    serializedPermissionAccount: walletContext.serializedPermissionAccount,
  };
}

export async function callReadyWalletTransaction(
  input: {
    localRequest: LocalWalletRequest;
    call: {
      to: `0x${string}`;
      data: `0x${string}`;
      valueWei: string;
    };
  },
  dependencies: Partial<KernelHydrationDependencies> = {},
) {
  if (
    input.localRequest.lastKnownStatus !== "ready" ||
    !input.localRequest.walletAddress ||
    !input.localRequest.serializedPermissionAccount
  ) {
    throw new Error("Local wallet is not ready for contract calls.");
  }

  const runtime = await hydrateKernelRuntime(
    {
      chainId: input.localRequest.chainId,
      backendBaseUrl: input.localRequest.backendBaseUrl,
      walletAddress: input.localRequest.walletAddress,
      serializedPermissionAccount: input.localRequest.serializedPermissionAccount,
      sessionPrivateKey: input.localRequest.sessionPrivateKey,
    },
    dependencies,
  );

  const transactionHash = await runtime.kernelClient.sendTransaction({
    to: input.call.to,
    data: input.call.data,
    value: BigInt(input.call.valueWei),
  });

  return {
    walletAddress: runtime.walletAddress,
    transactionHash,
  };
}
