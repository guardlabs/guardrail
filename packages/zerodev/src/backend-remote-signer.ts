import {
  backendDeployWalletRequestSchema,
  backendSignResponseSchema,
  backendSignTypedDataRequestSchema,
  backendSignUserOperationRequestSchema,
  getBackendSignerAuthorizationTypedData,
  hashBackendSignerRequestBody,
  type BackendPackedUserOperation,
  type BackendSingleCallOperation,
  type BackendTypedDataSignaturePayload,
  type BackendSignerTypedDataPayload,
  type BackendUserOperationSignaturePayload,
} from "@conduit/shared";
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

function normalizeRawMessage(message: SignableMessage) {
  if (typeof message === "object" && message !== null && "raw" in message) {
    const rawValue = message.raw;

      if (typeof rawValue === "string") {
        return {
          kind: "raw" as const,
          raw: isHex(rawValue) ? rawValue : toHex(rawValue),
        };
      }

      return {
        kind: "raw" as const,
        raw: toHex(rawValue),
      };
  }

  throw new Error("Backend user-operation signing requires a raw 32-byte message payload.");
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
  let currentSigningContext:
    | {
        kind: "user_operation";
        operation: BackendSingleCallOperation;
        userOperation?: BackendPackedUserOperation;
      }
    | {
        kind: "deploy_wallet";
        userOperation?: BackendPackedUserOperation;
      }
    | {
        kind: "typed_data";
        typedData: BackendSignerTypedDataPayload;
      }
    | null = null;

  async function authorizeRequest(
    method: "sign_typed_data_v1" | "sign_user_operation_v1" | "deploy_wallet_v1",
    body: Record<string, unknown>,
  ) {
    const bodyHash = hashBackendSignerRequestBody(method, body as never);
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

  const account = toAccount({
    address: input.backendSignerAddress,
    async signMessage({ message }) {
      const signaturePayload = {
        kind: "user_operation_hash",
        message: normalizeRawMessage(message),
      } satisfies BackendUserOperationSignaturePayload;
      const context = currentSigningContext;

      if (
        !context ||
        context.kind === "typed_data" ||
        !context.userOperation
      ) {
        throw new Error(
          "Backend remote signer is missing a prepared user-operation context for signMessage.",
        );
      }

      const response =
        context.kind === "deploy_wallet"
          ? backendSignResponseSchema.parse(
              await postJson(
                `${backendBaseUrl}/v1/wallets/${input.walletId}/backend-deploy-wallet`,
                backendDeployWalletRequestSchema.parse({
                  auth: await authorizeRequest("deploy_wallet_v1", {
                    userOperation: context.userOperation,
                    signaturePayload,
                  }),
                  userOperation: context.userOperation,
                  signaturePayload,
                }),
              ),
            )
          : backendSignResponseSchema.parse(
              await postJson(
                `${backendBaseUrl}/v1/wallets/${input.walletId}/backend-sign-user-operation`,
                backendSignUserOperationRequestSchema.parse({
                  auth: await authorizeRequest("sign_user_operation_v1", {
                    operation: context.operation,
                    userOperation: context.userOperation,
                    signaturePayload,
                  }),
                  operation: context.operation,
                  userOperation: context.userOperation,
                  signaturePayload,
                }),
              ),
            );

      return response.signature as Hex;
    },
    async signTypedData<
      const TTypedData extends TypedData | Record<string, unknown>,
      TPrimaryType extends keyof TTypedData | "EIP712Domain" = keyof TTypedData,
    >(typedData: TypedDataDefinition<TTypedData, TPrimaryType>) {
      const typedDataPayload = {
        domain: (typedData.domain ?? {}) as Record<string, unknown>,
        types: typedData.types as Record<string, Array<{ name: string; type: string }>>,
        primaryType: typedData.primaryType as string,
        message: (typedData.message ?? {}) as Record<string, unknown>,
      } as BackendSignerTypedDataPayload;
      const typedDataSignaturePayload = {
        kind: "kernel_wrapped_typed_data",
        typedData: typedDataPayload,
      } satisfies BackendTypedDataSignaturePayload;
      const context = currentSigningContext;

      let response: { signature: string };

      if (context?.kind === "typed_data") {
        response = backendSignResponseSchema.parse(
          await postJson(
            `${backendBaseUrl}/v1/wallets/${input.walletId}/backend-sign-typed-data`,
            backendSignTypedDataRequestSchema.parse({
              auth: await authorizeRequest("sign_typed_data_v1", {
                typedData: context.typedData,
                signaturePayload: typedDataSignaturePayload,
              }),
              typedData: context.typedData,
              signaturePayload: typedDataSignaturePayload,
            }),
          ),
        );
      } else if (context && context.userOperation) {
        if (context.kind === "deploy_wallet") {
          response = backendSignResponseSchema.parse(
            await postJson(
              `${backendBaseUrl}/v1/wallets/${input.walletId}/backend-deploy-wallet`,
              backendDeployWalletRequestSchema.parse({
                auth: await authorizeRequest("deploy_wallet_v1", {
                  userOperation: context.userOperation,
                  signaturePayload: {
                    kind: "weighted_validator_approve",
                    typedData: typedDataPayload,
                  },
                }),
                userOperation: context.userOperation,
                signaturePayload: {
                  kind: "weighted_validator_approve",
                  typedData: typedDataPayload,
                },
              }),
            ),
          );
        } else {
          response = backendSignResponseSchema.parse(
            await postJson(
              `${backendBaseUrl}/v1/wallets/${input.walletId}/backend-sign-user-operation`,
              backendSignUserOperationRequestSchema.parse({
                auth: await authorizeRequest("sign_user_operation_v1", {
                  operation: context.operation,
                  userOperation: context.userOperation,
                  signaturePayload: {
                    kind: "weighted_validator_approve",
                    typedData: typedDataPayload,
                  },
                }),
                operation: context.operation,
                userOperation: context.userOperation,
                signaturePayload: {
                  kind: "weighted_validator_approve",
                  typedData: typedDataPayload,
                },
              }),
            ),
          );
        }
      } else {
        response = backendSignResponseSchema.parse(
          await postJson(
            `${backendBaseUrl}/v1/wallets/${input.walletId}/backend-sign-typed-data`,
            backendSignTypedDataRequestSchema.parse({
              auth: await authorizeRequest("sign_typed_data_v1", {
                typedData: typedDataPayload,
                signaturePayload: typedDataSignaturePayload,
              }),
              typedData: typedDataPayload,
              signaturePayload: typedDataSignaturePayload,
            }),
          ),
        );
      }

      return response.signature as Hex;
    },
    async signTransaction() {
      throw new Error("Backend remote signer does not support transactions.");
    },
  });

  return {
    ...account,
    beginUserOperationSigning(operation: BackendSingleCallOperation) {
      currentSigningContext = {
        kind: "user_operation",
        operation,
      };
    },
    beginDeployWalletSigning() {
      currentSigningContext = {
        kind: "deploy_wallet",
      };
    },
    beginTypedDataSigning(typedData: BackendSignerTypedDataPayload) {
      currentSigningContext = {
        kind: "typed_data",
        typedData,
      };
    },
    attachPreparedUserOperation(userOperation: BackendPackedUserOperation) {
      if (!currentSigningContext) {
        throw new Error("Cannot attach a prepared user operation without an active context.");
      }

      if (currentSigningContext.kind === "typed_data") {
        throw new Error("Cannot attach a prepared user operation while signing typed data.");
      }

      currentSigningContext =
        currentSigningContext.kind === "deploy_wallet"
          ? {
              kind: "deploy_wallet",
              userOperation,
            }
          : {
              kind: "user_operation",
              operation: currentSigningContext.operation,
              userOperation,
            };
    },
    clearSigningContext() {
      currentSigningContext = null;
    },
  };
}
