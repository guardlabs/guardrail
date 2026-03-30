import { keccak256, toBytes } from "viem";
import { z } from "zod";

export const PROJECT_DEFAULT_BACKEND_URL = "http://127.0.0.1:3000";
export const PROJECT_DEFAULT_FRONTEND_URL = "http://127.0.0.1:5173";
export const PROJECT_WALLET_MODE = "kernel_weighted_multisig_v1" as const;
export const PROJECT_KERNEL_VERSION = "3.1" as const;
export const PROJECT_ENTRY_POINT_VERSION = "0.7" as const;
export const PROJECT_PASSKEY_VALIDATOR_ADDRESS =
  "0xbA45a2BFb8De3D24cA9D7F1B551E14dFF5d690Fd" as const;

export const walletModeSchema = z.literal(PROJECT_WALLET_MODE);

export const walletRequestStatusSchema = z.enum([
  "created",
  "owner_bound",
  "ready",
  "failed",
]);

export type WalletRequestStatus = z.infer<typeof walletRequestStatusSchema>;

export const hexStringSchema = z
  .string()
  .regex(/^0x(?:[a-fA-F0-9]{2})*$/, "Expected a 0x-prefixed hex string");

export const bytes32HexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Expected a 32-byte hex string");

export const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected a 20-byte EVM address");

export const kernelVersionSchema = z.literal(PROJECT_KERNEL_VERSION);
export const entryPointVersionSchema = z.literal(PROJECT_ENTRY_POINT_VERSION);

export const weightedSignerRoleSchema = z.enum(["agent", "backend"]);

export const weightedSignerSchema = z.object({
  role: weightedSignerRoleSchema,
  address: evmAddressSchema,
  weight: z.number().int().positive(),
});

export const weightedValidatorConfigSchema = z
  .object({
    type: z.literal("weighted-ecdsa"),
    threshold: z.number().int().positive(),
    delaySeconds: z.number().int().nonnegative(),
    signers: z.array(weightedSignerSchema).length(2),
  })
  .superRefine((input, ctx) => {
    const roles = new Set(input.signers.map((signer) => signer.role));

    if (roles.size !== input.signers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Weighted validator signers must have distinct roles.",
      });
    }

    const totalWeight = input.signers.reduce((sum, signer) => sum + signer.weight, 0);

    if (totalWeight < input.threshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Weighted validator total weight must satisfy the threshold.",
      });
    }
  });

export const walletConfigSchema = z.object({
  walletMode: walletModeSchema,
  chainId: z.number().int().positive(),
  kernelVersion: kernelVersionSchema,
  entryPointVersion: entryPointVersionSchema,
  sudoValidator: z.object({
    type: z.literal("passkey"),
    address: evmAddressSchema,
  }),
  regularValidator: weightedValidatorConfigSchema,
});

export const regularValidatorInitArtifactSchema = z.object({
  validatorAddress: evmAddressSchema,
  enableData: hexStringSchema,
  pluginEnableSignature: hexStringSchema,
});

export const ownerPublicArtifactsSchema = z.object({
  credentialId: z.string().min(1),
  publicKey: hexStringSchema,
});

export const fundingStateSchema = z.object({
  status: z.enum(["unverified", "insufficient", "verified"]),
  minimumRequiredWei: z.string().min(1),
  balanceWei: z.string().min(1).optional(),
  checkedAt: z.string().datetime({ offset: true }).optional(),
});

export const deploymentStateSchema = z.object({
  status: z.enum(["undeployed", "deployed"]),
  checkedAt: z.string().datetime({ offset: true }).optional(),
});

export const walletContextSchema = z.object({
  walletAddress: evmAddressSchema,
  chainId: z.number().int().positive(),
  kernelVersion: kernelVersionSchema,
  entryPointVersion: entryPointVersionSchema,
  owner: ownerPublicArtifactsSchema,
  agentAddress: evmAddressSchema,
  backendAddress: evmAddressSchema,
  weightedValidator: weightedValidatorConfigSchema,
});

export const walletRequestSchema = z.object({
  walletMode: walletModeSchema,
  walletId: z.string().min(1),
  status: walletRequestStatusSchema,
  walletConfig: walletConfigSchema,
  agentAddress: evmAddressSchema,
  backendAddress: evmAddressSchema,
  ownerPublicArtifacts: ownerPublicArtifactsSchema.optional(),
  regularValidatorInitArtifact: regularValidatorInitArtifactSchema.optional(),
  counterfactualWalletAddress: evmAddressSchema.optional(),
  funding: fundingStateSchema,
  deployment: deploymentStateSchema,
  walletContext: walletContextSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});

export const createWalletRequestInputSchema = z.object({
  walletMode: walletModeSchema,
  chainId: z.number().int().positive(),
  agentAddress: evmAddressSchema,
});

