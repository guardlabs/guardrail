import {
  getSupportedChainById,
  type BackendPackedUserOperation,
  type BackendSignerTypedDataPayload,
  type BackendSingleCallOperation,
  type BackendUserOperationSignaturePayload,
} from "@conduit/shared";
import {
  decodeFunctionData,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import type {
  RuntimePolicyConsumption,
  RuntimePolicyState,
} from "./repository.js";
import type { StoredWalletRequest } from "./repository.js";

const WEIGHTED_VALIDATOR_DOMAIN_NAME = "WeightedECDSAValidator";
const WEIGHTED_VALIDATOR_DOMAIN_VERSION = "0.0.3";
const OFFICIAL_USDC_EIP712_DOMAIN_NAME = "USDC";
const OFFICIAL_USDC_EIP712_DOMAIN_VERSION = "2";
const kernelExecuteAbi = parseAbi([
  "function execute(bytes32 execMode, bytes executionCalldata)",
]);

const usdcAbi = parseAbi([
  "function transfer(address to, uint256 value)",
  "function approve(address spender, uint256 value)",
  "function increaseAllowance(address spender, uint256 addedValue)",
]);

type PolicyDecision =
  | {
      ok: true;
      consumption?: {
        asset: RuntimePolicyConsumption["asset"];
        operation: string;
        amountMinor: string;
      };
    }
  | { ok: false; statusCode: number; error: string; message: string };

function deny(
  statusCode: number,
  error: string,
  message: string,
): PolicyDecision {
  return {
    ok: false,
    statusCode,
    error,
    message,
  };
}

function parseNumericString(value: unknown, label: string) {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }

  throw new Error(`${label} must be an unsigned integer.`);
}

function createConsumptionLowerBound(
  period: "daily" | "weekly" | "monthly",
  now: Date,
) {
  const durationMs =
    period === "monthly"
      ? 30 * 24 * 60 * 60 * 1000
      : period === "weekly"
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

  return new Date(now.getTime() - durationMs);
}

function consumeUsdcBudget(input: {
  request: StoredWalletRequest;
  recentConsumptions: RuntimePolicyConsumption[];
  operation: string;
  amountMinor: bigint;
  now: Date;
}): PolicyDecision {
  const usdcPolicy = input.request.policy.usdcPolicy;

  if (!usdcPolicy) {
    return deny(
      403,
      "usdc_policy_missing",
      "No USDC policy is configured for this wallet.",
    );
  }

  const lowerBound = createConsumptionLowerBound(usdcPolicy.period, input.now);
  const consumedAmount = input.recentConsumptions.reduce(
    (total, consumption) => {
      if (new Date(consumption.createdAt).getTime() < lowerBound.getTime()) {
        return total;
      }

      return total + BigInt(consumption.amountMinor);
    },
    0n,
  );
  const nextConsumedAmount = consumedAmount + input.amountMinor;

  if (nextConsumedAmount > BigInt(usdcPolicy.maxAmountMinor)) {
    return deny(
      403,
      "usdc_budget_exceeded",
      "The configured USDC budget has been exceeded.",
    );
  }

  return {
    ok: true,
    consumption: {
      asset: "usdc",
      operation: input.operation,
      amountMinor: input.amountMinor.toString(),
    },
  };
}

function computePackedUserOperationHash(
  userOperation: BackendPackedUserOperation,
  chainId: number,
) {
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
      userOperation.sender as `0x${string}`,
      BigInt(userOperation.nonce),
      keccak256(userOperation.initCode as Hex),
      keccak256(userOperation.callData as Hex),
      userOperation.accountGasLimits as Hex,
      BigInt(userOperation.preVerificationGas),
      userOperation.gasFees as Hex,
      keccak256(userOperation.paymasterAndData as Hex),
    ],
  );

  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [keccak256(packedUserOp), entryPoint07Address, BigInt(chainId)],
    ),
  );
}

