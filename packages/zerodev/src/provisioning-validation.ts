import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import {
  getCanonicalWeightedSignerOrder,
  type OwnerPublicArtifacts,
  type RegularValidatorInitArtifact,
  type WalletConfig,
} from "@guardlabs/guardrail-core";
import {
  CALL_TYPE,
  getEntryPoint,
  KERNEL_V3_1,
  VALIDATOR_TYPE,
} from "@zerodev/sdk/constants";
import { getValidatorAddress } from "@zerodev/weighted-ecdsa-validator";
import type { Address, Hex } from "viem";
import {
  concat,
  decodeAbiParameters,
  encodeAbiParameters,
  hashTypedData,
  hexToBytes,
  keccak256,
  pad,
  parseAbiParameters,
  zeroAddress,
} from "viem";

const EXECUTE_SELECTOR_V07 = "0xe9ae5c53";
const SECP256R1_ORDER = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
);

export type ProvisioningArtifactsValidationInput = {
  walletAddress: Address;
  walletConfig: WalletConfig;
  owner: OwnerPublicArtifacts;
  regularValidatorInitArtifact: RegularValidatorInitArtifact;
  expectedOrigin?: string;
};

export type ProvisioningArtifactsValidationErrorCode =
  | "owner_public_key_invalid"
  | "credential_id_mismatch"
  | "regular_validator_mismatch"
  | "plugin_enable_signature_malformed"
  | "plugin_enable_type_mismatch"
  | "plugin_enable_origin_mismatch"
  | "plugin_enable_response_type_mismatch"
  | "plugin_enable_challenge_mismatch"
  | "plugin_enable_signature_invalid";

export type ProvisioningArtifactsValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: ProvisioningArtifactsValidationErrorCode;
      message: string;
    };

type DecodedOwnerPublicKey = {
  pubX: Hex;
  pubY: Hex;
  authenticatorIdHash: Hex;
};

function buildValidationError(
  code: ProvisioningArtifactsValidationErrorCode,
  message: string,
): ProvisioningArtifactsValidationResult {
  return {
    ok: false,
    code,
    message,
  };
}

function decodeBase64Url(input: string) {
  return Buffer.from(
    input
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(input.length + ((4 - (input.length % 4)) % 4), "="),
    "base64",
  );
}

function decodeOwnerPublicKey(
  owner: OwnerPublicArtifacts,
): DecodedOwnerPublicKey | null {
  const normalized = owner.publicKey.slice(2);

  if (normalized.length !== 64 * 3) {
    return null;
  }

  return {
    pubX: `0x${normalized.slice(0, 64)}`,
    pubY: `0x${normalized.slice(64, 128)}`,
    authenticatorIdHash: `0x${normalized.slice(128, 192)}`,
  };
}

function buildExpectedRegularValidator(walletConfig: WalletConfig) {
  const signers = getCanonicalWeightedSignerOrder(
    walletConfig.regularValidator.signers,
  );
  const validatorAddress = getValidatorAddress(
    getEntryPoint("0.7"),
    KERNEL_V3_1,
  );
  const enableData = encodeAbiParameters(
    [
      { name: "_guardians", type: "address[]" },
      { name: "_weights", type: "uint24[]" },
      { name: "_threshold", type: "uint24" },
      { name: "_delay", type: "uint48" },
    ],
    [
      signers.map((signer) => signer.address as Address),
      signers.map((signer) => signer.weight),
      walletConfig.regularValidator.threshold,
      walletConfig.regularValidator.delaySeconds,
    ],
  );

  return {
    validatorAddress,
    enableData,
  };
}

