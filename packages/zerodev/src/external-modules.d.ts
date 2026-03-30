declare module "@zerodev/passkey-validator/_esm/index.js" {
  export enum PasskeyValidatorContractVersion {
    V0_0_1_UNPATCHED = "0.0.1",
    V0_0_2_UNPATCHED = "0.0.2",
    V0_0_3_PATCHED = "0.0.3",
  }

  export function toPasskeyValidator(
    client: unknown,
    input: Record<string, unknown>,
  ): Promise<any>;
}

declare module "@zerodev/webauthn-key/_esm/index.js" {
  export function encodeWebAuthnPubKey(input: {
    pubX: bigint;
    pubY: bigint;
    authenticatorIdHash: `0x${string}`;
  }): `0x${string}`;
}
