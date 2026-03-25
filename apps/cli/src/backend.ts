import { PROJECT_DEFAULT_BACKEND_URL } from "@agent-wallet/shared";

export function resolveBackendUrl(override?: string) {
  return override ?? process.env.AGENT_WALLET_BACKEND_URL ?? PROJECT_DEFAULT_BACKEND_URL;
}
