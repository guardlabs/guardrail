import { createECDH, createPrivateKey, sign } from "node:crypto";
import { keccak256, encodeAbiParameters, isHex, toBytes, toHex } from "viem";

const HEADLESS_OWNER_PRIVATE_KEY =
  "0000000000000000000000000000000000000000000000000000000000000001";
const HEADLESS_OWNER_CREDENTIAL_BYTES = Buffer.from("conduit-headless-owner", "utf8");
const P256_CURVE_ORDER = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
);

export const HEADLESS_OWNER_CREDENTIAL_ID =
  HEADLESS_OWNER_CREDENTIAL_BYTES.toString("base64url");

function normalizeMessageToBytes(message: unknown) {
  if (typeof message === "string") {
    return isHex(message) ? toBytes(message) : Buffer.from(message, "utf8");
  }

  if (
    message &&
    typeof message === "object" &&
    "raw" in message &&
    typeof message.raw === "string"
  ) {
    return isHex(message.raw) ? toBytes(message.raw) : Buffer.from(message.raw, "utf8");
  }

  if (
    message &&
    typeof message === "object" &&
    "raw" in message &&
    message.raw instanceof Uint8Array
  ) {
    return message.raw;
  }

  throw new Error("Unsupported WebAuthn message format.");
}

function createClientDataJson(challenge: string) {
  return JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin: "http://localhost:3000",
    crossOrigin: false,
  });
}

function buildPrivateKeyJwk(input: {
  pubX: Uint8Array;
  pubY: Uint8Array;
}) {
  return {
    kty: "EC",
    crv: "P-256",
    d: Buffer.from(HEADLESS_OWNER_PRIVATE_KEY, "hex").toString("base64url"),
    x: Buffer.from(input.pubX).toString("base64url"),
    y: Buffer.from(input.pubY).toString("base64url"),
  } as const;
}

function findBeforeTypeIndex(clientDataJson: string) {
  return BigInt(clientDataJson.lastIndexOf('"type":"webauthn.get"'));
}

function normalizeSignature(signature: Uint8Array) {
  const r = BigInt(toHex(signature.subarray(0, 32)));
  let s = BigInt(toHex(signature.subarray(32, 64)));

  if (s > P256_CURVE_ORDER / 2n) {
    s = P256_CURVE_ORDER - s;
  }

  return {
    r,
    s,
  };
}

async function sha256(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export function createHeadlessWebAuthnKey() {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(HEADLESS_OWNER_PRIVATE_KEY, "hex"));
  const publicKey = ecdh.getPublicKey(undefined, "uncompressed");
  const pubX = publicKey.subarray(1, 33);
  const pubY = publicKey.subarray(33, 65);
  const authenticatorIdHash = keccak256(toHex(HEADLESS_OWNER_CREDENTIAL_BYTES));
  const privateKey = createPrivateKey({
    key: buildPrivateKeyJwk({
      pubX,
      pubY,
    }),
    format: "jwk",
  });

  return {
    pubX: BigInt(toHex(pubX)),
    pubY: BigInt(toHex(pubY)),
    authenticatorId: HEADLESS_OWNER_CREDENTIAL_ID,
    authenticatorIdHash,
    rpID: "localhost",
    async signMessageCallback(message: unknown, rpId: string) {
      const challengeBytes = normalizeMessageToBytes(message);
      const challenge = Buffer.from(challengeBytes).toString("base64url");
      const clientDataJSON = createClientDataJson(challenge);
      const authenticatorData = new Uint8Array([
        ...(await sha256(rpId)),
        0x05,
        0x00,
        0x00,
        0x00,
        0x00,
      ]);
      const signedPayload = Buffer.concat([
        Buffer.from(authenticatorData),
        Buffer.from(await sha256(clientDataJSON)),
      ]);
      const rawSignature = sign("sha256", signedPayload, {
        key: privateKey,
        dsaEncoding: "ieee-p1363",
      });
      const { r, s } = normalizeSignature(new Uint8Array(rawSignature));

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
          toHex(authenticatorData),
          clientDataJSON,
          findBeforeTypeIndex(clientDataJSON),
          r,
          s,
          false,
        ],
      );
    },
  };
}
