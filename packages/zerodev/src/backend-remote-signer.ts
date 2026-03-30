import {
  backendSignMessageRequestSchema,
  backendSignResponseSchema,
  backendSignTypedDataRequestSchema,
  getBackendSignerAuthorizationTypedData,
  hashBackendSignerPayload,
  type BackendSignerMessagePayload,
  type BackendSignerTypedDataPayload,
} from "@agent-wallet/shared";
import type {
  Address,
  Hex,
  LocalAccount,
  SignableMessage,
  TypedData,
  TypedDataDefinition,
} from "viem";
import { isHex, toHex } from "viem";
import { toAccount } from "viem/accounts";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;

    throw new Error(
      payload?.message
        ? `Backend signer request failed: ${payload.message}`
        : `Backend signer request failed with HTTP ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

function normalizeMessage(message: SignableMessage): BackendSignerMessagePayload["message"] {
  if (typeof message === "string") {
    return {
      kind: "text",
      text: message,
    };
  }

  if (typeof message === "object" && message !== null && "raw" in message) {
    const rawValue = message.raw;

    if (typeof rawValue === "string") {
      return {
        kind: "raw",
        raw: isHex(rawValue) ? rawValue : toHex(rawValue),
      };
    }

    return {
      kind: "raw",
      raw: toHex(rawValue),
    };
  }

  throw new Error("Unsupported signMessage payload for backend remote signer.");
}

function buildRequestId() {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function buildExpiresAt() {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

export function createBackendRemoteSigner(input: {
  backendBaseUrl: string;
  walletId: string;
  walletAddress: Address;
  backendSignerAddress: Address;
  agentSigner: LocalAccount;
}) {
  const backendBaseUrl = input.backendBaseUrl.replace(/\/+$/, "");

  async function authorizeRequest(
    method: "sign_message" | "sign_typed_data",
    payload: BackendSignerMessagePayload | BackendSignerTypedDataPayload,
  ) {
    const bodyHash = hashBackendSignerPayload(method, payload);
    const authPayload = {
      walletAddress: input.walletAddress,
      backendSignerAddress: input.backendSignerAddress,
      method,
      bodyHash,
      requestId: buildRequestId(),
      expiresAt: buildExpiresAt(),
    } as const;

    const agentSignature = await input.agentSigner.signTypedData(
      getBackendSignerAuthorizationTypedData(authPayload),
    );

    return {
      ...authPayload,
      agentSignature,
    };
  }

  return toAccount({
    address: input.backendSignerAddress,
    async signMessage({ message }) {
      const payload = {
        message: normalizeMessage(message),
      } satisfies BackendSignerMessagePayload;
      const auth = await authorizeRequest("sign_message", payload);
      const response = backendSignResponseSchema.parse(
        await postJson(
          `${backendBaseUrl}/v1/wallets/${input.walletId}/backend-sign`,
          backendSignMessageRequestSchema.parse({
            auth,
            payload,
          }),
        ),
      );

      return response.signature as Hex;
    },
    async signTypedData<
      const TTypedData extends TypedData | Record<string, unknown>,
      TPrimaryType extends keyof TTypedData | "EIP712Domain" = keyof TTypedData,
    >(typedData: TypedDataDefinition<TTypedData, TPrimaryType>) {
      const payload = {
        domain: (typedData.domain ?? {}) as Record<string, unknown>,
        types: typedData.types as Record<string, Array<{ name: string; type: string }>>,
        primaryType: typedData.primaryType as string,
        message: (typedData.message ?? {}) as Record<string, unknown>,
      } as BackendSignerTypedDataPayload;
      const auth = await authorizeRequest("sign_typed_data", payload);
      const response = backendSignResponseSchema.parse(
        await postJson(
          `${backendBaseUrl}/v1/wallets/${input.walletId}/backend-sign`,
          backendSignTypedDataRequestSchema.parse({
            auth,
            payload,
          }),
        ),
      );

      return response.signature as Hex;
    },
    async signTransaction() {
      throw new Error("Backend remote signer does not support transactions.");
    },
  });
}
