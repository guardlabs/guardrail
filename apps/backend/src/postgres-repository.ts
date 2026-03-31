import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { walletsTable, type WalletRow } from "./db/schema.js";
import type { StoredWalletRequest, WalletRequestRepository } from "./repository.js";

function serialize(row: WalletRow): StoredWalletRequest {
  return {
    walletId: row.walletId,
    walletMode: row.walletMode,
    status: row.status,
    walletConfig: row.walletConfig,
    policy: row.policy,
    agentAddress: row.agentAddress,
    backendAddress: row.backendAddress,
    provisioningTokenHash: row.provisioningTokenHash,
    backendPrivateKey: row.backendPrivateKey,
    ownerPublicArtifacts: row.ownerPublicArtifacts ?? undefined,
    regularValidatorInitArtifact: row.regularValidatorInitArtifact ?? undefined,
    counterfactualWalletAddress: row.counterfactualWalletAddress ?? undefined,
    funding: row.funding,
    deployment: row.deployment,
    runtimePolicyState: row.runtimePolicyState,
    walletContext: row.walletContext ?? undefined,
    usedSigningRequestIds: row.usedSigningRequestIds,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export function createPostgresWalletRequestRepository(
  connectionString: string,
): WalletRequestRepository {
  const pool = new Pool({
    connectionString,
  });
  const db = drizzle(pool);

  return {
    async create(request) {
      await db.insert(walletsTable).values({
        walletId: request.walletId,
        walletMode: request.walletMode,
        status: request.status,
        walletConfig: request.walletConfig,
        policy: request.policy,
        agentAddress: request.agentAddress,
        backendAddress: request.backendAddress,
        backendPrivateKey: request.backendPrivateKey,
        provisioningTokenHash: request.provisioningTokenHash,
        ownerPublicArtifacts: request.ownerPublicArtifacts,
        regularValidatorInitArtifact: request.regularValidatorInitArtifact,
        counterfactualWalletAddress: request.counterfactualWalletAddress,
        funding: request.funding,
        deployment: request.deployment,
        runtimePolicyState: request.runtimePolicyState,
        walletContext: request.walletContext,
        usedSigningRequestIds: request.usedSigningRequestIds,
        errorCode: request.errorCode,
        errorMessage: request.errorMessage,
        createdAt: new Date(request.createdAt),
        updatedAt: new Date(request.updatedAt),
        expiresAt: new Date(request.expiresAt),
      });
    },

    async findById(walletId) {
      const rows = await db
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.walletId, walletId))
        .limit(1);

      const row = rows[0];

      return row ? serialize(row) : null;
    },

    async findByIdAndTokenHash(walletId, provisioningTokenHash) {
      const rows = await db
        .select()
        .from(walletsTable)
        .where(
          and(
            eq(walletsTable.walletId, walletId),
            eq(walletsTable.provisioningTokenHash, provisioningTokenHash),
          ),
        )
        .limit(1);

      const row = rows[0];

      return row ? serialize(row) : null;
    },

    async updateProvisioning({
      walletId,
      provisioningTokenHash,
      ownerPublicArtifacts,
      regularValidatorInitArtifact,
      counterfactualWalletAddress,
      funding,
      deployment,
      status,
      walletContext,
      updatedAt,
    }) {
      const rows = await db
        .update(walletsTable)
        .set({
          ownerPublicArtifacts,
          regularValidatorInitArtifact,
          counterfactualWalletAddress,
          funding,
          deployment,
          status,
          walletContext,
          updatedAt: new Date(updatedAt),
        })
        .where(
          and(
            eq(walletsTable.walletId, walletId),
            eq(walletsTable.provisioningTokenHash, provisioningTokenHash),
          ),
        )
        .returning();

      const row = rows[0];
      return row ? serialize(row) : null;
    },

    async updateFunding({ walletId, funding, deployment, status, walletContext, updatedAt }) {
      const rows = await db
        .update(walletsTable)
        .set({
          funding,
          deployment,
          status,
          walletContext,
          updatedAt: new Date(updatedAt),
        })
        .where(eq(walletsTable.walletId, walletId))
        .returning();

      const row = rows[0];
      return row ? serialize(row) : null;
    },

    async recordUsedSigningRequestId({ walletId, requestId, updatedAt }) {
      const current = await this.findById(walletId);

      if (!current) {
        return "not_found";
      }

      if (current.usedSigningRequestIds.includes(requestId)) {
        return "duplicate";
      }

      await db
        .update(walletsTable)
        .set({
          usedSigningRequestIds: [...current.usedSigningRequestIds, requestId],
          updatedAt: new Date(updatedAt),
        })
        .where(eq(walletsTable.walletId, walletId));

      return "ok";
    },

    async updateRuntimePolicyState({ walletId, runtimePolicyState, updatedAt }) {
      const rows = await db
        .update(walletsTable)
        .set({
          runtimePolicyState,
          updatedAt: new Date(updatedAt),
        })
        .where(eq(walletsTable.walletId, walletId))
        .returning();

      const row = rows[0];
      return row ? serialize(row) : null;
    },
  };
}