function buildExpectedEnableChallenge(input: {
  walletAddress: Address;
  walletConfig: WalletConfig;
  validatorAddress: Address;
  enableData: Hex;
}) {
  const typedData = {
    domain: {
      name: "Kernel",
      version: "0.3.1",
      chainId: input.walletConfig.chainId,
      verifyingContract: input.walletAddress,
    },
    types: {
      Enable: [
        { name: "validationId", type: "bytes21" },
        { name: "nonce", type: "uint32" },
        { name: "hook", type: "address" },
        { name: "validatorData", type: "bytes" },
        { name: "hookData", type: "bytes" },
        { name: "selectorData", type: "bytes" },
      ],
    },
    primaryType: "Enable" as const,
    message: {
      validationId: concat([
        VALIDATOR_TYPE.SECONDARY,
        pad(input.validatorAddress, { size: 20, dir: "right" }),
      ]),
      nonce: 1,
      hook: zeroAddress,
      validatorData: input.enableData,
      hookData: "0x",
      selectorData: concat([
        EXECUTE_SELECTOR_V07,
        zeroAddress,
        zeroAddress,
        encodeAbiParameters(
          parseAbiParameters("bytes selectorInitData, bytes hookInitData"),
          [CALL_TYPE.DELEGATE_CALL, "0x0000"],
        ),
      ]),
    },
  };

  return Buffer.from(hexToBytes(hashTypedData(typedData))).toString("base64url");
}

function normalizeDerInteger(value: bigint) {
  let hex = value.toString(16);

  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }

  if (hex.length === 0) {
    hex = "00";
  }

  if (/[89a-f]/i.test(hex[0] ?? "")) {
    hex = `00${hex}`;
  }

  return Buffer.from(hex, "hex");
}

function encodeDerSignature(input: { r: bigint; s: bigint }) {
  const rBytes = normalizeDerInteger(input.r);
  const sBytes = normalizeDerInteger(input.s);
  const sequenceLength = 4 + rBytes.length + sBytes.length;

  if (sequenceLength > 0xff) {
    throw new Error("DER signature too long.");
  }

  return Buffer.concat([
    Buffer.from([0x30, sequenceLength, 0x02, rBytes.length]),
    rBytes,
    Buffer.from([0x02, sBytes.length]),
    sBytes,
  ]);
}

function verifyWebAuthnSignature(input: {
  decodedOwner: DecodedOwnerPublicKey;
  authenticatorData: Hex;
  clientDataJSON: string;
  r: bigint;
  s: bigint;
}) {
  if (input.s <= 0n || input.s > SECP256R1_ORDER / 2n) {
    return false;
  }

  const publicKey = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: Buffer.from(input.decodedOwner.pubX.slice(2), "hex").toString(
        "base64url",
      ),
      y: Buffer.from(input.decodedOwner.pubY.slice(2), "hex").toString(
        "base64url",
      ),
    },
    format: "jwk",
  });
  const clientDataHash = createHash("sha256")
    .update(input.clientDataJSON, "utf8")
    .digest();
  const signedPayload = Buffer.concat([
    Buffer.from(hexToBytes(input.authenticatorData)),
    clientDataHash,
  ]);

  return verifySignature(
    "sha256",
    signedPayload,
    publicKey,
    encodeDerSignature({
      r: input.r,
      s: input.s,
    }),
  );
}

