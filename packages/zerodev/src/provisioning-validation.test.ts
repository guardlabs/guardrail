import { createHash, generateKeyPairSync, sign as signMessage } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildDefaultWalletConfig,
  getCanonicalWeightedSignerOrder,
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
import { validateProvisioningArtifacts } from "./provisioning-validation.js";

const TEST_WALLET_ADDRESS =
  "0x5aB9A3e7AAf66611c30907ebf5cA86AC775490CF" as Address;
const TEST_ORIGIN = "https://guardlabs.ai";
const EXECUTE_SELECTOR_V07 = "0xe9ae5c53";
const SECP256R1_ORDER = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
);

function parseDerSignature(signature: Buffer) {
  if (signature[0] !== 0x30 || signature[2] !== 0x02) {
    throw new Error("Unsupported DER signature encoding.");
  }

  const rLength = signature[3] ?? 0;
  const rStart = 4;
  const rEnd = rStart + rLength;

  if (signature[rEnd] !== 0x02) {
    throw new Error("Unsupported DER signature encoding.");
  }

  const sLength = signature[rEnd + 1] ?? 0;
  const sStart = rEnd + 2;
  const sEnd = sStart + sLength;

  let r = BigInt(`0x${signature.subarray(rStart, rEnd).toString("hex") || "0"}`);
  let s = BigInt(`0x${signature.subarray(sStart, sEnd).toString("hex") || "0"}`);

  if (s > SECP256R1_ORDER / 2n) {
    s = SECP256R1_ORDER - s;
  }

  if (r === 0n || s === 0n) {
    throw new Error("Invalid P-256 signature.");
  }

  return { r, s };
}

function buildExpectedEnableData(walletConfig: ReturnType<typeof buildDefaultWalletConfig>) {
  const signers = getCanonicalWeightedSignerOrder(
    walletConfig.regularValidator.signers,
  );

  return encodeAbiParameters(
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
}

function buildExpectedChallenge(input: {
  walletAddress: Address;
  walletConfig: ReturnType<typeof buildDefaultWalletConfig>;
  validatorAddress: Address;
  enableData: `0x${string}`;
}) {
  return Buffer.from(
    hexToBytes(
      hashTypedData({
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
        primaryType: "Enable",
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
      }),
    ),
  ).toString("base64url");
}

function createProvisioningArtifactsFixture() {
  const walletConfig = buildDefaultWalletConfig({
    chainId: 84532,
    agentAddress: "0xb4F47999F8ddbFd6b2496b396D0521dB5629ECE3",
    backendAddress: "0x665807CaE7d8E9Efc0aBd9FC6C526229b93D042e",
  });
  const validatorAddress = getValidatorAddress(getEntryPoint("0.7"), KERNEL_V3_1);
  const enableData = buildExpectedEnableData(walletConfig);
  const challenge = buildExpectedChallenge({
    walletAddress: TEST_WALLET_ADDRESS,
    walletConfig,
    validatorAddress,
    enableData,
  });
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" }) as {
    x: string;
    y: string;
  };
  const credentialIdBytes = Buffer.from("guardrail-passkey-fixture");
  const credentialId = credentialIdBytes.toString("base64url");
  const clientDataJSON = JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin: TEST_ORIGIN,
    crossOrigin: false,
  });
  const authenticatorData = `0x${"11".repeat(37)}` as Hex;
  const signedPayload = Buffer.concat([
    Buffer.from(hexToBytes(authenticatorData)),
    createHash("sha256").update(clientDataJSON, "utf8").digest(),
  ]);
  const signatureDer = signMessage("sha256", signedPayload, privateKey);
  const { r, s } = parseDerSignature(signatureDer);

  return {
    walletConfig,
    owner: {
      credentialId,
      publicKey: `0x${Buffer.from(jwk.x, "base64url").toString("hex")}${Buffer.from(jwk.y, "base64url").toString("hex")}${keccak256(credentialIdBytes).slice(2)}`,
    },
    regularValidatorInitArtifact: {
      validatorAddress,
      enableData,
      pluginEnableSignature: encodeAbiParameters(
        [
          { name: "authenticatorData", type: "bytes" },
          { name: "clientDataJSON", type: "string" },
          { name: "responseTypeLocation", type: "uint256" },
          { name: "r", type: "uint256" },
          { name: "s", type: "uint256" },
          { name: "usePrecompiled", type: "bool" },
        ],
        [
          authenticatorData,
          clientDataJSON,
          BigInt(clientDataJSON.lastIndexOf('"type":"webauthn.get"')),
          r,
          s,
          true,
        ],
      ),
    },
  };
}

