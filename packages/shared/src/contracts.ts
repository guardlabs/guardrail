import { z } from "zod";

export const PROJECT_DEFAULT_BACKEND_URL = "http://127.0.0.1:3000";
export const PROJECT_DEFAULT_FRONTEND_URL = "http://127.0.0.1:5173";

export const walletRequestStatusSchema = z.enum([
  "created",
  "owner_bound",
  "ready",
  "failed",
]);

export type WalletRequestStatus = z.infer<typeof walletRequestStatusSchema>;

export const selectorSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{8}$/, "Allowed methods must be 4-byte selectors");

export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb" as const;

export const hexStringSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/, "Expected a 0x-prefixed hex string");

export const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected a 20-byte EVM address");

export const baseUnitsStringSchema = z
  .string()
  .regex(/^[0-9]+$/, "Expected a base-10 integer string");

export const spendLimitPeriodSchema = z.enum(["day", "week", "month"]);

export const spendLimitSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("erc20"),
    tokenAddress: evmAddressSchema,
    limitBaseUnits: baseUnitsStringSchema,
    period: spendLimitPeriodSchema,
  }),
  z.object({
    type: z.literal("native"),
    limitBaseUnits: baseUnitsStringSchema,
    period: spendLimitPeriodSchema,
  }),
]);

function dedupeSelectors(selectors: string[]) {
  return [...new Set(selectors)];
}

export const permissionScopeSchema = z
  .object({
    chainId: z.number().int().positive(),
    targetContract: evmAddressSchema,
    allowedMethods: z.array(selectorSchema).min(1),
    spendLimits: z.array(spendLimitSchema).max(1).optional(),
  })
  .transform((scope) => ({
    ...scope,
    allowedMethods: dedupeSelectors(scope.allowedMethods),
  }));

export const ownerPublicArtifactsSchema = z.object({
  credentialId: z.string().min(1),
  publicKey: hexStringSchema,
});

export const fundingStateSchema = z.object({
  status: z.enum(["unverified", "insufficient", "verified"]),
  minimumRequiredWei: z.string().min(1),
  balanceWei: z.string().min(1).optional(),
  checkedAt: z.string().min(1).optional(),
});

export const walletContextSchema = z.object({
  walletAddress: evmAddressSchema,
  chainId: z.number().int().positive(),
  kernelVersion: z.string().min(1),
  sessionPublicKey: hexStringSchema,
  owner: ownerPublicArtifactsSchema,
  scope: permissionScopeSchema,
  policyDigest: hexStringSchema,
  serializedPermissionAccount: z.string().min(1),
});

export const walletRequestSchema = z.object({
  walletId: z.string().min(1),
  status: walletRequestStatusSchema,
  scope: permissionScopeSchema,
  sessionPublicKey: hexStringSchema,
  ownerPublicArtifacts: ownerPublicArtifactsSchema.optional(),
  counterfactualWalletAddress: evmAddressSchema.optional(),
  funding: fundingStateSchema,
  walletContext: walletContextSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  expiresAt: z.string().min(1),
});

export const createWalletRequestInputSchema = z.object({
  chainId: z.number().int().positive(),
  targetContract: evmAddressSchema,
  allowedMethods: z.array(selectorSchema).min(1).transform(dedupeSelectors),
  spendLimits: z.array(spendLimitSchema).max(1).optional(),
  sessionPublicKey: hexStringSchema,
});

export const createWalletRequestResponseSchema = z.object({
  walletId: z.string().min(1),
  status: walletRequestStatusSchema,
  provisioningUrl: z.string().url(),
  expiresAt: z.string().min(1),
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
  walletId: z.string().min(1),
  status: walletRequestStatusSchema,
  scope: permissionScopeSchema,
  sessionPublicKey: hexStringSchema,
  ownerPublicArtifacts: ownerPublicArtifactsSchema.optional(),
  counterfactualWalletAddress: evmAddressSchema.nullable(),
  funding: fundingStateSchema,
  expiresAt: z.string().min(1),
});

export const publishOwnerArtifactsInputSchema = z.object({
  owner: ownerPublicArtifactsSchema,
  counterfactualWalletAddress: evmAddressSchema,
  serializedPermissionAccount: z.string().min(1),
});

export const localWalletRequestSchema = z.object({
  walletId: z.string().min(1),
  backendBaseUrl: z.string().url(),
  provisioningUrl: z.string().url(),
  chainId: z.number().int().positive(),
  targetContract: evmAddressSchema,
  allowedMethods: z.array(selectorSchema).min(1),
  spendLimits: z.array(spendLimitSchema).max(1).optional(),
  sessionPublicKey: hexStringSchema,
  sessionPrivateKey: hexStringSchema,
  walletAddress: evmAddressSchema.optional(),
  serializedPermissionAccount: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  lastKnownStatus: walletRequestStatusSchema,
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

export function normalizePermissionScope(
  input: z.input<typeof permissionScopeSchema>,
) {
  return permissionScopeSchema.parse(input);
}

export function toSpendLimitPeriodSeconds(period: SpendLimitPeriod) {
  switch (period) {
    case "day":
      return 86_400;
    case "week":
      return 604_800;
    case "month":
      return 2_592_000;
  }
}

export function getSpendLimitScopeValidationErrors(
  scope: PermissionScope,
) {
  if (!scope.spendLimits?.length) {
    return [];
  }

  const [spendLimit] = scope.spendLimits;
  const errors: string[] = [];

  if (!spendLimit) {
    return errors;
  }

  if (spendLimit.type === "native") {
    errors.push("Native spend limits are not supported yet.");
    return errors;
  }

  if (
    scope.targetContract.toLowerCase() !== spendLimit.tokenAddress.toLowerCase()
  ) {
    errors.push("Spend-limited ERC20 scopes must target the limited token contract.");
  }

  if (
    scope.allowedMethods.length !== 1 ||
    scope.allowedMethods[0]?.toLowerCase() !== ERC20_TRANSFER_SELECTOR
  ) {
    errors.push(
      "ERC20 spend-limited scopes must allow only transfer(address,uint256).",
    );
  }

  return errors;
}

export type PermissionScope = z.infer<typeof permissionScopeSchema>;
export type SpendLimit = z.infer<typeof spendLimitSchema>;
export type SpendLimitPeriod = z.infer<typeof spendLimitPeriodSchema>;
export type OwnerPublicArtifacts = z.infer<typeof ownerPublicArtifactsSchema>;
export type FundingState = z.infer<typeof fundingStateSchema>;
export type WalletContext = z.infer<typeof walletContextSchema>;
export type WalletRequest = z.infer<typeof walletRequestSchema>;
export type CreateWalletRequestInput = z.infer<
  typeof createWalletRequestInputSchema
>;
export type CreateWalletRequestResponse = z.infer<
  typeof createWalletRequestResponseSchema
>;
export type GetWalletRequestResponse = z.infer<
  typeof getWalletRequestResponseSchema
>;
export type ResolveProvisioningResponse = z.infer<
  typeof resolveProvisioningResponseSchema
>;
export type PublishOwnerArtifactsInput = z.infer<
  typeof publishOwnerArtifactsInputSchema
>;
export type LocalWalletRequest = z.infer<typeof localWalletRequestSchema>;
