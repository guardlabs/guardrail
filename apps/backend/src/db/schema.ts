import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type {
  DeploymentState,
  FundingState,
  OwnerPublicArtifacts,
  RegularValidatorInitArtifact,
  WalletConfig,
  WalletContext,
  WalletMode,
  WalletRequestStatus,
} from "@conduit/shared";

export const walletsTable = pgTable("wallets", {
  walletId: text("wallet_id").primaryKey(),
  walletMode: text("wallet_mode").$type<WalletMode>().notNull(),
  status: text("status").$type<WalletRequestStatus>().notNull(),
  walletConfig: jsonb("wallet_config").$type<WalletConfig>().notNull(),
  agentAddress: text("agent_address").notNull(),
  backendAddress: text("backend_address").notNull(),
  backendPrivateKey: text("backend_private_key").notNull(),
  provisioningTokenHash: text("provisioning_token_hash").notNull(),
  ownerPublicArtifacts: jsonb("owner_public_artifacts").$type<OwnerPublicArtifacts>(),
  regularValidatorInitArtifact: jsonb("regular_validator_init_artifact").$type<RegularValidatorInitArtifact>(),
  counterfactualWalletAddress: text("counterfactual_wallet_address"),
  funding: jsonb("funding").$type<FundingState>().notNull(),
  deployment: jsonb("deployment").$type<DeploymentState>().notNull(),
  walletContext: jsonb("wallet_context").$type<WalletContext>(),
  usedSigningRequestIds: jsonb("used_signing_request_ids").$type<string[]>().notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type WalletRow = typeof walletsTable.$inferSelect;
