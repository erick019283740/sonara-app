-- Financial-Grade Earnings Ledger System
-- Immutable, append-only ledger with payout locking

-- Earnings Ledger (immutable transaction log)
create table if not exists public.earnings_ledger (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete cascade,
  transaction_type text not null check (transaction_type in ('stream', 'donation', 'payout', 'adjustment', 'refund')),
  amount numeric(14,4) not null check (amount > 0),
  currency text not null default 'USD',
  source_id uuid,
  source_metadata jsonb,
  status text not null default 'pending' check (status in ('pending', 'posted', 'settled', 'reversed')),
  transaction_id text not null unique,
  ledger_version int not null default 1,
  posted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text default 'system'
);

create index if not exists idx_earnings_ledger_artist on public.earnings_ledger(artist_id, created_at desc);
create index if not exists idx_earnings_ledger_status on public.earnings_ledger(status, created_at);
create index if not exists idx_earnings_ledger_transaction_id on public.earnings_ledger(transaction_id);
create index if not exists idx_earnings_ledger_type on public.earnings_ledger(transaction_type);
create index if not exists idx_earnings_ledger_posted on public.earnings_ledger(posted_at desc);

-- Audit Ledger (immutable audit trail)
create table if not exists public.audit_ledger (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('create', 'update', 'delete', 'approve', 'reject')),
  old_values jsonb,
  new_values jsonb,
  actor_id uuid,
  actor_role text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_entity on public.audit_ledger(entity_type, entity_id);
create index if not exists idx_audit_action on public.audit_ledger(action, created_at);

-- Payout Locks (prevent double payouts)
create table if not exists public.payout_locks (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_amount numeric(14,4) not null,
  status text not null default 'locked' check (status in ('locked', 'processing', 'paid', 'failed', 'reverted')),
  payout_method text,
  external_payout_id text,
  processed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(artist_id, period_start, period_end)
);

create index if not exists idx_payout_locks_artist on public.payout_locks(artist_id);
create index if not exists idx_payout_locks_status on public.payout_locks(status);
create index if not exists idx_payout_locks_period on public.payout_locks(period_start, period_end);

-- Monthly Earnings Summary (aggregated)
create table if not exists public.earnings_monthly_summary (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete cascade,
  year int not null,
  month int not null,
  total_streams int not null default 0,
  total_stream_earnings numeric(14,4) not null default 0,
  total_donations numeric(14,4) not null default 0,
  total_adjustments numeric(14,4) not null default 0,
  gross_earnings numeric(14,4) not null default 0,
  platform_fee numeric(14,4) not null default 0,
  net_earnings numeric(14,4) not null default 0,
  payout_status text default 'pending' check (payout_status in ('pending', 'processing', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(artist_id, year, month)
);

create index if not exists idx_monthly_artist on public.earnings_monthly_summary(artist_id);
create index if not exists idx_monthly_period on public.earnings_monthly_summary(year, month);

-- Platform Earnings (separate tracking)
create table if not exists public.platform_earnings (
  id uuid primary key default gen_random_uuid(),
  amount numeric(14,4) not null,
  currency text not null default 'USD',
  source_type text not null check (source_type in ('stream', 'donation', 'subscription', 'advertising')),
  source_id uuid,
  period_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_source on public.platform_earnings(source_type, created_at);
create index if not exists idx_platform_period on public.platform_earnings(period_date);
