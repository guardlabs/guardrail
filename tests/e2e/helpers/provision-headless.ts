import {
  getSupportedChainById,
  getWalletRequestResponseSchema,
  resolveProvisioningResponseSchema,
  type ResolveProvisioningResponse,
  type WalletRequest,
} from "@guardlabs/guardrail-core";
import { createProvisioningArtifacts } from "@guardlabs/guardrail-kernel";
import { createPublicClient, http } from "viem";
import { createHeadlessWebAuthnKey } from "../fixtures/headless-owner.js";

type FetchLike = typeof fetch;

export type ProvisioningTarget = {
  walletId: string;
  token: string;
  backendUrl: string;
};

export async function loadProvisioningRequest(
  input: ProvisioningTarget,
  fetchImpl: FetchLike = fetch,
): Promise<ResolveProvisioningResponse> {
  const response = await fetchImpl(
    `${input.backendUrl}/v1/provisioning/${input.walletId}?t=${encodeURIComponent(input.token)}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to load provisioning request ${input.walletId}: HTTP ${response.status}`,
    );
  }

  return resolveProvisioningResponseSchema.parse(await response.json());
}

export async function publishHeadlessOwnerArtifacts(
  input: ProvisioningTarget,
  dependencies: {
    fetchImpl?: FetchLike;
    webAuthnKey?: ReturnType<typeof createHeadlessWebAuthnKey>;
    artifactBuilder?: typeof createProvisioningArtifacts;
  } = {},
): Promise<{
  provisioningRequest: ResolveProvisioningResponse;
  publishedWallet: WalletRequest;
}> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const webAuthnKey = dependencies.webAuthnKey ?? createHeadlessWebAuthnKey();
  const provisioningRequest = await loadProvisioningRequest(input, fetchImpl);
  const supportedChain = getSupportedChainById(
    provisioningRequest.walletConfig.chainId,
  );

  if (!supportedChain) {
    throw new Error(
      `Unsupported chain ${provisioningRequest.walletConfig.chainId} for headless provisioning.`,
    );
  }

  const client = createPublicClient({
    chain: supportedChain.viemChain,
    transport: http(
      `${input.backendUrl}/v1/chains/${provisioningRequest.walletConfig.chainId}/rpc`,
    ),
  });
  const artifactBuilder =
    dependencies.artifactBuilder ?? createProvisioningArtifacts;
  const artifacts = await artifactBuilder(client, {
    walletConfig: provisioningRequest.walletConfig,
    webAuthnKey,
  });
  const response = await fetchImpl(
    `${input.backendUrl}/v1/provisioning/${input.walletId}/owner-artifacts?t=${encodeURIComponent(input.token)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(artifacts),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to publish owner artifacts for ${input.walletId}: HTTP ${response.status}`,
    );
  }

  return {
    provisioningRequest,
    publishedWallet: getWalletRequestResponseSchema.parse(
      await response.json(),
    ),
  };
}
