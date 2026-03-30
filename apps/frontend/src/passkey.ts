import {
  getSupportedChainById,
  type RegularValidatorInitArtifact,
  type WalletConfig,
} from "@agent-wallet/shared";
import { createProvisioningWeightedValidator } from "@agent-wallet/zerodev";
import {
  PasskeyValidatorContractVersion,
  toPasskeyValidator,
} from "@zerodev/passkey-validator";
import {
  toWebAuthnKey,
  WebAuthnMode,
} from "@zerodev/permissions/signers";
import { createKernelAccount } from "@zerodev/sdk/accounts";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { encodeWebAuthnPubKey } from "@zerodev/webauthn-key";
import { createPublicClient, http } from "viem";

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
    walletConfig: WalletConfig;
  }): Promise<{
    owner: { credentialId: string; publicKey: string };
    counterfactualWalletAddress: string;
    regularValidatorInitArtifact: RegularValidatorInitArtifact;
  }>;
};

export const browserPasskeyClient: PasskeyClient = {
  async createProvisioningArtifacts({ displayName, walletConfig }) {
    if (!__PASSKEY_SERVER_URL__) {
      throw new Error("Missing AGENT_WALLET_PASSKEY_SERVER_URL in frontend build.");
    }

    const rpcUrl = getPublicRpcUrl(walletConfig.chainId);

    if (!rpcUrl) {
      throw new Error(`Missing public RPC URL for chain ${walletConfig.chainId}.`);
    }

    const publicClient = createPublicClient({
      chain: getChain(walletConfig.chainId),
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
      validatorAddress: walletConfig.sudoValidator.address as `0x${string}`,
    });

    const weightedValidator = await createProvisioningWeightedValidator(publicClient, {
      walletConfig,
    });

    const account = await createKernelAccount(publicClient, {
      entryPoint,
      kernelVersion: KERNEL_V3_1,
      plugins: {
        sudo: passkeyValidator,
        regular: weightedValidator,
      },
    });

    const pluginEnableSignature =
      await account.kernelPluginManager.getPluginEnableSignature(account.address);

    return {
      owner: {
        credentialId: webAuthnKey.authenticatorId,
        publicKey: encodeWebAuthnPubKey(webAuthnKey),
      },
      counterfactualWalletAddress: account.address,
      regularValidatorInitArtifact: {
        validatorAddress: weightedValidator.address,
        enableData: await weightedValidator.getEnableData(account.address),
        pluginEnableSignature,
      },
    };
  },
};
