import {
  getSupportedChainById,
  type PermissionScope,
} from "@agent-wallet/shared";
import {
  PasskeyValidatorContractVersion,
  toPasskeyValidator,
} from "@zerodev/passkey-validator";
import {
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
import type { Hex } from "viem";
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
      policies: [
        toCallPolicy({
          policyVersion: CallPolicyVersion.V0_0_5,
          permissions: scope.allowedMethods.map((selector) => ({
            target: scope.targetContract as `0x${string}`,
            selector: selector as Hex,
            valueLimit: 0n,
          })),
        }),
      ],
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
