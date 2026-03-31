drop table if exists wallet_requests;
drop table if exists wallet_policy_consumptions;
drop table if exists wallets;

create table wallets (
  wallet_id text primary key,
  wallet_mode text not null,
  status text not null,
  wallet_config jsonb not null,
  policy jsonb not null,
  agent_address text not null,
  backend_address text not null,
  backend_private_key text not null,
  provisioning_token_hash text not null,
  owner_public_artifacts jsonb,
  regular_validator_init_artifact jsonb,
  counterfactual_wallet_address text,
  funding jsonb not null,
  deployment jsonb not null,
  runtime_policy_state jsonb not null,
  wallet_context jsonb,
  used_signing_request_ids jsonb not null,
  error_code text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null
);

create index wallets_status_idx on wallets (status);
create index wallets_created_at_idx on wallets (created_at);
create index wallets_expires_at_idx on wallets (expires_at);

create table wallet_policy_consumptions (
  request_id text primary key,
  wallet_id text not null references wallets (wallet_id) on delete cascade,
  asset text not null,
  operation text not null,
  amount_minor text not null,
  created_at timestamptz not null
);

create index wallet_policy_consumptions_wallet_asset_created_idx
  on wallet_policy_consumptions (wallet_id, asset, created_at);
