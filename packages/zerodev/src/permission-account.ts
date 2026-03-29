import {
  decodeParamsFromInitCode,
  toPermissionValidator,
  type PermissionAccountParams,
  type Policy,
  type ModularSigner,
} from "@zerodev/permissions";
import {
  toCallPolicy,
  toGasPolicy,
  toRateLimitPolicy,
  toSignatureCallerPolicy,
  toSudoPolicy,
  toTimestampPolicy,
} from "@zerodev/permissions/policies";
import { toECDSASigner } from "@zerodev/permissions/signers";
import type { KernelSmartAccountImplementation } from "@zerodev/sdk";
import { createKernelAccount, toKernelPluginManager } from "@zerodev/sdk/accounts";
import type {
  EntryPointType,
  GetKernelVersion,
} from "@zerodev/sdk/types";
import type { EntryPointVersion } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import {
  isAgentOutgoingBudgetPolicyParams,
  toAgentOutgoingBudgetPolicy,
} from "./agent-outgoing-budget-policy.js";

function deserializePermissionAccountParams(params: string) {
  return JSON.parse(
    Buffer.from(params, "base64").toString("utf8"),
  ) as PermissionAccountParams;
}

export async function createPolicyFromParams(policy: Policy) {
  const customPolicyParams = policy.policyParams as unknown;

  if (isAgentOutgoingBudgetPolicyParams(customPolicyParams)) {
    return toAgentOutgoingBudgetPolicy({
      policyAddress: customPolicyParams.policyAddress,
      tokenAddress: customPolicyParams.tokenAddress,
      limitBaseUnits: customPolicyParams.limitBaseUnits,
      period: customPolicyParams.period,
      allowedFlows: customPolicyParams.allowedFlows,
      allowedCounterparties: customPolicyParams.allowedCounterparties,
      policyFlag: customPolicyParams.policyFlag,
    });
  }

  switch (policy.policyParams.type) {
    case "call":
      return toCallPolicy(policy.policyParams);
    case "gas":
      return toGasPolicy(policy.policyParams);
    case "rate-limit":
      return toRateLimitPolicy(policy.policyParams);
    case "signature-caller":
      return toSignatureCallerPolicy(policy.policyParams);
    case "sudo":
      return toSudoPolicy(policy.policyParams);
    case "timestamp":
      return toTimestampPolicy(policy.policyParams);
    default:
      throw new Error(`Unsupported policy type ${(policy as { policyParams: { type: string } }).policyParams.type}`);
  }
}

export async function deserializePermissionAccount<
  entryPointVersion extends EntryPointVersion,
>(
  client: KernelSmartAccountImplementation["client"],
  entryPoint: EntryPointType<entryPointVersion>,
  kernelVersion: GetKernelVersion<entryPointVersion>,
  serializedPermissionAccount: string,
  modularSigner?: ModularSigner,
) {
  if (entryPoint.version !== "0.7") {
    throw new Error("Only EntryPoint 0.7 is supported");
  }

  const params = deserializePermissionAccountParams(
    serializedPermissionAccount,
  );

  let signer: ModularSigner;

  if (params.privateKey) {
    signer = await toECDSASigner({
      signer: privateKeyToAccount(params.privateKey),
    });
  } else if (modularSigner) {
    signer = modularSigner;
  } else {
    throw new Error("No signer or serialized sessionKey provided");
  }

  const permissionPlugin = await toPermissionValidator(client, {
    signer,
    policies: await Promise.all(
      params.permissionParams.policies?.map((policy: Policy) =>
        createPolicyFromParams(policy),
      ) ?? [],
    ),
    entryPoint,
    kernelVersion,
    permissionId: params.permissionParams.permissionId,
  });

  const { index, validatorInitData, useMetaFactory } = decodeParamsFromInitCode(
    params.accountParams.initCode,
    kernelVersion,
  );

  const kernelPluginManager = await toKernelPluginManager(client, {
    regular: permissionPlugin,
    pluginEnableSignature: params.isPreInstalled
      ? undefined
      : params.enableSignature,
    validatorInitData,
    action: params.action,
    entryPoint,
    kernelVersion,
    isPreInstalled: params.isPreInstalled,
    ...params.validityData,
  });

  return createKernelAccount(client, {
    entryPoint,
    kernelVersion,
    plugins: kernelPluginManager,
    index,
    address: params.accountParams.accountAddress,
    useMetaFactory,
    eip7702Auth: params.eip7702Auth,
  });
}