export const createWalletRequestResponseSchema = z.object({
  walletMode: walletModeSchema,
  walletId: z.string().min(1),
  status: walletRequestStatusSchema,
  agentAddress: evmAddressSchema,
  backendAddress: evmAddressSchema,
  walletConfig: walletConfigSchema,
  provisioningUrl: z.string().url(),
  deployment: deploymentStateSchema,
  expiresAt: z.string().datetime({ offset: true }),
  nextSteps: z.object({
    recommendedPollIntervalMs: z.number().int().positive(),
    walletAddressStatus: z.literal("owner_bound"),
    humanActionUrl: z.string().url(),
    humanAction: z.string().min(1),
    walletAddressCommand: z.string().min(1),
    statusCommand: z.string().min(1),
    awaitCommand: z.string().min(1),
    guidance: z.array(z.string().min(1)).length(4),
  }),
});

export const getWalletRequestResponseSchema = walletRequestSchema;

export const resolveProvisioningRequestSchema = z.object({
  walletId: z.string().min(1),
  token: z.string().min(1),
});

export const resolveProvisioningResponseSchema = z.object({
  walletMode: walletModeSchema,
  walletId: z.string().min(1),
  status: walletRequestStatusSchema,
  walletConfig: walletConfigSchema,
  agentAddress: evmAddressSchema,
  backendAddress: evmAddressSchema,
  ownerPublicArtifacts: ownerPublicArtifactsSchema.optional(),
  regularValidatorInitArtifact: regularValidatorInitArtifactSchema.optional(),
  counterfactualWalletAddress: evmAddressSchema.nullable(),
  funding: fundingStateSchema,
  deployment: deploymentStateSchema,
  expiresAt: z.string().datetime({ offset: true }),
});

export const publishOwnerArtifactsInputSchema = z.object({
  owner: ownerPublicArtifactsSchema,
  counterfactualWalletAddress: evmAddressSchema,
  regularValidatorInitArtifact: regularValidatorInitArtifactSchema,
});

export const localWalletRequestSchema = z
  .object({
    walletMode: walletModeSchema,
    walletId: z.string().min(1),
    backendBaseUrl: z.string().url(),
    provisioningUrl: z.string().url(),
    chainId: z.number().int().positive(),
    walletConfig: walletConfigSchema,
    agentAddress: evmAddressSchema,
    agentPrivateKey: hexStringSchema,
    backendAddress: evmAddressSchema,
    walletAddress: evmAddressSchema.optional(),
    ownerPublicArtifacts: ownerPublicArtifactsSchema.optional(),
    regularValidatorInitArtifact: regularValidatorInitArtifactSchema.optional(),
    createdAt: z.string().datetime({ offset: true }),
    lastKnownStatus: walletRequestStatusSchema,
    deployment: deploymentStateSchema.default({
      status: "undeployed",
    }),
  })
  .superRefine((input, ctx) => {
    if (input.chainId !== input.walletConfig.chainId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local wallet chainId must match walletConfig.chainId.",
      });
    }

    const agentSigner = input.walletConfig.regularValidator.signers.find(
      (signer) => signer.role === "agent",
    );
    const backendSigner = input.walletConfig.regularValidator.signers.find(
      (signer) => signer.role === "backend",
    );

    if (!agentSigner || agentSigner.address !== input.agentAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local wallet agentAddress must match the weighted validator config.",
      });
    }

    if (!backendSigner || backendSigner.address !== input.backendAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local wallet backendAddress must match the weighted validator config.",
      });
    }
  });

export const backendSignerMethodSchema = z.enum(["sign_message", "sign_typed_data"]);

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(jsonValueSchema)]),
);

export const backendSignerMessagePayloadSchema = z.object({
  message: z.union([
    z.object({
      kind: z.literal("text"),
      text: z.string(),
    }),
    z.object({
      kind: z.literal("raw"),
      raw: hexStringSchema,
    }),
  ]),
});

export const backendSignerTypedDataFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
});

export const backendSignerTypedDataPayloadSchema = z.object({
  domain: z.record(jsonValueSchema),
  types: z.record(z.array(backendSignerTypedDataFieldSchema)),
  primaryType: z.string().min(1),
  message: z.record(jsonValueSchema),
});

export const backendSignerAuthPayloadSchema = z.object({
  walletAddress: evmAddressSchema,
  backendSignerAddress: evmAddressSchema,
  method: backendSignerMethodSchema,
  bodyHash: bytes32HexSchema,
  requestId: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
});

export const backendSignerAuthEnvelopeSchema = backendSignerAuthPayloadSchema.extend({
  agentSignature: hexStringSchema,
});

export const backendSignMessageRequestSchema = z.object({
  auth: backendSignerAuthEnvelopeSchema.extend({
    method: z.literal("sign_message"),
  }),
  payload: backendSignerMessagePayloadSchema,
});

