import type { RegularValidatorInitArtifact, WalletConfig } from "@conduit/shared";
import {
  PasskeyValidatorContractVersion,
  toPasskeyValidator,
} from "@zerodev/passkey-validator/_esm/index.js";
import { createKernelAccount } from "@zerodev/sdk/accounts";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import type { Hex, PublicClient, SignableMessage } from "viem";
import { encodeWebAuthnPubKey } from "@zerodev/webauthn-key/_esm/index.js";
import { createProvisioningWeightedValidator } from "./weighted-validator.js";

export type WebAuthnKey = {
  pubX: bigint;
  pubY: bigint;
  authenticatorId: string;
  authenticatorIdHash: Hex;
  rpID: string;
  signMessageCallback?: (
    message: SignableMessage,
    rpId: string,
    chainId: number,
    allowCredentials?: Array<{
      id: string;
      type: "public-key";
    }>,
  ) => Promise<Hex>;
};

export type ProvisioningArtifacts = {
  owner: {
    credentialId: string;
    publicKey: string;
  };
  counterfactualWalletAddress: string;
  regularValidatorInitArtifact: RegularValidatorInitArtifact;
};

export async function createProvisioningArtifacts(
  client: PublicClient,
  input: {
    walletConfig: WalletConfig;
    webAuthnKey: WebAuthnKey;
  },
): Promise<ProvisioningArtifacts> {
  const passkeyValidator = await toPasskeyValidator(client, {
    webAuthnKey: input.webAuthnKey,
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_1,
    validatorContractVersion:
      PasskeyValidatorContractVersion.V0_0_2_UNPATCHED,
    validatorAddress: input.walletConfig.sudoValidator.address as `0x${string}`,
  });
  const weightedValidator = await createProvisioningWeightedValidator(client, {
    walletConfig: input.walletConfig,
  });
  const account = await createKernelAccount(client, {
    entryPoint: getEntryPoint("0.7"),
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
      credentialId: input.webAuthnKey.authenticatorId,
      publicKey: encodeWebAuthnPubKey(input.webAuthnKey),
    },
    counterfactualWalletAddress: account.address,
    regularValidatorInitArtifact: {
      validatorAddress: weightedValidator.address,
      enableData: await weightedValidator.getEnableData(account.address),
      pluginEnableSignature,
    },
  };
}
