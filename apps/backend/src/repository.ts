import type {
  OwnerPublicArtifacts,
  RegularValidatorInitArtifact,
  WalletConfig,
  WalletContext,
  WalletRequest,
} from "@conduit/shared";

export type StoredWalletRequest = WalletRequest & {
  provisioningTokenHash: string;
  backendPrivateKey: string;
  usedSigningRequestIds: string[];
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
  recordUsedSigningRequestId(input: {
    walletId: string;
    requestId: string;
    updatedAt: string;
  }): Promise<"ok" | "duplicate" | "not_found">;
};

export function toPublicWalletRequest(request: StoredWalletRequest): WalletRequest {
  const {
    provisioningTokenHash: _tokenHash,
    backendPrivateKey: _backendPrivateKey,
    usedSigningRequestIds: _usedSigningRequestIds,
    ...publicRequest
  } = request;
  return publicRequest;
}
