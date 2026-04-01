import type {
  BackendSignerMethod,
  OwnerPublicArtifacts,
  RegularValidatorInitArtifact,
  WalletContext,
  WalletRequest,
} from "@conduit/shared";

export type RuntimePolicyState = {
  usdc: {
    periodStartedAt: string;
    consumedAmountMinor: string;
  } | null;
};

export type RuntimePolicyConsumption = {
  walletId: string;
  asset: "usdc";
  operation: string;
  amountMinor: string;
  requestId: string;
  createdAt: string;
};

export type StoredWalletRequest = WalletRequest & {
  provisioningTokenHash: string;
  backendPrivateKey: string;
  runtimePolicyState: RuntimePolicyState;
};

export type WalletRequestRepository = {
  create(request: StoredWalletRequest): Promise<void>;
  findById(walletId: string): Promise<StoredWalletRequest | null>;
  findByIdAndTokenHash(
    walletId: string,
    provisioningTokenHash: string,
  ): Promise<StoredWalletRequest | null>;
  updateProvisioning(input: {
    walletId: string;
    provisioningTokenHash: string;
    ownerPublicArtifacts: OwnerPublicArtifacts;
    regularValidatorInitArtifact: RegularValidatorInitArtifact;
    counterfactualWalletAddress: string;
    funding: WalletRequest["funding"];
    deployment: WalletRequest["deployment"];
    status: Extract<WalletRequest["status"], "owner_bound" | "ready">;
    walletContext?: WalletContext;
    updatedAt: string;
  }): Promise<StoredWalletRequest | null>;
  updateFunding(input: {
    walletId: string;
    funding: WalletRequest["funding"];
    deployment: WalletRequest["deployment"];
    status: Extract<WalletRequest["status"], "owner_bound" | "ready">;
    walletContext?: WalletContext;
    updatedAt: string;
  }): Promise<StoredWalletRequest | null>;
  runBackendSigningOperation<T>(input: {
    walletId: string;
    requestId: string;
    method: BackendSignerMethod;
    createdAt: string;
    updatedAt: string;
    consumption?: RuntimePolicyConsumption;
    handler: () => Promise<T>;
  }): Promise<
    | { status: "ok"; result: T }
    | { status: "duplicate" | "not_found" }
  >;
  updateRuntimePolicyState(input: {
    walletId: string;
    runtimePolicyState: RuntimePolicyState;
    updatedAt: string;
  }): Promise<StoredWalletRequest | null>;
  listRuntimePolicyConsumptionsSince(input: {
    walletId: string;
    asset: RuntimePolicyConsumption["asset"];
    createdAtGte: string;
  }): Promise<RuntimePolicyConsumption[]>;
  createRuntimePolicyConsumption(
    input: RuntimePolicyConsumption,
  ): Promise<void>;
};

export function toPublicWalletRequest(
  request: StoredWalletRequest,
): WalletRequest {
  const {
    provisioningTokenHash: _tokenHash,
    backendPrivateKey: _backendPrivateKey,
    runtimePolicyState: _runtimePolicyState,
    ...publicRequest
  } = request;
  return publicRequest;
}
