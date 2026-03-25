import { z } from "zod";

export const PROJECT_DEFAULT_BACKEND_URL = "https://agent-wallet.example.com";

export const walletRequestStatusSchema = z.enum([
  "created",
  "link_opened",
  "owner_bound",
  "funded",
  "ready",
  "activated",
  "failed",
]);

export type WalletRequestStatus = z.infer<typeof walletRequestStatusSchema>;

export const selectorSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{8}$/, "Allowed methods must be 4-byte selectors");

export const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected a 20-byte EVM address");

function dedupeSelectors(selectors: string[]) {
  return [...new Set(selectors)];
}

export const permissionScopeSchema = z
  .object({
    chainId: z.number().int().positive(),
    targetContract: evmAddressSchema,
    allowedMethods: z.array(selectorSchema).min(1),
  })
  .transform((scope) => ({
    ...scope,
    allowedMethods: dedupeSelectors(scope.allowedMethods),
  }));

export const ownerPublicArtifactsSchema = z.object({
  ownerType: z.literal("passkey"),
  credentialId: z.string().min(1),
  credentialPublicKey: z.string().min(1),
  ownerIdentifier: z.string().min(1),
  attestationFormat: z.string().min(1).optional(),
});

export const fundingStateSchema = z.object({
  status: z.enum(["unverified", "insufficient", "verified"]),
  balanceWei: z.string().min(1).optional(),
  checkedAt: z.string().min(1).optional(),
});

export const walletContextSchema = z.object({
  walletAddress: evmAddressSchema,
  chainId: z.number().int().positive(),
  kernelVersion: z.string().min(1),
  sessionPublicKey: z.string().min(1),
  owner: ownerPublicArtifactsSchema,
  scope: permissionScopeSchema,
  policyDigest: z.string().min(1),
  activationState: z.enum(["counterfactual", "ready", "activated"]),
});

export const walletRequestSchema = z.object({
  id: z.string().min(1),
  status: walletRequestStatusSchema,
  scope: permissionScopeSchema,
  sessionPublicKey: z.string().min(1),
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
  sessionPublicKey: z.string().min(1),
});

const transitions = {
  created: ["link_opened", "failed"],
  link_opened: ["owner_bound", "failed"],
  owner_bound: ["funded", "failed"],
  funded: ["ready", "failed"],
  ready: ["activated", "failed"],
  activated: [],
  failed: [],
} as const satisfies Record<WalletRequestStatus, readonly WalletRequestStatus[]>;

export function canTransitionStatus(
  from: WalletRequestStatus,
  to: WalletRequestStatus,
) {
  return (transitions[from] as readonly WalletRequestStatus[]).includes(to);
}

export function normalizePermissionScope(input: z.input<typeof permissionScopeSchema>) {
  return permissionScopeSchema.parse(input);
}

export type PermissionScope = z.infer<typeof permissionScopeSchema>;
export type OwnerPublicArtifacts = z.infer<typeof ownerPublicArtifactsSchema>;
export type FundingState = z.infer<typeof fundingStateSchema>;
export type WalletContext = z.infer<typeof walletContextSchema>;
export type WalletRequest = z.infer<typeof walletRequestSchema>;
export type CreateWalletRequestInput = z.infer<typeof createWalletRequestInputSchema>;
