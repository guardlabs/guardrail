import { resolveProvisioningRequestSchema } from "@guardlabs/guardrail-core";

export type ProvisioningQuery = {
  walletId: string;
};

export function parseProvisioningQuery(search: string): ProvisioningQuery {
  const params = new URLSearchParams(search);

  return resolveProvisioningRequestSchema.parse({
    walletId: params.get("walletId"),
  });
}