function computeCallDataAndNonceHash(
  userOperation: BackendPackedUserOperation,
) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "uint256" }],
      [
        userOperation.sender as `0x${string}`,
        userOperation.callData as Hex,
        BigInt(userOperation.nonce),
      ],
    ),
  );
}

function verifyUserOperationSignaturePayload(input: {
  request: StoredWalletRequest;
  userOperation: BackendPackedUserOperation;
  signaturePayload: BackendUserOperationSignaturePayload;
}): PolicyDecision {
  if (
    !input.request.walletContext ||
    !input.request.regularValidatorInitArtifact
  ) {
    return deny(
      409,
      "wallet_not_ready",
      "Wallet is not ready for backend signing.",
    );
  }

  if (input.signaturePayload.kind === "user_operation_hash") {
    const expectedHash = computePackedUserOperationHash(
      input.userOperation,
      input.request.walletContext.chainId,
    );

    if (
      input.signaturePayload.message.raw.toLowerCase() !==
      expectedHash.toLowerCase()
    ) {
      return deny(
        400,
        "user_operation_hash_mismatch",
        "The provided user-operation hash does not match the packed user operation.",
      );
    }

    return { ok: true };
  }

  const typedData = input.signaturePayload.typedData;
  const expectedHash = computeCallDataAndNonceHash(input.userOperation);

  if (
    typedData.primaryType !== "Approve" ||
    typedData.domain.name !== WEIGHTED_VALIDATOR_DOMAIN_NAME ||
    typedData.domain.version !== WEIGHTED_VALIDATOR_DOMAIN_VERSION ||
    Number(typedData.domain.chainId) !== input.request.walletContext.chainId ||
    typedData.domain.verifyingContract !==
      input.request.regularValidatorInitArtifact.validatorAddress ||
    typedData.message.callDataAndNonceHash !== expectedHash
  ) {
    return deny(
      400,
      "user_operation_signature_payload_mismatch",
      "The weighted validator approval payload does not match the prepared user operation.",
    );
  }

  return { ok: true };
}

function decodeKernelSingleCall(callData: Hex) {
  const decoded = decodeFunctionData({
    abi: kernelExecuteAbi,
    data: callData,
  });

  if (decoded.functionName !== "execute") {
    throw new Error("Only Kernel single-call execute payloads are supported.");
  }

  const [execMode, executionCalldata] = decoded.args;
  const normalizedExecMode = String(execMode).toLowerCase();

  if (!normalizedExecMode.startsWith("0x0000")) {
    throw new Error("Only Kernel single-call execute payloads are supported.");
  }

  const payload = String(executionCalldata).slice(2);

  if (payload.length < 104) {
    throw new Error("Kernel single-call payload is malformed.");
  }

  return {
    to: `0x${payload.slice(0, 40)}` as `0x${string}`,
    value: BigInt(`0x${payload.slice(40, 104) || "0"}`).toString(),
    data: `0x${payload.slice(104)}` as `0x${string}`,
  };
}

function enforceGenericContractAllowlist(input: {
  request: StoredWalletRequest;
  operation: BackendSingleCallOperation;
  officialUsdcAddress: `0x${string}`;
}): PolicyDecision {
  if (
    input.operation.to.toLowerCase() === input.officialUsdcAddress.toLowerCase()
  ) {
    return deny(
      403,
      "usdc_contract_forbidden_in_contract_allowlist",
      "Official USDC must be authorized through usdcPolicy, not the generic contract allowlist.",
    );
  }

  if (input.operation.value !== "0") {
    return deny(
      403,
      "native_value_not_allowed",
      "Native value transfers are not allowed.",
    );
  }

  const allowlistEntry = input.request.policy.contractAllowlist?.find(
    (entry) =>
      entry.contractAddress.toLowerCase() === input.operation.to.toLowerCase(),
  );

  if (!allowlistEntry) {
    return deny(
      403,
      "contract_not_allowed",
      "This contract is not in the runtime allowlist.",
    );
  }

  const selector = input.operation.data.slice(0, 10).toLowerCase();

  if (
    !allowlistEntry.allowedSelectors.some(
      (allowed) => allowed.toLowerCase() === selector,
    )
  ) {
    return deny(
      403,
      "method_not_allowed",
      "This method selector is not in the runtime allowlist for the target contract.",
    );
  }

  return { ok: true };
}

