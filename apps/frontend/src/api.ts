import {
  publishOwnerArtifactsInputSchema,
  resolveProvisioningResponseSchema,
  type OwnerPublicArtifacts,
  type RegularValidatorInitArtifact,
  type ResolveProvisioningResponse,
  type WalletRequest,
  walletRequestSchema,
} from "@guardlabs/guardrail-core";

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const headers =
    init.body === undefined
      ? init.headers
      : {
          "content-type": "application/json",
          ...(init.headers ?? {}),
        };

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export type FrontendApi = {
  loadProvisioningRequest(input: {
    walletId: string;
    backendUrl: string;
  }): Promise<ResolveProvisioningResponse>;
  publishOwnerArtifacts(input: {
    walletId: string;
    backendUrl: string;
    owner: OwnerPublicArtifacts;
    counterfactualWalletAddress: string;
    regularValidatorInitArtifact: RegularValidatorInitArtifact;
  }): Promise<WalletRequest>;
  refreshFunding(input: {
    walletId: string;
    backendUrl: string;
  }): Promise<WalletRequest>;
};

export const browserApi: FrontendApi = {
  async loadProvisioningRequest(input) {
    return resolveProvisioningResponseSchema.parse(
      await fetchJson<ResolveProvisioningResponse>(
        `${input.backendUrl}/v1/provisioning/${input.walletId}`,
        {
          method: "GET",
        },
      ),
    );
  },

  async publishOwnerArtifacts(input) {
    return walletRequestSchema.parse(
      await fetchJson<WalletRequest>(
        `${input.backendUrl}/v1/provisioning/${input.walletId}/owner-artifacts`,
        {
          method: "POST",
          body: JSON.stringify(
            publishOwnerArtifactsInputSchema.parse({
              owner: input.owner,
              counterfactualWalletAddress: input.counterfactualWalletAddress,
              regularValidatorInitArtifact: input.regularValidatorInitArtifact,
            }),
          ),
        },
      ),
    );
  },

  async refreshFunding(input) {
    return walletRequestSchema.parse(
      await fetchJson<WalletRequest>(
        `${input.backendUrl}/v1/wallets/${input.walletId}/refresh-funding`,
        {
          method: "POST",
        },
      ),
    );
  },
};
