import {
  getCanonicalWeightedSignerOrder,
  type OwnerPublicArtifacts,
  type RegularValidatorInitArtifact,
  type WalletConfig,
} from "@guardlabs/guardrail-core";
import {
  createKernelAccount,
  toKernelPluginManager,
} from "@zerodev/sdk/accounts";
import { createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { createWeightedECDSAValidator } from "@zerodev/weighted-ecdsa-validator";
import type { Address, Chain, Client, Hex } from "viem";
import { createPublicClient, encodeAbiParameters, http } from "viem";
import {
  prepareUserOperation,
  toPackedUserOperation,
} from "viem/account-abstraction";
import { estimateFeesPerGas } from "viem/actions";
import { privateKeyToAccount, toAccount } from "viem/accounts";
import { createBackendRemoteSigner } from "./backend-remote-signer.js";

function getWeightedValidatorConfig(walletConfig: WalletConfig) {
  const signers = getCanonicalWeightedSignerOrder(
    walletConfig.regularValidator.signers,
  );

  return {
    threshold: walletConfig.regularValidator.threshold,
    delay: walletConfig.regularValidator.delaySeconds,
    signers: signers.map((signer) => ({
      address: signer.address as Address,
      weight: signer.weight,
    })),
  };
}

function createProvisioningOnlySigner(address: Address) {
  return toAccount({
    address,
    async signMessage() {
      throw new Error(
        "Provisioning-only weighted signer cannot sign messages.",
      );
    },
    async signTransaction() {
      throw new Error(
        "Provisioning-only weighted signer cannot sign transactions.",
      );
    },
    async signTypedData() {
      throw new Error(
        "Provisioning-only weighted signer cannot sign typed data.",
      );
    },
  });
}

function decodeOwnerPublicKey(owner: OwnerPublicArtifacts) {
  const normalized = owner.publicKey.slice(2);

  if (normalized.length !== 64 * 3) {
    throw new Error(
      "Owner public key is not a supported encoded WebAuthn public key.",
    );
  }

  return {
    pubX: BigInt(`0x${normalized.slice(0, 64)}`),
    pubY: BigInt(`0x${normalized.slice(64, 128)}`),
    authenticatorIdHash: `0x${normalized.slice(128, 192)}` as Hex,
  };
}

function normalizePackedUserOperation(
  userOperation: ReturnType<typeof toPackedUserOperation>,
) {
  return {
    sender: userOperation.sender,
    nonce: userOperation.nonce.toString(),
    initCode: userOperation.initCode,
    callData: userOperation.callData,
    accountGasLimits: userOperation.accountGasLimits,
    preVerificationGas: userOperation.preVerificationGas.toString(),
    gasFees: userOperation.gasFees,
    paymasterAndData: userOperation.paymasterAndData,
  };
}

export function createStaticPasskeyValidator(input: {
  walletConfig: WalletConfig;
  owner: OwnerPublicArtifacts;
}) {
  const decodedOwner = decodeOwnerPublicKey(input.owner);
  const account = toAccount({
    address: input.walletConfig.sudoValidator.address as Address,
    async signMessage() {
      throw new Error(
        "Static passkey validator cannot sign messages at runtime.",
      );
    },
    async signTransaction() {
      throw new Error("Static passkey validator cannot sign transactions.");
    },
    async signTypedData() {
      throw new Error(
        "Static passkey validator cannot sign typed data at runtime.",
      );
    },
  });

  return {
    ...account,
    supportedKernelVersions: KERNEL_V3_1,
    validatorType: "SECONDARY" as const,
    source: "StaticPasskeyValidator",
    getIdentifier() {
      return input.walletConfig.sudoValidator.address as Hex;
    },
    async getEnableData() {
      return encodeAbiParameters(
        [
          {
            components: [
              { name: "x", type: "uint256" },
              { name: "y", type: "uint256" },
            ],
            name: "webAuthnData",
            type: "tuple",
          },
          {
            name: "authenticatorIdHash",
            type: "bytes32",
          },
        ],
        [
          {
            x: decodedOwner.pubX,
            y: decodedOwner.pubY,
          },
          decodedOwner.authenticatorIdHash,
        ],
      );
    },
    async getNonceKey(_accountAddress?: Address, customNonceKey?: bigint) {
      return customNonceKey ?? 0n;
    },
    async getStubSignature() {
      throw new Error(
        "Static passkey validator does not produce runtime stub signatures.",
      );
    },
    async signUserOperation() {
      throw new Error(
        "Static passkey validator does not sign user operations at runtime.",
      );
    },
    async isEnabled() {
      return false;
    },
  };
}

async function createRuntimeKernelPluginManager(
  client: Client,
  input: {
    chain: Chain;
    walletId: string;
    walletAddress: Address;
    walletConfig: WalletConfig;
    ownerPublicArtifacts?: OwnerPublicArtifacts;
    regularValidatorInitArtifact?: RegularValidatorInitArtifact;
    backendBaseUrl: string;
    agentPrivateKey: Hex;
  },
) {
  const { backendRemoteSigner, weightedValidator } =
    await createRuntimeWeightedValidator(client, {
      walletId: input.walletId,
      walletAddress: input.walletAddress,
      walletConfig: input.walletConfig,
      backendBaseUrl: input.backendBaseUrl,
      agentPrivateKey: input.agentPrivateKey,
    });

  if (!input.ownerPublicArtifacts || !input.regularValidatorInitArtifact) {
    return {
      backendRemoteSigner,
      kernelPluginManager: await toKernelPluginManager(client, {
        regular: weightedValidator,
        entryPoint: getEntryPoint("0.7"),
        kernelVersion: KERNEL_V3_1,
        chainId: input.chain.id,
      }),
    };
  }

  const expectedEnableData = await weightedValidator.getEnableData(
    input.walletAddress,
  );

  if (
    weightedValidator.address.toLowerCase() !==
    input.regularValidatorInitArtifact.validatorAddress.toLowerCase()
  ) {
    throw new Error(
      "Stored weighted validator address does not match the runtime validator.",
    );
  }

  if (
    expectedEnableData.toLowerCase() !==
    input.regularValidatorInitArtifact.enableData.toLowerCase()
  ) {
    throw new Error(
      "Stored weighted validator enable data does not match the runtime config.",
    );
  }

  return {
    backendRemoteSigner,
    kernelPluginManager: await toKernelPluginManager(client, {
      sudo: createStaticPasskeyValidator({
        walletConfig: input.walletConfig,
        owner: input.ownerPublicArtifacts,
      }),
      regular: weightedValidator,
      pluginEnableSignature: input.regularValidatorInitArtifact
        .pluginEnableSignature as Hex,
      entryPoint: getEntryPoint("0.7"),
      kernelVersion: KERNEL_V3_1,
      chainId: input.chain.id,
    }),
  };
}

export async function createProvisioningWeightedValidator(
  client: Client,
  input: {
    walletConfig: WalletConfig;
  },
) {
  return createWeightedECDSAValidator(client, {
    config: getWeightedValidatorConfig(input.walletConfig),
    signers: input.walletConfig.regularValidator.signers.map((signer) =>
      createProvisioningOnlySigner(signer.address as Address),
    ),
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_1,
  });
}

export async function createRuntimeWeightedValidator(
  client: Client,
  input: {
    walletId: string;
    walletAddress: Address;
    walletConfig: WalletConfig;
    backendBaseUrl: string;
    agentPrivateKey: Hex;
  },
) {
  const agentSigner = privateKeyToAccount(input.agentPrivateKey);
  const expectedAgentSigner = input.walletConfig.regularValidator.signers.find(
    (signer) => signer.role === "agent",
  );
  const expectedBackendSigner =
    input.walletConfig.regularValidator.signers.find(
      (signer) => signer.role === "backend",
    );

  if (!expectedAgentSigner || !expectedBackendSigner) {
    throw new Error(
      "Weighted validator config must include agent and backend signers.",
    );
  }

  if (
    agentSigner.address.toLowerCase() !==
    expectedAgentSigner.address.toLowerCase()
  ) {
    throw new Error(
      "Agent private key does not match the wallet weighted validator config.",
    );
  }

  const backendRemoteSigner = createBackendRemoteSigner({
    backendBaseUrl: input.backendBaseUrl,
    walletId: input.walletId,
    walletAddress: input.walletAddress,
    backendSignerAddress: expectedBackendSigner.address as Address,
    agentSigner,
  });

  return {
    agentSigner,
    backendRemoteSigner,
    weightedValidator: await createWeightedECDSAValidator(client, {
      config: getWeightedValidatorConfig(input.walletConfig),
      signers: [agentSigner, backendRemoteSigner],
      entryPoint: getEntryPoint("0.7"),
      kernelVersion: KERNEL_V3_1,
    }),
  };
}

export async function createWeightedKernelRuntime(input: {
  chain: Chain;
  walletId: string;
  walletAddress: Address;
  walletConfig: WalletConfig;
  ownerPublicArtifacts?: OwnerPublicArtifacts;
  regularValidatorInitArtifact?: RegularValidatorInitArtifact;
  backendBaseUrl: string;
  agentPrivateKey: Hex;
  rpcUrl: string;
  bundlerUrl: string;
}) {
  const publicClient = createPublicClient({
    chain: input.chain,
    transport: http(input.rpcUrl),
  });

  const { backendRemoteSigner, kernelPluginManager } =
    await createRuntimeKernelPluginManager(publicClient, {
      chain: input.chain,
      walletId: input.walletId,
      walletAddress: input.walletAddress,
      walletConfig: input.walletConfig,
      ownerPublicArtifacts: input.ownerPublicArtifacts,
      regularValidatorInitArtifact: input.regularValidatorInitArtifact,
      backendBaseUrl: input.backendBaseUrl,
      agentPrivateKey: input.agentPrivateKey,
    });

  const kernelAccount = await createKernelAccount(publicClient, {
    address: input.walletAddress,
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_1,
    plugins: kernelPluginManager,
  });

  return {
    publicClient,
    kernelAccount,
    backendRemoteSigner,
    kernelClient: createKernelAccountClient({
      account: kernelAccount,
      chain: input.chain,
      bundlerTransport: http(input.bundlerUrl),
      client: publicClient,
      userOperation: {
        estimateFeesPerGas: async () => estimateFeesPerGas(publicClient),
        prepareUserOperation: async (client, args) => {
          let normalizedArgs = args;
          const clientAccount = client.account as
            | {
                authorization?: unknown;
                eip7702Authorization?: () => Promise<unknown>;
              }
            | undefined;

          if (clientAccount?.authorization) {
            const authorization =
              args.authorization ??
              (await clientAccount.eip7702Authorization?.());
            normalizedArgs = {
              ...args,
              authorization,
            };
          }

          const userOperation = await prepareUserOperation(
            client,
            normalizedArgs,
          );
          backendRemoteSigner.attachPreparedUserOperation(
            normalizePackedUserOperation(
              toPackedUserOperation(userOperation as never),
            ),
          );
          return userOperation;
        },
      },
    }),
  };
}