function enforceUsdcTransactionPolicy(input: {
  request: StoredWalletRequest;
  recentConsumptions: RuntimePolicyConsumption[];
  operation: BackendSingleCallOperation;
  now: Date;
}): PolicyDecision {
  const usdcPolicy = input.request.policy.usdcPolicy;

  if (!usdcPolicy) {
    return deny(
      403,
      "usdc_policy_missing",
      "No USDC policy is configured for this wallet.",
    );
  }

  let decoded:
    | { functionName: "transfer"; amountMinor: bigint }
    | { functionName: "approve"; amountMinor: bigint }
    | { functionName: "increaseAllowance"; amountMinor: bigint };

  try {
    const parsed = decodeFunctionData({
      abi: usdcAbi,
      data: input.operation.data as Hex,
    });

    if (parsed.functionName === "transfer") {
      decoded = {
        functionName: "transfer",
        amountMinor: parsed.args[1] as bigint,
      };
    } else if (parsed.functionName === "approve") {
      decoded = {
        functionName: "approve",
        amountMinor: parsed.args[1] as bigint,
      };
    } else if (parsed.functionName === "increaseAllowance") {
      decoded = {
        functionName: "increaseAllowance",
        amountMinor: parsed.args[1] as bigint,
      };
    } else {
      return deny(
        403,
        "usdc_operation_not_allowed",
        "This USDC method is not supported.",
      );
    }
  } catch {
    return deny(
      403,
      "usdc_operation_not_allowed",
      "This USDC method is not supported.",
    );
  }

  if (!usdcPolicy.allowedOperations.includes(decoded.functionName)) {
    return deny(
      403,
      "usdc_operation_not_allowed",
      `USDC operation ${decoded.functionName} is not allowed by this wallet policy.`,
    );
  }

  return consumeUsdcBudget({
    request: input.request,
    recentConsumptions: input.recentConsumptions,
    operation: decoded.functionName,
    amountMinor: decoded.amountMinor,
    now: input.now,
  });
}

function enforceUsdcTypedDataPolicy(input: {
  request: StoredWalletRequest;
  recentConsumptions: RuntimePolicyConsumption[];
  typedData: BackendSignerTypedDataPayload;
  now: Date;
}): PolicyDecision {
  if (!input.request.walletContext) {
    return deny(
      409,
      "wallet_not_ready",
      "Wallet is not ready for backend signing.",
    );
  }

  const supportedChain = getSupportedChainById(
    input.request.walletContext.chainId,
  );

  if (!supportedChain) {
    return deny(
      400,
      "unsupported_chain",
      "This wallet chain is not supported.",
    );
  }

  if (
    input.typedData.domain.name !== OFFICIAL_USDC_EIP712_DOMAIN_NAME ||
    input.typedData.domain.version !== OFFICIAL_USDC_EIP712_DOMAIN_VERSION ||
    Number(input.typedData.domain.chainId) !==
      input.request.walletContext.chainId ||
    String(input.typedData.domain.verifyingContract).toLowerCase() !==
      supportedChain.officialUsdcAddress.toLowerCase()
  ) {
    return deny(
      403,
      "typed_data_not_usdc_official",
      "Only official USDC typed data are supported by the backend policy.",
    );
  }

  const usdcPolicy = input.request.policy.usdcPolicy;

  if (!usdcPolicy) {
    return deny(
      403,
      "usdc_policy_missing",
      "No USDC policy is configured for this wallet.",
    );
  }

  if (input.typedData.primaryType === "Permit") {
    if (!usdcPolicy.allowedOperations.includes("permit")) {
      return deny(
        403,
        "usdc_operation_not_allowed",
        "USDC permit is not allowed.",
      );
    }

    const amountMinor = parseNumericString(
      input.typedData.message.value,
      "Permit value",
    );
    return consumeUsdcBudget({
      request: input.request,
      recentConsumptions: input.recentConsumptions,
      operation: "permit",
      amountMinor,
      now: input.now,
    });
  }

  if (input.typedData.primaryType === "TransferWithAuthorization") {
    if (!usdcPolicy.allowedOperations.includes("transferWithAuthorization")) {
      return deny(
        403,
        "usdc_operation_not_allowed",
        "USDC transferWithAuthorization is not allowed.",
      );
    }

    if (
      String(input.typedData.message.from).toLowerCase() !==
      input.request.walletContext.walletAddress.toLowerCase()
    ) {
      return deny(
        403,
        "typed_data_source_not_wallet",
        "USDC typed data must authorize a transfer from the smart wallet itself.",
      );
    }

    const amountMinor = parseNumericString(
      input.typedData.message.value,
      "TransferWithAuthorization value",
    );
    return consumeUsdcBudget({
      request: input.request,
      recentConsumptions: input.recentConsumptions,
      operation: "transferWithAuthorization",
      amountMinor,
      now: input.now,
    });
  }

  return deny(
    403,
    "typed_data_not_supported",
    "Typed data are denied by default unless they match an explicitly supported USDC flow.",
  );
}

