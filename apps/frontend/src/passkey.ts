import {
  getSupportedChainById,
  type WalletConfig,
} from "@guardlabs/guardrail-core";
import {
  createProvisioningArtifacts as createKernelProvisioningArtifacts,
  type ProvisioningArtifacts,
  type WebAuthnKey,
} from "@guardlabs/guardrail-kernel";
import { toWebAuthnKey, WebAuthnMode } from "@zerodev/permissions/signers";
import { createPublicClient, http } from "viem";

function getPublicRpcUrl(chainId: number) {
  const supportedChain = getSupportedChainById(chainId);

  if (!supportedChain) {
    return null;
  }

  switch (supportedChain.frontendRuntimeKey) {
    case "BASE":
      return __BASE_RPC_URL__ ?? __BASE_BUNDLER_URL__;
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
  registerPasskey(input: {
    displayName: string;
  }): Promise<WebAuthnKey>;
  createProvisioningArtifacts(input: {
    walletConfig: WalletConfig;
    webAuthnKey: WebAuthnKey;
  }): Promise<ProvisioningArtifacts>;
};

export const browserPasskeyClient: PasskeyClient = {
  async registerPasskey({ displayName }) {
    if (!__PASSKEY_SERVER_URL__) {
      throw new Error(
        "Missing GUARDRAIL_PASSKEY_SERVER_URL in frontend build.",
      );
    }

    return toWebAuthnKey({
      passkeyName: displayName,
      passkeyServerUrl: __PASSKEY_SERVER_URL__,
      mode: WebAuthnMode.Register,
      rpID: window.location.hostname,
      passkeyServerHeaders: {},
    });
  },

  async createProvisioningArtifacts({ walletConfig, webAuthnKey }) {
    
    const rpcUrl = getPublicRpcUrl(walletConfig.chainId);

    if (!rpcUrl) {
      throw new Error(
        `Missing public RPC URL for chain ${walletConfig.chainId}.`,
      );
    }

    const publicClient = createPublicClient({
      chain: getChain(walletConfig.chainId),
      transport: http(rpcUrl),
    });

    return createKernelProvisioningArtifacts(publicClient, {
      walletConfig,
      webAuthnKey,
    });
  },
};