export function validateProvisioningArtifacts(
  input: ProvisioningArtifactsValidationInput,
): ProvisioningArtifactsValidationResult {
  const decodedOwner = decodeOwnerPublicKey(input.owner);

  if (!decodedOwner) {
    return buildValidationError(
      "owner_public_key_invalid",
      "Owner public key is not a supported encoded WebAuthn public key.",
    );
  }

  const expectedAuthenticatorIdHash = keccak256(
    decodeBase64Url(input.owner.credentialId),
  );

  if (
    decodedOwner.authenticatorIdHash.toLowerCase() !==
    expectedAuthenticatorIdHash.toLowerCase()
  ) {
    return buildValidationError(
      "credential_id_mismatch",
      "Owner credentialId does not match the authenticator hash embedded in the stored public key.",
    );
  }

  const expectedRegularValidator = buildExpectedRegularValidator(
    input.walletConfig,
  );

  if (
    input.regularValidatorInitArtifact.validatorAddress.toLowerCase() !==
    expectedRegularValidator.validatorAddress.toLowerCase()
  ) {
    return buildValidationError(
      "regular_validator_mismatch",
      "Stored weighted validator address does not match the wallet config.",
    );
  }

  if (
    input.regularValidatorInitArtifact.enableData.toLowerCase() !==
    expectedRegularValidator.enableData.toLowerCase()
  ) {
    return buildValidationError(
      "regular_validator_mismatch",
      "Stored weighted validator enable data does not match the wallet config.",
    );
  }

  let decodedSignature: {
    authenticatorData: Hex;
    clientDataJSON: string;
    responseTypeLocation: bigint;
    r: bigint;
    s: bigint;
  };

  try {
    const [
      authenticatorData,
      clientDataJSON,
      responseTypeLocation,
      r,
      s,
    ] = decodeAbiParameters(
      [
        { name: "authenticatorData", type: "bytes" },
        { name: "clientDataJSON", type: "string" },
        { name: "responseTypeLocation", type: "uint256" },
        { name: "r", type: "uint256" },
        { name: "s", type: "uint256" },
        { name: "usePrecompiled", type: "bool" },
      ],
      input.regularValidatorInitArtifact.pluginEnableSignature as Hex,
    );

    decodedSignature = {
      authenticatorData,
      clientDataJSON,
      responseTypeLocation,
      r,
      s,
    };
  } catch {
    return buildValidationError(
      "plugin_enable_signature_malformed",
      "Stored plugin enable signature is not a valid encoded WebAuthn signature.",
    );
  }

  let clientData:
    | {
        type?: unknown;
        challenge?: unknown;
        origin?: unknown;
      }
    | undefined;

  try {
    clientData = JSON.parse(decodedSignature.clientDataJSON) as typeof clientData;
  } catch {
    return buildValidationError(
      "plugin_enable_signature_malformed",
      "Stored plugin enable signature has an invalid clientDataJSON payload.",
    );
  }

  if (clientData?.type !== "webauthn.get") {
    return buildValidationError(
      "plugin_enable_type_mismatch",
      "Stored plugin enable signature is not a WebAuthn authentication assertion.",
    );
  }

  const expectedResponseTypeLocation = BigInt(
    decodedSignature.clientDataJSON.lastIndexOf('"type":"webauthn.get"'),
  );

  if (
    expectedResponseTypeLocation < 0n ||
    decodedSignature.responseTypeLocation !== expectedResponseTypeLocation
  ) {
    return buildValidationError(
      "plugin_enable_response_type_mismatch",
      "Stored plugin enable signature has an unexpected WebAuthn responseTypeLocation.",
    );
  }

  if (
    input.expectedOrigin &&
    clientData?.origin !== input.expectedOrigin
  ) {
    return buildValidationError(
      "plugin_enable_origin_mismatch",
      `Stored plugin enable signature origin ${String(clientData?.origin)} does not match the expected frontend origin ${input.expectedOrigin}.`,
    );
  }

  const expectedChallenge = buildExpectedEnableChallenge({
    walletAddress: input.walletAddress,
    walletConfig: input.walletConfig,
    validatorAddress:
      expectedRegularValidator.validatorAddress as `0x${string}`,
    enableData: expectedRegularValidator.enableData,
  });

  if (clientData?.challenge !== expectedChallenge) {
    return buildValidationError(
      "plugin_enable_challenge_mismatch",
      "Stored plugin enable signature challenge does not match the expected Kernel enable message for this wallet.",
    );
  }

  if (
    !verifyWebAuthnSignature({
      decodedOwner,
      authenticatorData: decodedSignature.authenticatorData,
      clientDataJSON: decodedSignature.clientDataJSON,
      r: decodedSignature.r,
      s: decodedSignature.s,
    })
  ) {
    return buildValidationError(
      "plugin_enable_signature_invalid",
      "Stored plugin enable signature does not verify against the stored owner passkey public key.",
    );
  }

  return {
    ok: true,
  };
}