export function createInitialRuntimePolicyState(): RuntimePolicyState {
  return {
    usdc: null,
  };
}

export function evaluateTypedDataPolicy(input: {
  request: StoredWalletRequest;
  recentUsdcConsumptions: RuntimePolicyConsumption[];
  typedData: BackendSignerTypedDataPayload;
  signaturePayload: {
    kind: "kernel_wrapped_typed_data";
    typedData: BackendSignerTypedDataPayload;
  };
  now: Date;
}): PolicyDecision {
  if (!input.request.walletContext) {
    return deny(
      409,
      "wallet_not_ready",
      "Wallet is not ready for backend signing.",
    );
  }

  const wrappedTypedData = input.signaturePayload.typedData;

  if (
    wrappedTypedData.primaryType !== "Kernel" ||
    Number(wrappedTypedData.domain.chainId) !==
      input.request.walletContext.chainId ||
    String(wrappedTypedData.domain.verifyingContract).toLowerCase() !==
      input.request.walletContext.walletAddress.toLowerCase()
  ) {
    return deny(
      400,
      "typed_data_signature_payload_mismatch",
      "The wrapped kernel typed-data payload does not match the ready wallet context.",
    );
  }

  const expectedHash = hashTypedData(input.typedData as never);

  if (
    String(wrappedTypedData.message.hash).toLowerCase() !==
    expectedHash.toLowerCase()
  ) {
    return deny(
      400,
      "typed_data_signature_payload_mismatch",
      "The wrapped kernel typed-data payload does not match the original typed data hash.",
    );
  }

  return enforceUsdcTypedDataPolicy({
    request: input.request,
    recentConsumptions: input.recentUsdcConsumptions,
    typedData: input.typedData,
    now: input.now,
  });
}

