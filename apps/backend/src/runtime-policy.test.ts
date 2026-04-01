import { describe, expect, it } from "vitest";
import { buildDefaultWalletConfig } from "@conduit/shared";
import { entryPoint07Address } from "viem/account-abstraction";
import {
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import {
  createInitialRuntimePolicyState,
  evaluateTypedDataPolicy,
  evaluateUserOperationPolicy,
} from "./runtime-policy.js";
import type { StoredWalletRequest } from "./repository.js";

const kernelExecuteAbi = parseAbi([
  "function execute(bytes32 execMode, bytes executionCalldata)",
]);

function buildStoredWalletRequest(
  overrides: Partial<StoredWalletRequest> = {},
): StoredWalletRequest {
  const walletConfig = buildDefaultWalletConfig({
    chainId: 84532,
    agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
    backendAddress: "0x1111111111111111111111111111111111111111",
  });

  return {
    walletMode: "kernel_weighted_multisig_v1",
    walletId: "wal_123",
    status: "ready",
    walletConfig,
    policy: {
      contractAllowlist: [
        {
          contractAddress: "0x4444444444444444444444444444444444444444",
          allowedSelectors: ["0xa9059cbb"],
        },
      ],
      usdcPolicy: {
        period: "daily",
        maxAmountMinor: "1500000",
        allowedOperations: [
          "transfer",
          "approve",
          "increaseAllowance",
          "permit",
          "transferWithAuthorization",
        ],
      },
    },
    agentAddress: walletConfig.regularValidator.signers[0]!.address,
    backendAddress: walletConfig.regularValidator.signers[1]!.address,
    ownerPublicArtifacts: {
      credentialId: "credential-id",
      publicKey: "0x1234",
    },
    regularValidatorInitArtifact: {
      validatorAddress: "0x3333333333333333333333333333333333333333",
      enableData: "0x1234",
      pluginEnableSignature: "0x5678",
    },
    counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
    funding: {
      status: "verified",
      minimumRequiredWei: "500000000000000",
      balanceWei: "700000000000000",
      checkedAt: "2026-03-29T12:05:00.000Z",
    },
    deployment: {
      status: "undeployed",
    },
    walletContext: {
      walletAddress: "0x2222222222222222222222222222222222222222",
      chainId: 84532,
      kernelVersion: "3.1",
      entryPointVersion: "0.7",
      owner: {
        credentialId: "credential-id",
        publicKey: "0x1234",
      },
      agentAddress: walletConfig.regularValidator.signers[0]!.address,
      backendAddress: walletConfig.regularValidator.signers[1]!.address,
      weightedValidator: walletConfig.regularValidator,
    },
    provisioningTokenHash: "token-hash",
    backendPrivateKey: "0x1234",
    runtimePolicyState: createInitialRuntimePolicyState(),
    createdAt: "2026-03-29T12:00:00.000Z",
    updatedAt: "2026-03-29T12:05:00.000Z",
    expiresAt: "2026-03-30T12:00:00.000Z",
    ...overrides,
  };
}

function buildKernelSingleCallData(input: {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}) {
  const executionCalldata = `0x${input.to.slice(2)}${input.value
    .toString(16)
    .padStart(64, "0")}${input.data.slice(2)}` as Hex;

  return encodeFunctionData({
    abi: kernelExecuteAbi,
    functionName: "execute",
    args: [
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      executionCalldata,
    ],
  });
}

function computePackedUserOperationHash(input: {
  sender: `0x${string}`;
  nonce: string;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: string;
  gasFees: Hex;
  paymasterAndData: Hex;
}) {
  const packedUserOp = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [
      input.sender,
      BigInt(input.nonce),
      keccak256(input.initCode),
      keccak256(input.callData),
      input.accountGasLimits,
      BigInt(input.preVerificationGas),
      input.gasFees,
      keccak256(input.paymasterAndData),
    ],
  );

  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [keccak256(packedUserOp), entryPoint07Address, 84532n],
    ),
  );
}

function buildKernelWrappedTypedData(input: {
  walletAddress: `0x${string}`;
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}) {
  return {
    kind: "kernel_wrapped_typed_data" as const,
    typedData: {
      domain: {
        name: "Kernel",
        version: "0.3.1",
        chainId: 84532,
        verifyingContract: input.walletAddress,
      },
      types: {
        Kernel: [{ name: "hash", type: "bytes32" }],
      },
      primaryType: "Kernel",
      message: {
        hash: hashTypedData(input.typedData as never),
      },
    },
  };
}

