import {
  getSupportedChainById,
  type WalletConfig,
} from "@guardlabs/guardrail-core";
import {
  createProvisioningArtifacts as createKernelProvisioningArtifacts,
  type ProvisioningArtifacts,
  type WebAuthnKey,
} from "@guardlabs/guardrail-kernel";
import {
  b64ToBytes,
  findQuoteIndices,
  hexStringToUint8Array,
  isRIP7212SupportedNetwork,
  parseAndNormalizeSig,
  uint8ArrayToHexString,
} from "@zerodev/webauthn-key";
import type { Hex, SignableMessage } from "viem";
import { createPublicClient, encodeAbiParameters, http, keccak256 } from "viem";

type FrontendWebAuthnKey = WebAuthnKey & {
  transports?: AuthenticatorTransport[];
};

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
  }): Promise<FrontendWebAuthnKey>;
  createProvisioningArtifacts(input: {
    walletConfig: WalletConfig;
    webAuthnKey: WebAuthnKey;
  }): Promise<ProvisioningArtifacts>;
};

async function buildWebAuthnKey(input: {
  pubKey: string;
  authenticatorId: string;
  rpID: string;
  transports?: AuthenticatorTransport[];
}): Promise<FrontendWebAuthnKey> {
  const authenticatorIdHash = keccak256Hex(input.authenticatorId);
  const spkiDer = Buffer.from(input.pubKey, "base64");
  const key = await crypto.subtle.importKey(
    "spki",
    spkiDer,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["verify"],
  );
  const rawKey = await crypto.subtle.exportKey("raw", key);
  const rawKeyBuffer = Buffer.from(rawKey);
  const pubKeyX = rawKeyBuffer.subarray(1, 33).toString("hex");
  const pubKeyY = rawKeyBuffer.subarray(33).toString("hex");

  const webAuthnKey: FrontendWebAuthnKey = {
    pubX: BigInt(`0x${pubKeyX}`),
    pubY: BigInt(`0x${pubKeyY}`),
    authenticatorId: input.authenticatorId,
    authenticatorIdHash,
    rpID: input.rpID,
    transports: input.transports,
  };

  webAuthnKey.signMessageCallback = async (
    message,
    rpId,
    chainId,
    allowCredentials,
  ) =>
    signMessageWithPasskey(message, {
      rpId,
      chainId,
      authenticatorId: input.authenticatorId,
      transports: input.transports,
      allowCredentials,
    });

  return webAuthnKey;
}

function keccak256Hex(authenticatorId: string) {
  return keccak256(uint8ArrayToHexString(b64ToBytes(authenticatorId)));
}

function normalizeMessageToChallenge(message: SignableMessage) {
  if (typeof message === "string") {
    return hexStringToUint8Array(
      message.startsWith("0x") ? message.slice(2) : message,
    );
  }

  if ("raw" in message && typeof message.raw === "string") {
    return hexStringToUint8Array(
      message.raw.startsWith("0x") ? message.raw.slice(2) : message.raw,
    );
  }

  if ("raw" in message && message.raw instanceof Uint8Array) {
    return message.raw;
  }

  throw new Error("Unsupported WebAuthn message format.");
}

async function signMessageWithPasskey(
  message: SignableMessage,
  input: {
    rpId: string;
    chainId: number;
    authenticatorId: string;
    transports?: AuthenticatorTransport[];
    allowCredentials?: Array<{
      id: string;
      type: "public-key";
    }>;
  },
): Promise<Hex> {
  const challengeBytes = normalizeMessageToChallenge(message);
  const publicKey = {
    challenge: challengeBytes,
    rpId: input.rpId,
    userVerification: "required" as const,
    allowCredentials: [
      {
        id: b64ToBytes(input.authenticatorId),
        type: "public-key" as const,
        transports: input.transports,
      },
      ...(input.allowCredentials ?? [])
        .filter((credential) => credential.id !== input.authenticatorId)
        .map((credential) => ({
          id: b64ToBytes(credential.id),
          type: credential.type,
        })),
    ],
    // Bias Chrome toward a locally available provider before hybrid QR.
    hints: ["client-device", "security-key"],
  };

  const credential = (await navigator.credentials.get({
    mediation: "required",
    publicKey,
  } as CredentialRequestOptions & {
    publicKey: PublicKeyCredentialRequestOptions & {
      hints: string[];
    };
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("WebAuthn signing was cancelled.");
  }

  const response = credential.response;

  if (!(response instanceof AuthenticatorAssertionResponse)) {
    throw new Error("Unsupported WebAuthn assertion response.");
  }

  const authenticatorDataHex = uint8ArrayToHexString(
    new Uint8Array(response.authenticatorData),
  );
  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON);
  const { beforeType } = findQuoteIndices(clientDataJSON);
  const signatureHex = uint8ArrayToHexString(new Uint8Array(response.signature));
  const { r, s } = parseAndNormalizeSig(signatureHex);

  return encodeAbiParameters(
    [
      { name: "authenticatorData", type: "bytes" },
      { name: "clientDataJSON", type: "string" },
      { name: "responseTypeLocation", type: "uint256" },
      { name: "r", type: "uint256" },
      { name: "s", type: "uint256" },
      { name: "usePrecompiled", type: "bool" },
    ],
    [
      authenticatorDataHex,
      clientDataJSON,
      beforeType,
      r,
      s,
      isRIP7212SupportedNetwork(input.chainId),
    ],
  );
}

export const browserPasskeyClient: PasskeyClient = {
  async registerPasskey({ displayName }) {
    if (!__PASSKEY_SERVER_URL__) {
      throw new Error(
        "Missing GUARDRAIL_PASSKEY_SERVER_URL in frontend build.",
      );
    }

    const rpID = window.location.hostname;
    const registerOptionsResponse = await fetch(
      `${__PASSKEY_SERVER_URL__}/register/options`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: displayName, rpID }),
        credentials: "include",
      },
    );
    const registerOptions = await registerOptionsResponse.json();
    const { startRegistration } = await import("@simplewebauthn/browser");
    const registerCredential = await startRegistration(registerOptions.options);
    const registerVerifyResponse = await fetch(
      `${__PASSKEY_SERVER_URL__}/register/verify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: registerOptions.userId,
          username: displayName,
          cred: registerCredential,
          rpID,
        }),
        credentials: "include",
      },
    );
    const registerVerifyResult = await registerVerifyResponse.json();

    if (!registerVerifyResult.verified) {
      throw new Error("Registration not verified");
    }

    return buildWebAuthnKey({
      pubKey: registerCredential.response.publicKey,
      authenticatorId: registerCredential.id,
      rpID,
      transports: registerCredential.response.transports,
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