export function evaluateUserOperationPolicy(input: {
  request: StoredWalletRequest;
  recentUsdcConsumptions: RuntimePolicyConsumption[];
  operation: BackendSingleCallOperation;
  userOperation: BackendPackedUserOperation;
  signaturePayload: BackendUserOperationSignaturePayload;
  now: Date;
}): PolicyDecision {
  if (!input.request.walletContext) {
    return deny(
      409,
      "wallet_not_ready",
      "Wallet is not ready for backend signing.",
    );
  }

  const supportedChain = getSupportedChainById(
    input.request.walletContext.chainId,
  );

  if (!supportedChain) {
    return deny(
      400,
      "unsupported_chain",
      "This wallet chain is not supported.",
    );
  }

  if (
    input.userOperation.sender.toLowerCase() !==
    input.request.walletContext.walletAddress.toLowerCase()
  ) {
    return deny(
      400,
      "wallet_address_mismatch",
      "The user operation sender does not match the ready wallet address.",
    );
  }

  if (input.userOperation.initCode !== "0x") {
    return deny(
      403,
      "user_operation_initcode_not_allowed",
      "Runtime single-call signing does not allow initCode. Deploy the wallet first.",
    );
  }

  const signaturePayloadCheck = verifyUserOperationSignaturePayload(input);

  if (!signaturePayloadCheck.ok) {
    return signaturePayloadCheck;
  }

  let decodedCall: { to: `0x${string}`; value: string; data: `0x${string}` };

  try {
    decodedCall = decodeKernelSingleCall(input.userOperation.callData as Hex);
  } catch (error) {
    return deny(
      400,
      "user_operation_call_mismatch",
      error instanceof Error
        ? error.message
        : "Could not decode the kernel single-call payload.",
    );
  }

  if (
    decodedCall.to.toLowerCase() !== input.operation.to.toLowerCase() ||
    decodedCall.value !== input.operation.value ||
    decodedCall.data.toLowerCase() !== input.operation.data.toLowerCase()
  ) {
    return deny(
      400,
      "user_operation_call_mismatch",
      "The declared operation does not match the prepared kernel single-call payload.",
    );
  }

  if (
    input.operation.to.toLowerCase() ===
    supportedChain.officialUsdcAddress.toLowerCase()
  ) {
    return enforceUsdcTransactionPolicy({
      request: input.request,
      recentConsumptions: input.recentUsdcConsumptions,
      operation: input.operation,
      now: input.now,
    });
  }

  return enforceGenericContractAllowlist({
    request: input.request,
    operation: input.operation,
    officialUsdcAddress: supportedChain.officialUsdcAddress as `0x${string}`,
  });
}

export function evaluateDeployWalletPolicy(input: {
  request: StoredWalletRequest;
  userOperation: BackendPackedUserOperation;
  signaturePayload: BackendUserOperationSignaturePayload;
}): PolicyDecision {
  if (!input.request.walletContext) {
    return deny(
      409,
      "wallet_not_ready",
      "Wallet is not ready for backend signing.",
    );
  }

  if (input.request.deployment.status === "deployed") {
    return deny(
      409,
      "deploy_already_completed",
      "The wallet is already deployed.",
    );
  }

  if (
    input.userOperation.sender.toLowerCase() !==
    input.request.walletContext.walletAddress.toLowerCase()
  ) {
    return deny(
      400,
      "wallet_address_mismatch",
      "The user operation sender does not match the ready wallet address.",
    );
  }

  if (input.userOperation.initCode === "0x") {
    return deny(
      403,
      "deploy_not_allowed",
      "Wallet deployment requires initCode.",
    );
  }

  const signaturePayloadCheck = verifyUserOperationSignaturePayload(input);

  if (!signaturePayloadCheck.ok) {
    return signaturePayloadCheck;
  }

  let decodedCall: { to: `0x${string}`; value: string; data: `0x${string}` };

  try {
    decodedCall = decodeKernelSingleCall(input.userOperation.callData as Hex);
  } catch (error) {
    return deny(
      400,
      "deploy_not_allowed",
      error instanceof Error
        ? error.message
        : "Could not decode the kernel deployment payload.",
    );
  }

  if (
    decodedCall.to.toLowerCase() !== input.request.agentAddress.toLowerCase() ||
    decodedCall.value !== "0" ||
    decodedCall.data.toLowerCase() !== "0x"
  ) {
    return deny(
      403,
      "deploy_not_allowed",
      "The deployment route only allows the canonical zero-value call to the agent address.",
    );
  }

  return { ok: true };
}

export function getRuntimePolicyConsumptionWindowStart(
  period: "daily" | "weekly" | "monthly",
  now: Date,
) {
  return createConsumptionLowerBound(period, now);
}
