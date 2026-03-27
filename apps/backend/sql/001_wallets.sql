alter table if exists wallet_requests rename to wallets;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'wallets'
      and column_name = 'id'
  ) then
    alter table wallets rename column id to wallet_id;
  end if;
end
$$;

create table if not exists wallets (
  wallet_id text primary key,
  status text not null,
  scope jsonb not null,
  session_public_key text not null,
  provisioning_token_hash text not null,
  owner_public_artifacts jsonb,
  counterfactual_wallet_address text,
  funding jsonb not null,
  wallet_context jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists wallets_status_idx on wallets (status);
create index if not exists wallets_created_at_idx on wallets (created_at);
create index if not exists wallets_expires_at_idx on wallets (expires_at);
