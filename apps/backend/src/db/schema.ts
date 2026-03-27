import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type {
  FundingState,
  OwnerPublicArtifacts,
  PermissionScope,
  WalletContext,
  WalletRequestStatus,
} from "@agent-wallet/shared";

export const walletsTable = pgTable("wallets", {
  walletId: text("wallet_id").primaryKey(),
  status: text("status").$type<WalletRequestStatus>().notNull(),
  scope: jsonb("scope").$type<PermissionScope>().notNull(),
  sessionPublicKey: text("session_public_key").notNull(),
  provisioningTokenHash: text("provisioning_token_hash").notNull(),
  ownerPublicArtifacts: jsonb("owner_public_artifacts").$type<OwnerPublicArtifacts>(),
  counterfactualWalletAddress: text("counterfactual_wallet_address"),
  funding: jsonb("funding").$type<FundingState>().notNull(),
  walletContext: jsonb("wallet_context").$type<WalletContext>(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type WalletRow = typeof walletsTable.$inferSelect;
