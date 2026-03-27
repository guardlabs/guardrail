import type {
  OwnerPublicArtifacts,
  WalletContext,
  WalletRequest,
} from "@agent-wallet/shared";

export type StoredWalletRequest = WalletRequest & {
  provisioningTokenHash: string;
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
    counterfactualWalletAddress: string;
    funding: WalletRequest["funding"];
    status: Extract<WalletRequest["status"], "owner_bound" | "ready">;
    walletContext?: WalletContext;
    updatedAt: string;
  }): Promise<StoredWalletRequest | null>;
  updateFunding(input: {
    walletId: string;
    funding: WalletRequest["funding"];
    status: Extract<WalletRequest["status"], "owner_bound" | "ready">;
    updatedAt: string;
  }): Promise<StoredWalletRequest | null>;
};

export function toPublicWalletRequest(request: StoredWalletRequest): WalletRequest {
  const { provisioningTokenHash: _tokenHash, ...publicRequest } = request;
  return publicRequest;
}
