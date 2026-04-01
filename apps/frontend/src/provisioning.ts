import {
  PROJECT_DEFAULT_BACKEND_URL,
  resolveProvisioningRequestSchema,
} from "@conduit/shared";
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