describe("provisioning artifact validation", () => {
  it("accepts coherent provisioning artifacts", () => {
    const fixture = createProvisioningArtifactsFixture();

    expect(
      validateProvisioningArtifacts({
        walletAddress: TEST_WALLET_ADDRESS,
        walletConfig: fixture.walletConfig,
        owner: fixture.owner,
        regularValidatorInitArtifact: fixture.regularValidatorInitArtifact,
        expectedOrigin: TEST_ORIGIN,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a credentialId that does not match the stored owner public key", () => {
    const fixture = createProvisioningArtifactsFixture();

    expect(
      validateProvisioningArtifacts({
        walletAddress: TEST_WALLET_ADDRESS,
        walletConfig: fixture.walletConfig,
        owner: {
          ...fixture.owner,
          credentialId: Buffer.from("wrong-passkey").toString("base64url"),
        },
        regularValidatorInitArtifact: fixture.regularValidatorInitArtifact,
        expectedOrigin: TEST_ORIGIN,
      }),
    ).toMatchObject({
      ok: false,
      code: "credential_id_mismatch",
    });
  });

  it("rejects weighted validator artifacts that do not match the wallet config", () => {
    const fixture = createProvisioningArtifactsFixture();

    expect(
      validateProvisioningArtifacts({
        walletAddress: TEST_WALLET_ADDRESS,
        walletConfig: fixture.walletConfig,
        owner: fixture.owner,
        regularValidatorInitArtifact: {
          ...fixture.regularValidatorInitArtifact,
          enableData: "0x1234",
        },
        expectedOrigin: TEST_ORIGIN,
      }),
    ).toMatchObject({
      ok: false,
      code: "regular_validator_mismatch",
    });
  });

  it("rejects a plugin enable signature that does not verify against the stored passkey", () => {
    const fixture = createProvisioningArtifactsFixture();
    const [
      authenticatorData,
      clientDataJSON,
      responseTypeLocation,
      r,
      s,
      usePrecompiled,
    ] = decodeAbiParameters(
      [
        { name: "authenticatorData", type: "bytes" },
        { name: "clientDataJSON", type: "string" },
        { name: "responseTypeLocation", type: "uint256" },
        { name: "r", type: "uint256" },
        { name: "s", type: "uint256" },
        { name: "usePrecompiled", type: "bool" },
      ],
      fixture.regularValidatorInitArtifact.pluginEnableSignature,
    );

    expect(
      validateProvisioningArtifacts({
        walletAddress: TEST_WALLET_ADDRESS,
        walletConfig: fixture.walletConfig,
        owner: fixture.owner,
        regularValidatorInitArtifact: {
          ...fixture.regularValidatorInitArtifact,
          pluginEnableSignature: encodeAbiParameters(
            [
              { name: "authenticatorData", type: "bytes" },
              { name: "clientDataJSON", type: "string" },
              { name: "responseTypeLocation", type: "uint256" },
              { name: "r", type: "uint256" },
              { name: "s", type: "uint256" },
              { name: "usePrecompiled", type: "bool" },
            ],
            [
              authenticatorData,
              clientDataJSON,
              responseTypeLocation,
              r + 1n,
              s,
              usePrecompiled,
            ],
          ),
        },
        expectedOrigin: TEST_ORIGIN,
      }),
    ).toMatchObject({
      ok: false,
      code: "plugin_enable_signature_invalid",
    });
  });

  it("rejects a plugin enable signature from an unexpected frontend origin", () => {
    const fixture = createProvisioningArtifactsFixture();

    expect(
      validateProvisioningArtifacts({
        walletAddress: TEST_WALLET_ADDRESS,
        walletConfig: fixture.walletConfig,
        owner: fixture.owner,
        regularValidatorInitArtifact: fixture.regularValidatorInitArtifact,
        expectedOrigin: "https://staging.guardlabs.ai",
      }),
    ).toMatchObject({
      ok: false,
      code: "plugin_enable_origin_mismatch",
    });
  });
});
