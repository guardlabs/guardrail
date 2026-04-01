import { resolveProvisioningRequestSchema } from "@conduit/shared";

export type ProvisioningQuery = {
  walletId: string;
  token: string;
};

export function parseProvisioningQuery(
  search: string,
): ProvisioningQuery {
  const params = new URLSearchParams(search);

  return resolveProvisioningRequestSchema.parse({
    walletId: params.get("walletId"),
    token: params.get("token"),
  });
}