export const backendSignTypedDataRequestSchema = z.object({
  auth: backendSignerAuthEnvelopeSchema.extend({
    method: z.literal("sign_typed_data"),
  }),
  payload: backendSignerTypedDataPayloadSchema,
});

export const backendSignResponseSchema = z.object({
  signature: hexStringSchema,
});

const transitions = {
  created: ["owner_bound", "failed"],
  owner_bound: ["ready", "failed"],
  ready: [],
  failed: [],
} as const satisfies Record<WalletRequestStatus, readonly WalletRequestStatus[]>;

export function canTransitionStatus(
  from: WalletRequestStatus,
  to: WalletRequestStatus,
) {
  return (transitions[from] as readonly WalletRequestStatus[]).includes(to);
}

export function buildDefaultWalletConfig(input: {
  chainId: number;
  agentAddress: string;
  backendAddress: string;
}) {
  return walletConfigSchema.parse({
    walletMode: PROJECT_WALLET_MODE,
    chainId: input.chainId,
    kernelVersion: PROJECT_KERNEL_VERSION,
    entryPointVersion: PROJECT_ENTRY_POINT_VERSION,
    sudoValidator: {
      type: "passkey",
      address: PROJECT_PASSKEY_VALIDATOR_ADDRESS,
    },
    regularValidator: {
      type: "weighted-ecdsa",
      threshold: 2,
      delaySeconds: 0,
      signers: [
        {
          role: "agent",
          address: input.agentAddress,
          weight: 1,
        },
        {
          role: "backend",
          address: input.backendAddress,
          weight: 1,
        },
      ],
    },
  });
}

export function normalizeWalletConfig(input: z.input<typeof walletConfigSchema>) {
  return walletConfigSchema.parse(input);
}

export function getCanonicalWeightedSignerOrder(signers: WeightedSigner[]) {
  return [...signers].sort((left, right) =>
    left.address.toLowerCase() < right.address.toLowerCase() ? 1 : -1,
  );
}

function stableStringifyValue(value: JsonValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyValue).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringifyValue(nestedValue)}`)
    .join(",")}}`;
}

export function hashBackendSignerPayload(
  method: BackendSignerMethod,
  payload: BackendSignerMessagePayload | BackendSignerTypedDataPayload,
) {
  return keccak256(
    toBytes(
      stableStringifyValue({
        method,
        payload,
      }),
    ),
  );
}

export function getBackendSignerAuthorizationTypedData(
  payload: BackendSignerAuthPayload,
) {
  return {
    domain: {
      name: "Agent Wallet Backend Signer",
      version: "1",
    },
    primaryType: "BackendSignerAuthorization" as const,
    types: {
      BackendSignerAuthorization: [
        { name: "walletAddress", type: "address" },
        { name: "backendSignerAddress", type: "address" },
        { name: "method", type: "string" },
        { name: "bodyHash", type: "bytes32" },
        { name: "requestId", type: "string" },
        { name: "expiresAt", type: "string" },
      ],
    },
    message: payload,
  };
}

export type WeightedSignerRole = z.infer<typeof weightedSignerRoleSchema>;
export type WeightedSigner = z.infer<typeof weightedSignerSchema>;
export type WeightedValidatorConfig = z.infer<typeof weightedValidatorConfigSchema>;
export type WalletMode = z.infer<typeof walletModeSchema>;
export type WalletConfig = z.infer<typeof walletConfigSchema>;
export type OwnerPublicArtifacts = z.infer<typeof ownerPublicArtifactsSchema>;
export type RegularValidatorInitArtifact = z.infer<
  typeof regularValidatorInitArtifactSchema
>;
export type FundingState = z.infer<typeof fundingStateSchema>;
export type DeploymentState = z.infer<typeof deploymentStateSchema>;
export type WalletContext = z.infer<typeof walletContextSchema>;
export type WalletRequest = z.infer<typeof walletRequestSchema>;
export type CreateWalletRequestInput = z.infer<typeof createWalletRequestInputSchema>;
export type CreateWalletRequestResponse = z.infer<
  typeof createWalletRequestResponseSchema
>;
export type ResolveProvisioningResponse = z.infer<
  typeof resolveProvisioningResponseSchema
>;
export type LocalWalletRequest = z.infer<typeof localWalletRequestSchema>;
export type BackendSignerMethod = z.infer<typeof backendSignerMethodSchema>;
export type BackendSignerMessagePayload = z.infer<
  typeof backendSignerMessagePayloadSchema
>;
export type BackendSignerTypedDataPayload = z.infer<
  typeof backendSignerTypedDataPayloadSchema
>;
export type BackendSignerAuthPayload = z.infer<
  typeof backendSignerAuthPayloadSchema
>;
export type BackendSignerAuthEnvelope = z.infer<
  typeof backendSignerAuthEnvelopeSchema
>;
