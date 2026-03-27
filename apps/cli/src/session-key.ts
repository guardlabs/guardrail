import { createECDH } from "node:crypto";

export type SessionKeyPair = {
  privateKey: `0x${string}`;
  publicKey: `0x${string}`;
};

export function generateSessionKeyPair(): SessionKeyPair {
  const ecdh = createECDH("secp256k1");
  ecdh.generateKeys();

  return {
    privateKey: `0x${ecdh.getPrivateKey("hex")}`,
    publicKey: `0x${ecdh.getPublicKey("hex", "uncompressed")}`,
  };
}
