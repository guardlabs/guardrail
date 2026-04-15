import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type {
  DeploymentState,
  FundingState,
  OwnerPublicArtifacts,
  RegularValidatorInitArtifact,
  WalletConfig,
  WalletContext,
  WalletMode,
  WalletPolicy,
  WalletRequestStatus,
} from "@guardlabs/guardrail-core";
import type {
  RuntimePolicyConsumption,
  RuntimePolicyState,
} from "../repository.js";

export const walletsTable = pgTable(
  "wallets",
  {
    walletId: text("wallet_id").primaryKey(),
    walletMode: text("wallet_mode").$type<WalletMode>().notNull(),
    status: text("status").$type<WalletRequestStatus>().notNull(),
    walletConfig: jsonb("wallet_config").$type<WalletConfig>().notNull(),
    policy: jsonb("policy").$type<WalletPolicy>().notNull(),
    agentAddress: text("agent_address").notNull(),
    backendAddress: text("backend_address").notNull(),
    backendPrivateKey: text("backend_private_key").notNull(),
    ownerPublicArtifacts: jsonb(
      "owner_public_artifacts",
    ).$type<OwnerPublicArtifacts>(),
    regularValidatorInitArtifact: jsonb(
      "regular_validator_init_artifact",
    ).$type<RegularValidatorInitArtifact>(),
    counterfactualWalletAddress: text("counterfactual_wallet_address"),
    funding: jsonb("funding").$type<FundingState>().notNull(),
    deployment: jsonb("deployment").$type<DeploymentState>().notNull(),
    runtimePolicyState: jsonb("runtime_policy_state")
      .$type<RuntimePolicyState>()
      .notNull(),
    walletContext: jsonb("wallet_context").$type<WalletContext>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    statusIndex: index("wallets_status_idx").on(table.status),
    createdAtIndex: index("wallets_created_at_idx").on(table.createdAt),
    expiresAtIndex: index("wallets_expires_at_idx").on(table.expiresAt),
  }),
);

export type WalletRow = typeof walletsTable.$inferSelect;

export const walletPolicyConsumptionsTable = pgTable(
  "wallet_policy_consumptions",
  {
    requestId: text("request_id").primaryKey(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => walletsTable.walletId, {
        onDelete: "cascade",
      }),
    asset: text("asset").$type<RuntimePolicyConsumption["asset"]>().notNull(),
    operation: text("operation").notNull(),
    amountMinor: text("amount_minor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    walletAssetCreatedAtIndex: index(
      "wallet_policy_consumptions_wallet_asset_created_idx",
    ).on(table.walletId, table.asset, table.createdAt),
  }),
);

export type WalletPolicyConsumptionRow =
  typeof walletPolicyConsumptionsTable.$inferSelect;

export const walletBackendSigningRequestsTable = pgTable(
  "wallet_backend_signing_requests",
  {
    requestId: text("request_id").primaryKey(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => walletsTable.walletId, {
        onDelete: "cascade",
      }),
    method: text("method").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    walletCreatedAtIndex: index(
      "wallet_backend_signing_requests_wallet_created_idx",
    ).on(table.walletId, table.createdAt),
  }),
);
