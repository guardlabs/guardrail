CREATE TABLE "wallet_backend_signing_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_policy_consumptions" (
	"request_id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"asset" text NOT NULL,
	"operation" text NOT NULL,
	"amount_minor" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"wallet_id" text PRIMARY KEY NOT NULL,
	"wallet_mode" text NOT NULL,
	"status" text NOT NULL,
	"wallet_config" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"agent_address" text NOT NULL,
	"backend_address" text NOT NULL,
	"backend_private_key" text NOT NULL,
	"provisioning_token_hash" text NOT NULL,
	"owner_public_artifacts" jsonb,
	"regular_validator_init_artifact" jsonb,
	"counterfactual_wallet_address" text,
	"funding" jsonb NOT NULL,
	"deployment" jsonb NOT NULL,
	"runtime_policy_state" jsonb NOT NULL,
	"wallet_context" jsonb,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_backend_signing_requests" ADD CONSTRAINT "wallet_backend_signing_requests_wallet_id_wallets_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("wallet_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_policy_consumptions" ADD CONSTRAINT "wallet_policy_consumptions_wallet_id_wallets_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("wallet_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_backend_signing_requests_wallet_created_idx" ON "wallet_backend_signing_requests" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_policy_consumptions_wallet_asset_created_idx" ON "wallet_policy_consumptions" USING btree ("wallet_id","asset","created_at");--> statement-breakpoint
CREATE INDEX "wallets_status_idx" ON "wallets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wallets_created_at_idx" ON "wallets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wallets_expires_at_idx" ON "wallets" USING btree ("expires_at");