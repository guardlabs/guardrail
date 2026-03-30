import {
  getSupportedChainById,
  type RegularValidatorInitArtifact,
  type WalletConfig,
} from "@conduit/shared";
import { createProvisioningArtifacts } from "@conduit/zerodev";
import {
  toWebAuthnKey,
  WebAuthnMode,
} from "@zerodev/permissions/signers";
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
      throw new Error("Missing CONDUIT_PASSKEY_SERVER_URL in frontend build.");
    }

    const rpcUrl = getPublicRpcUrl(walletConfig.chainId);

    if (!rpcUrl) {
      throw new Error(`Missing public RPC URL for chain ${walletConfig.chainId}.`);
    }

    const publicClient = createPublicClient({
      chain: getChain(walletConfig.chainId),
      transport: http(rpcUrl),
    });

    const webAuthnKey = await toWebAuthnKey({
      passkeyName: displayName,
      passkeyServerUrl: __PASSKEY_SERVER_URL__,
      mode: WebAuthnMode.Register,
      rpID: window.location.hostname,
      passkeyServerHeaders: {},
    });

    return createProvisioningArtifacts(publicClient, {
      walletConfig,
      webAuthnKey,
    });
  },
};
