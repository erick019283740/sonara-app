-- SONARA Fraud Detection System Schema
-- Migration 004: Create tables for comprehensive fraud detection and abuse prevention

begin;

-- 1. FRAUD CLUSTERS
-- Tracks coordinated abuse patterns across multiple users
create table if not exists public.fraud_clusters (
  id uuid primary key default gen_random_uuid(),
  cluster_key text not null unique,
  seed_user_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  shared_ip_count int not null default 0 check (shared_ip_count >= 0),
  shared_device_count int not null default 0 check (shared_device_count >= 0),
  user_count int not null default 0 check (user_count >= 0),
  cluster_score numeric(5,2) not null default 0 check (cluster_score >= 0 and cluster_score <= 100),
  status text not null default 'active' check (status in ('active', 'investigating', 'resolved', 'false_positive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fraud_clusters_key on public.fraud_clusters(cluster_key);
create index if not exists idx_fraud_clusters_artist on public.fraud_clusters(artist_id);
create index if not exists idx_fraud_clusters_song on public.fraud_clusters(song_id);
create index if not exists idx_fraud_clusters_status on public.fraud_clusters(status);
create index if not exists idx_fraud_clusters_score on public.fraud_clusters(cluster_score desc);

-- 2. ANOMALY LOGS
-- Logs all detected anomalies for audit trail
create table if not exists public.anomaly_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  session_id text,
  device_id text,
  ip_fingerprint text,
  anomaly_score numeric(5,2) not null default 0 check (anomaly_score >= 0 and anomaly_score <= 100),
  graph_score numeric(5,2) not null default 0 check (graph_score >= 0 and graph_score <= 100),
  risk_score numeric(5,2) not null default 0 check (risk_score >= 0 and risk_score <= 100),
  reasons text[] not null default array[]::text[],
  severity text not null default 'low' check (severity in ('low', 'medium', 'high')),
  cluster_id uuid references public.fraud_clusters(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_anomaly_logs_user on public.anomaly_logs(user_id, created_at desc);
create index if not exists idx_anomaly_logs_song on public.anomaly_logs(song_id, created_at desc);
create index if not exists idx_anomaly_logs_artist on public.anomaly_logs(artist_id, created_at desc);
create index if not exists idx_anomaly_logs_severity on public.anomaly_logs(severity, created_at desc);
create index if not exists idx_anomaly_logs_risk on public.anomaly_logs(risk_score desc, created_at desc);
create index if not exists idx_anomaly_logs_cluster on public.anomaly_logs(cluster_id);

-- 3. SUSPICIOUS USERS
-- Tracks users flagged for suspicious activity
create table if not exists public.suspicious_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  max_risk_score numeric(5,2) not null default 0 check (max_risk_score >= 0 and max_risk_score <= 100),
  last_risk_score numeric(5,2) not null default 0 check (last_risk_score >= 0 and last_risk_score <= 100),
  flag_count int not null default 0 check (flag_count >= 0),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high')),
  reasons text[] not null default array[]::text[],
  status text not null default 'flagged' check (status in ('flagged', 'blocked', 'cleared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_suspicious_users_status on public.suspicious_users(status);
create index if not exists idx_suspicious_users_risk on public.suspicious_users(max_risk_score desc);
create index if not exists idx_suspicious_users_severity on public.suspicious_users(severity);

-- 4. ABUSE EVENTS
-- High-priority abuse events requiring investigation
create table if not exists public.abuse_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('stream_abuse', 'cluster_detected', 'geo_anomaly', 'payout_abuse')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid references public.songs(id) on delete cascade,
  artist_id uuid references public.artists(id) on delete cascade,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  risk_score numeric(5,2) not null default 0 check (risk_score >= 0 and risk_score <= 100),
  reasons text[] not null default array[]::text[],
  cluster_id uuid references public.fraud_clusters(id) on delete set null,
  metadata jsonb,
  state text not null default 'open' check (state in ('open', 'investigating', 'resolved', 'false_positive')),
  created_at timestamptz not null default now()
);

create index if not exists idx_abuse_events_type on public.abuse_events(event_type, created_at desc);
create index if not exists idx_abuse_events_state on public.abuse_events(state, created_at desc);
create index if not exists idx_abuse_events_severity on public.abuse_events(severity, created_at desc);
create index if not exists idx_abuse_events_user on public.abuse_events(user_id, created_at desc);

-- 5. USER GEO HISTORY
-- Tracks user geographic patterns for anomaly detection
create table if not exists public.user_geo_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  country_code text(2),
  city text,
  latitude numeric,
  longitude numeric,
  ip_address text,
  ip_fingerprint text,
  observed_at timestamptz not null default now()
);

create index if not exists idx_user_geo_history_user on public.user_geo_history(user_id, observed_at desc);
create index if not exists idx_user_geo_history_ip on public.user_geo_history(ip_fingerprint, observed_at desc);
create index if not exists idx_user_geo_history_country on public.user_geo_history(country_code, observed_at desc);

-- 6. GEO FLAGS
-- Flags for geographic anomalies
create table if not exists public.geo_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ip_fingerprint text,
  country_code text(2),
  flag_type text not null check (flag_type in ('blocked_country', 'location_jump', 'unrealistic_travel')),
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_geo_flags_user on public.geo_flags(user_id, created_at desc);
create index if not exists idx_geo_flags_type on public.geo_flags(flag_type, created_at desc);
create index if not exists idx_geo_flags_country on public.geo_flags(country_code, created_at desc);

-- 7. STREAM FRAUD FLAGS
-- Detailed fraud flags for individual stream events
create table if not exists public.stream_fraud_flags (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  flags text[] not null default array[]::text[],
  risk_score numeric(5,2) not null default 0 check (risk_score >= 0 and risk_score <= 100),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_stream_fraud_flags_stream on public.stream_fraud_flags(stream_id);
create index if not exists idx_stream_fraud_flags_user on public.stream_fraud_flags(user_id, created_at desc);
create index if not exists idx_stream_fraud_flags_song on public.stream_fraud_flags(song_id, created_at desc);
create index if not exists idx_stream_fraud_flags_risk on public.stream_fraud_flags(risk_score desc, created_at desc);

-- 8. STREAM DAILY LIMITS
-- Enforces max 10 streams per user per song per day
create table if not exists public.stream_daily_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  stream_count int not null default 0 check (stream_count >= 0 and stream_count <= 10),
  last_stream_date date not null default current_date,
  unique(user_id, song_id, last_stream_date)
);

create index if not exists idx_stream_daily_limits_user_song on public.stream_daily_limits(user_id, song_id, last_stream_date);
create index if not exists idx_stream_daily_limits_date on public.stream_daily_limits(last_stream_date);

-- Updated-at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply updated_at triggers
drop trigger if exists trg_fraud_clusters_updated_at on public.fraud_clusters;
create trigger trg_fraud_clusters_updated_at
before update on public.fraud_clusters
for each row execute function public.set_updated_at();

drop trigger if exists trg_suspicious_users_updated_at on public.suspicious_users;
create trigger trg_suspicious_users_updated_at
before update on public.suspicious_users
for each row execute function public.set_updated_at();

-- RLS Policies
alter table public.fraud_clusters enable row level security;
alter table public.anomaly_logs enable row level security;
alter table public.suspicious_users enable row level security;
alter table public.abuse_events enable row level security;
alter table public.user_geo_history enable row level security;
alter table public.geo_flags enable row level security;
alter table public.stream_fraud_flags enable row level security;
alter table public.stream_daily_limits enable row level security;

-- Fraud clusters - admin only
create policy "fraud_clusters_select_admin" on public.fraud_clusters
  for select to authenticated
  using (exists (
    select 1 from public.profiles 
    where id = auth.uid() and role = 'admin'
  ));

-- Anomaly logs - admin only
create policy "anomaly_logs_select_admin" on public.anomaly_logs
  for select to authenticated
  using (exists (
    select 1 from public.profiles 
    where id = auth.uid() and role = 'admin'
  ));

-- Suspicious users - admin only
create policy "suspicious_users_select_admin" on public.suspicious_users
  for select to authenticated
  using (exists (
    select 1 from public.profiles 
    where id = auth.uid() and role = 'admin'
  ));

-- Abuse events - admin only
create policy "abuse_events_select_admin" on public.abuse_events
  for select to authenticated
  using (exists (
    select 1 from public.profiles 
    where id = auth.uid() and role = 'admin'
  ));

-- User geo history - service role only (insert via fraud detection)
create policy "user_geo_history_select_none" on public.user_geo_history
  for select to authenticated
  using (false);

-- Geo flags - service role only
create policy "geo_flags_select_none" on public.geo_flags
  for select to authenticated
  using (false);

-- Stream fraud flags - service role only
create policy "stream_fraud_flags_select_none" on public.stream_fraud_flags
  for select to authenticated
  using (false);

-- Stream daily limits - service role only
create policy "stream_daily_limits_select_none" on public.stream_daily_limits
  for select to authenticated
  using (false);

-- Grant service role permissions
grant select, insert, update on public.fraud_clusters to postgres;
grant select, insert, update on public.anomaly_logs to postgres;
grant select, insert, update on public.suspicious_users to postgres;
grant select, insert, update on public.abuse_events to postgres;
grant select, insert, update on public.user_geo_history to postgres;
grant select, insert, update on public.geo_flags to postgres;
grant select, insert, update on public.stream_fraud_flags to postgres;
grant select, insert, update on public.stream_daily_limits to postgres;

commit;
