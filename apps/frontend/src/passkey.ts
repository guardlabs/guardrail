import {
  ERC20_APPROVE_SELECTOR,
  ERC20_TRANSFER_SELECTOR,
  getOutgoingBudgetScopeValidationErrors,
  getSupportedChainById,
  type OutgoingBudget,
  type PermissionScope,
} from "@agent-wallet/shared";
import { toAgentOutgoingBudgetPolicy } from "@agent-wallet/zerodev";
import {
  PasskeyValidatorContractVersion,
  toPasskeyValidator,
} from "@zerodev/passkey-validator";
import {
  type Policy,
  serializePermissionAccount,
  toPermissionValidator,
} from "@zerodev/permissions";
import {
  toEmptyECDSASigner,
  toWebAuthnKey,
  WebAuthnMode,
} from "@zerodev/permissions/signers";
import {
  CallPolicyVersion,
  toCallPolicy,
} from "@zerodev/permissions/policies";
import { createKernelAccount } from "@zerodev/sdk/accounts";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { encodeWebAuthnPubKey } from "@zerodev/webauthn-key";
import type { Address, Hex } from "viem";
import { createPublicClient, http } from "viem";
import { publicKeyToAddress } from "viem/accounts";

function getPublicRpcUrl(chainId: number) {
  const supportedChain = getSupportedChainById(chainId);

  if (!supportedChain) {
    return null;
  }

  switch (supportedChain.frontendRuntimeKey) {
    case "BASE_SEPOLIA":
      return __BASE_SEPOLIA_RPC_URL__ ?? __BASE_SEPOLIA_BUNDLER_URL__;
    default:
      return null;
  }
}

function getChain(chainId: number) {
  const supportedChain = getSupportedChainById(chainId);

  if (!supportedChain) {
    throw new Error(`Unsupported chain ${chainId} for frontend provisioning.`);
  }

  return supportedChain.viemChain;
}

function getOutgoingBudgetPolicyAddress(chainId: number): Address | null {
  const supportedChain = getSupportedChainById(chainId);

  if (!supportedChain) {
    return null;
  }

  switch (supportedChain.frontendRuntimeKey) {
    case "BASE_SEPOLIA":
      return __BASE_SEPOLIA_OUTGOING_BUDGET_POLICY_ADDRESS__ as Address | null;
    default:
      return null;
  }
}

function getOutgoingBudgetSelectors(outgoingBudget: OutgoingBudget) {
  if (outgoingBudget.type !== "erc20") {
    return [];
  }

  return outgoingBudget.allowedFlows.map((flow) =>
    flow === "transfer" ? ERC20_TRANSFER_SELECTOR : ERC20_APPROVE_SELECTOR,
  );
}

function buildPermissionPolicies(scope: PermissionScope) {
  const validationErrors = getOutgoingBudgetScopeValidationErrors(scope);

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join(" "));
  }

  const callPermissions = [
    ...(scope.contractPermissions ?? []).flatMap((permission) =>
      permission.allowedMethods.map((selector) => ({
        target: permission.targetContract as `0x${string}`,
        selector: selector as Hex,
        valueLimit: 0n,
      })),
    ),
    ...(scope.outgoingBudgets ?? []).flatMap((outgoingBudget) =>
      getOutgoingBudgetSelectors(outgoingBudget).map((selector) => ({
        target: outgoingBudget.tokenAddress as `0x${string}`,
        selector: selector as Hex,
        valueLimit: 0n,
      })),
    ),
  ];

  const policies: Policy[] = [
    toCallPolicy({
      policyVersion: CallPolicyVersion.V0_0_5,
      permissions: callPermissions,
    }),
  ];

  const outgoingBudget = scope.outgoingBudgets?.[0];

  if (!outgoingBudget) {
    return policies;
  }

  if (outgoingBudget.type !== "erc20") {
    throw new Error("Only ERC20 outgoing budgets are currently supported.");
  }

  const policyAddress = getOutgoingBudgetPolicyAddress(scope.chainId);

  if (!policyAddress) {
    throw new Error(
      `Missing AGENT_WALLET_OUTGOING_BUDGET_POLICY_ADDRESS_${scope.chainId} in frontend build.`,
    );
  }

  policies.push(
    toAgentOutgoingBudgetPolicy({
      policyAddress,
      tokenAddress: outgoingBudget.tokenAddress as Address,
      limitBaseUnits: outgoingBudget.limitBaseUnits,
      period: outgoingBudget.period,
      allowedFlows: outgoingBudget.allowedFlows,
      allowedCounterparties: outgoingBudget.allowedCounterparties as
        | Address[]
        | undefined,
    }),
  );

  return policies;
}

export type PasskeyClient = {
  createProvisioningArtifacts(input: {
    displayName: string;
    scope: PermissionScope;
    sessionPublicKey: string;
  }): Promise<{
    owner: { credentialId: string; publicKey: string };
    counterfactualWalletAddress: string;
    serializedPermissionAccount: string;
  }>;
};

export const browserPasskeyClient: PasskeyClient = {
  async createProvisioningArtifacts({
    displayName,
    scope,
    sessionPublicKey,
  }) {
    if (!__PASSKEY_SERVER_URL__) {
      throw new Error("Missing AGENT_WALLET_PASSKEY_SERVER_URL in frontend build.");
    }

    const rpcUrl = getPublicRpcUrl(scope.chainId);

    if (!rpcUrl) {
      throw new Error(`Missing public RPC URL for chain ${scope.chainId}.`);
    }

    const publicClient = createPublicClient({
      chain: getChain(scope.chainId),
      transport: http(rpcUrl),
    });

    const entryPoint = getEntryPoint("0.7");
    const webAuthnKey = await toWebAuthnKey({
      passkeyName: displayName,
      passkeyServerUrl: __PASSKEY_SERVER_URL__,
      mode: WebAuthnMode.Register,
      rpID: window.location.hostname,
      passkeyServerHeaders: {},
    });

    const passkeyValidator = await toPasskeyValidator(publicClient, {
      webAuthnKey,
      entryPoint,
      kernelVersion: KERNEL_V3_1,
      validatorContractVersion:
        PasskeyValidatorContractVersion.V0_0_2_UNPATCHED,
    });

    const sessionKeyAddress = publicKeyToAddress(sessionPublicKey as Hex);
    const emptySessionSigner = toEmptyECDSASigner(sessionKeyAddress);
    const permissionPlugin = await toPermissionValidator(publicClient, {
      entryPoint,
      kernelVersion: KERNEL_V3_1,
      signer: emptySessionSigner,
      policies: buildPermissionPolicies(scope),
    });

    const account = await createKernelAccount(publicClient, {
      entryPoint,
      kernelVersion: KERNEL_V3_1,
      plugins: {
        sudo: passkeyValidator,
        regular: permissionPlugin,
      },
    });

    const serializedPermissionAccount = await serializePermissionAccount(account);

    return {
      owner: {
        credentialId: webAuthnKey.authenticatorId,
        publicKey: encodeWebAuthnPubKey(webAuthnKey),
      },
      counterfactualWalletAddress: account.address,
      serializedPermissionAccount,
    };
  },
};
