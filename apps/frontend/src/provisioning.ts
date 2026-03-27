import {
  PROJECT_DEFAULT_BACKEND_URL,
  resolveProvisioningRequestSchema,
} from "@agent-wallet/shared";
import { z } from "zod";

export type ProvisioningQuery = {
  walletId: string;
  token: string;
  backendUrl: string;
};

export function parseProvisioningQuery(
  search: string,
  defaultBackendUrl = PROJECT_DEFAULT_BACKEND_URL,
): ProvisioningQuery {
  const params = new URLSearchParams(search);

  return resolveProvisioningRequestSchema
    .extend({
      backendUrl: z.string().url().catch(defaultBackendUrl),
    })
    .parse({
      walletId: params.get("walletId"),
      token: params.get("token"),
      backendUrl: params.get("backendUrl") ?? defaultBackendUrl,
    });
}

export function formatFundingLabel(status: "unverified" | "insufficient" | "verified") {
  switch (status) {
    case "verified":
      return "Funding verified";
    case "insufficient":
      return "Funding still required";
    default:
      return "Funding not checked yet";
  }
}
