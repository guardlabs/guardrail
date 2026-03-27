import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { walletsTable, type WalletRow } from "./db/schema.js";
import type { StoredWalletRequest, WalletRequestRepository } from "./repository.js";

function serialize(row: WalletRow): StoredWalletRequest {
  return {
    walletId: row.walletId,
    status: row.status,
    scope: row.scope,
    sessionPublicKey: row.sessionPublicKey,
    provisioningTokenHash: row.provisioningTokenHash,
    ownerPublicArtifacts: row.ownerPublicArtifacts ?? undefined,
    counterfactualWalletAddress: row.counterfactualWalletAddress ?? undefined,
    funding: row.funding,
    walletContext: row.walletContext ?? undefined,
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
        status: request.status,
        scope: request.scope,
        sessionPublicKey: request.sessionPublicKey,
        provisioningTokenHash: request.provisioningTokenHash,
        ownerPublicArtifacts: request.ownerPublicArtifacts,
        counterfactualWalletAddress: request.counterfactualWalletAddress,
        funding: request.funding,
        walletContext: request.walletContext,
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
      counterfactualWalletAddress,
      funding,
      status,
      walletContext,
      updatedAt,
    }) {
      const rows = await db
        .update(walletsTable)
        .set({
          ownerPublicArtifacts,
          counterfactualWalletAddress,
          funding,
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

    async updateFunding({ walletId, funding, status, updatedAt }) {
      const rows = await db
        .update(walletsTable)
        .set({
          funding,
          status,
          updatedAt: new Date(updatedAt),
        })
        .where(eq(walletsTable.walletId, walletId))
        .returning();

      const row = rows[0];
      return row ? serialize(row) : null;
    },
  };
}
