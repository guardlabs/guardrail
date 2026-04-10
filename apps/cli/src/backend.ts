import { GUARDRAIL_DEFAULT_BACKEND_URL } from "@guardlabs/guardrail-core";

export function resolveBackendUrl(override?: string) {
  return (
    override ??
    process.env.GUARDRAIL_BACKEND_URL ??
    GUARDRAIL_DEFAULT_BACKEND_URL
  );
}
