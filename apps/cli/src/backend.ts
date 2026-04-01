import { PROJECT_DEFAULT_BACKEND_URL } from "@conduit/shared";

export function resolveBackendUrl(override?: string) {
  return (
    override ?? process.env.CONDUIT_BACKEND_URL ?? PROJECT_DEFAULT_BACKEND_URL
  );
}