describe("runtime policy", () => {
  it("allows an explicitly allowlisted non-USDC single call", () => {
    const request = buildStoredWalletRequest();
    const operation = {
      kind: "single_call" as const,
      to: "0x4444444444444444444444444444444444444444" as `0x${string}`,
      value: "0",
      data: "0xa9059cbb" as `0x${string}`,
    };
    const userOperation = {
      sender: request.walletContext!.walletAddress as `0x${string}`,
      nonce: "1",
      initCode: "0x" as Hex,
      callData: buildKernelSingleCallData({
        to: operation.to,
        value: 0n,
        data: operation.data,
      }),
      accountGasLimits:
        "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      preVerificationGas: "1",
      gasFees:
        "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      paymasterAndData: "0x" as Hex,
    };

    const decision = evaluateUserOperationPolicy({
      request,
      recentUsdcConsumptions: [],
      operation,
      userOperation,
      signaturePayload: {
        kind: "user_operation_hash",
        message: {
          kind: "raw",
          raw: computePackedUserOperationHash(userOperation),
        },
      },
      now: new Date("2026-03-31T10:00:00.000Z"),
    });

    expect(decision).toEqual({
      ok: true,
    });
  });

  it("rejects non-USDC single calls that try to send native value", () => {
    const request = buildStoredWalletRequest();
    const operation = {
      kind: "single_call" as const,
      to: "0x4444444444444444444444444444444444444444" as `0x${string}`,
      value: "1",
      data: "0xa9059cbb" as `0x${string}`,
    };
    const userOperation = {
      sender: request.walletContext!.walletAddress as `0x${string}`,
      nonce: "1",
      initCode: "0x" as Hex,
      callData: buildKernelSingleCallData({
        to: operation.to,
        value: 1n,
        data: operation.data,
      }),
      accountGasLimits:
        "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      preVerificationGas: "1",
      gasFees:
        "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      paymasterAndData: "0x" as Hex,
    };

    const decision = evaluateUserOperationPolicy({
      request,
      recentUsdcConsumptions: [],
      operation,
      userOperation,
      signaturePayload: {
        kind: "user_operation_hash",
        message: {
          kind: "raw",
          raw: computePackedUserOperationHash(userOperation),
        },
      },
      now: new Date("2026-03-31T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      ok: false,
      error: "native_value_not_allowed",
    });
  });

  it("consumes the USDC budget immediately for Permit and rejects over-budget signatures", () => {
    const request = buildStoredWalletRequest();
    const firstTypedData = {
      domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      },
      primaryType: "Permit",
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      message: {
        owner: request.walletContext!.walletAddress,
        spender: "0x3333333333333333333333333333333333333333",
        value: "1000000",
        nonce: "0",
        deadline: "1893456000",
      },
    };
    const firstDecision = evaluateTypedDataPolicy({
      request,
      recentUsdcConsumptions: [],
      typedData: firstTypedData,
      signaturePayload: buildKernelWrappedTypedData({
        walletAddress: request.walletContext!.walletAddress as `0x${string}`,
        typedData: firstTypedData,
      }),
      now: new Date("2026-03-31T10:00:00.000Z"),
    });

    expect(firstDecision).toMatchObject({
      ok: true,
      consumption: {
        asset: "usdc",
        operation: "permit",
        amountMinor: "1000000",
      },
    });

    const secondTypedData = {
      domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      },
      primaryType: "TransferWithAuthorization",
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      message: {
        from: request.walletContext!.walletAddress,
        to: "0x3333333333333333333333333333333333333333",
        value: "600000",
        validAfter: "0",
        validBefore: "1893456000",
        nonce:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    };
    const secondDecision = evaluateTypedDataPolicy({
      request: buildStoredWalletRequest(),
      recentUsdcConsumptions:
        firstDecision.ok && firstDecision.consumption
          ? [
              {
                walletId: "wal_123",
                requestId: "req_1",
                asset: "usdc",
                operation: firstDecision.consumption.operation,
                amountMinor: firstDecision.consumption.amountMinor,
                createdAt: "2026-03-31T10:00:00.000Z",
              },
            ]
          : [],
      typedData: secondTypedData,
      signaturePayload: buildKernelWrappedTypedData({
        walletAddress: request.walletContext!.walletAddress as `0x${string}`,
        typedData: secondTypedData,
      }),
      now: new Date("2026-03-31T10:05:00.000Z"),
    });

    expect(secondDecision).toMatchObject({
      ok: false,
      error: "usdc_budget_exceeded",
    });
  });

  it("drops USDC consumption exactly when it leaves the 24h sliding window", () => {
    const request = buildStoredWalletRequest({
      policy: {
        ...buildStoredWalletRequest().policy,
        usdcPolicy: {
          period: "daily",
          maxAmountMinor: "1500000",
          allowedOperations: ["permit"],
        },
      },
    });
    const typedData = {
      domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      },
      primaryType: "Permit",
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      message: {
        owner: request.walletContext!.walletAddress,
        spender: "0x3333333333333333333333333333333333333333",
        value: "1000000",
        nonce: "0",
        deadline: "1893456000",
      },
    };

    const decision = evaluateTypedDataPolicy({
      request,
      recentUsdcConsumptions: [
        {
          walletId: "wal_123",
          requestId: "req_old",
          asset: "usdc",
          operation: "permit",
          amountMinor: "1000000",
          createdAt: "2026-03-30T09:59:59.000Z",
        },
      ],
      typedData,
      signaturePayload: buildKernelWrappedTypedData({
        walletAddress: request.walletContext!.walletAddress as `0x${string}`,
        typedData,
      }),
      now: new Date("2026-03-31T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      ok: true,
      consumption: {
        operation: "permit",
        amountMinor: "1000000",
      },
    });
  });
});
