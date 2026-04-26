-- SONARA Production Aggregation Layer
-- Adds precomputed stats, immutable ledger, and performance indexes

-- ============================================================
-- 1. AGGREGATION TABLES (precomputed, updated by batch/cron)
-- ============================================================

-- Song-level aggregated stats (updated by batch processor)
create table if not exists public.song_stats (
  song_id uuid primary key references public.songs (id) on delete cascade,
  total_streams bigint not null default 0,
  total_playtime_seconds bigint not null default 0,
  total_likes bigint not null default 0,
  total_shares bigint not null default 0,
  total_donations numeric(14,4) not null default 0,
  stream_revenue numeric(14,4) not null default 0,
  last_aggregation_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.song_stats is 'Precomputed song metrics updated by batch job';

-- Artist-level aggregated stats
create table if not exists public.artist_stats (
  artist_id uuid primary key references public.artists (id) on delete cascade,
  total_streams bigint not null default 0,
  total_playtime_seconds bigint not null default 0,
  total_likes bigint not null default 0,
  total_followers bigint not null default 0,
  total_donations numeric(14,4) not null default 0,
  total_ad_revenue numeric(14,4) not null default 0,
  total_stream_revenue numeric(14,4) not null default 0,
  last_aggregation_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.artist_stats is 'Precomputed artist metrics updated by batch job';

-- Daily aggregates (for trend calculation and reporting)
create table if not exists public.daily_aggregates (
  id uuid primary key default gen_random_uuid(),
  aggregate_date date not null,
  entity_type text not null check (entity_type in ('song', 'artist', 'platform')),
  entity_id uuid,
  metric_type text not null check (metric_type in ('streams', 'playtime', 'likes', 'donations', 'ad_revenue', 'stream_revenue')),
  metric_value numeric(20,4) not null default 0,
  created_at timestamptz not null default now(),
  unique (aggregate_date, entity_type, entity_id, metric_type)
);

comment on table public.daily_aggregates is 'Immutable daily metric snapshots for trend analysis';

-- ============================================================
-- 2. IMMUTABLE MONETIZATION LEDGER
-- ============================================================

-- Immutable transaction log for every revenue event
create table if not exists public.revenue_ledger (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null check (transaction_type in ('stream', 'donation', 'ad_impression', 'ad_click', 'premium_sub')),
  artist_id uuid references public.artists (id),
  song_id uuid references public.songs (id),
  user_id uuid references public.profiles (id),
  amount_gross numeric(14,4) not null,
  amount_artist numeric(14,4) not null,
  amount_platform numeric(14,4) not null default 0,
  payment_reference text,
  session_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.revenue_ledger is 'Immutable audit log for all revenue transactions. NEVER UPDATE OR DELETE.';

-- ============================================================
-- 3. PERFORMANCE INDEXES
-- ============================================================

-- songs: artist lookup, genre filter, date sort
create index if not exists idx_songs_artist_id on public.songs (artist_id);
create index if not exists idx_songs_genre on public.songs (genre);
create index if not exists idx_songs_created_at on public.songs (created_at desc);
create index if not exists idx_songs_status on public.songs (status) where status = 'active';

-- streams: song analytics, user history, date filtering
-- (existing: streams_user_song_day)
create index if not exists idx_streams_song_id on public.streams (song_id);
create index if not exists idx_streams_created_at on public.streams (created_at desc);
create index if not exists idx_streams_song_date on public.streams (song_id, created_at);

-- earnings: artist revenue queries
create index if not exists idx_earnings_artist_source on public.earnings (artist_id, source, created_at desc);

-- song_likes: popularity queries
create index if not exists idx_song_likes_song_id on public.song_likes (song_id);
create index if not exists idx_song_likes_user_id on public.song_likes (user_id);

-- artist_follows: follower analytics
create index if not exists idx_artist_follows_artist_id on public.artist_follows (artist_id);
create index if not exists idx_artist_follows_user_id on public.artist_follows (user_id);

-- donations: artist revenue, user history
create index if not exists idx_donations_artist_id on public.donations (artist_id, created_at desc);
create index if not exists idx_donations_user_id on public.donations (user_id, created_at desc);

-- daily_aggregates: trend queries
create index if not exists idx_daily_agg_date on public.daily_aggregates (aggregate_date desc);
create index if not exists idx_daily_agg_entity on public.daily_aggregates (entity_type, entity_id, aggregate_date desc);

-- revenue_ledger: audit queries
create index if not exists idx_revenue_ledger_artist on public.revenue_ledger (artist_id, created_at desc);
create index if not exists idx_revenue_ledger_type on public.revenue_ledger (transaction_type, created_at desc);

-- ============================================================
-- 4. AGGREGATION TRIGGERS (keep song_stats in sync with events)
-- ============================================================

-- On stream insert: increment song_stats
create or replace function public.increment_song_stream_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.song_stats (song_id, total_streams, total_playtime_seconds)
  values (new.song_id, 1, new.seconds_played)
  on conflict (song_id) do update
  set total_streams = public.song_stats.total_streams + 1,
      total_playtime_seconds = public.song_stats.total_playtime_seconds + new.seconds_played,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_song_stats_stream on public.streams;
create trigger trg_song_stats_stream
after insert on public.streams
for each row execute function public.increment_song_stream_stats();

-- On like insert: increment song_stats
create or replace function public.increment_song_like_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.song_stats (song_id, total_likes)
  values (new.song_id, 1)
  on conflict (song_id) do update
  set total_likes = public.song_stats.total_likes + 1,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_song_stats_like on public.song_likes;
create trigger trg_song_stats_like
after insert on public.song_likes
for each row execute function public.increment_song_like_stats();

-- On like delete: decrement song_stats
create or replace function public.decrement_song_like_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.song_stats
  set total_likes = greatest(0, total_likes - 1),
      updated_at = now()
  where song_id = old.song_id;
  return old;
end;
$$;

drop trigger if exists trg_song_stats_unlike on public.song_likes;
create trigger trg_song_stats_unlike
after delete on public.song_likes
for each row execute function public.decrement_song_like_stats();

-- On follow insert: increment artist_stats
create or replace function public.increment_artist_follow_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist_user_id uuid;
begin
  select user_id into v_artist_user_id from public.artists where id = new.artist_id;
  
  insert into public.artist_stats (artist_id, total_followers)
  values (new.artist_id, 1)
  on conflict (artist_id) do update
  set total_followers = public.artist_stats.total_followers + 1,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_artist_stats_follow on public.artist_follows;
create trigger trg_artist_stats_follow
after insert on public.artist_follows
for each row execute function public.increment_artist_follow_stats();

-- On follow delete: decrement artist_stats
create or replace function public.decrement_artist_follow_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.artist_stats
  set total_followers = greatest(0, total_followers - 1),
      updated_at = now()
  where artist_id = old.artist_id;
  return old;
end;
$$;

drop trigger if exists trg_artist_stats_unfollow on public.artist_follows;
create trigger trg_artist_stats_unfollow
after delete on public.artist_follows
for each row execute function public.decrement_artist_follow_stats();

-- ============================================================
-- 5. BATCH AGGREGATION FUNCTION
-- ============================================================

create or replace function public.aggregate_daily_metrics(p_date date default current_date)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stream_count bigint;
  v_donation_total numeric(14,4);
begin
  -- Aggregate streams by song
  insert into public.daily_aggregates (aggregate_date, entity_type, entity_id, metric_type, metric_value)
  select p_date, 'song', song_id, 'streams', count(*)::numeric
  from public.streams
  where (created_at at time zone 'utc')::date = p_date
  group by song_id
  on conflict (aggregate_date, entity_type, entity_id, metric_type) do update
  set metric_value = excluded.metric_value;

  -- Aggregate playtime by song
  insert into public.daily_aggregates (aggregate_date, entity_type, entity_id, metric_type, metric_value)
  select p_date, 'song', song_id, 'playtime', sum(seconds_played)::numeric
  from public.streams
  where (created_at at time zone 'utc')::date = p_date
  group by song_id
  on conflict (aggregate_date, entity_type, entity_id, metric_type) do update
  set metric_value = excluded.metric_value;

  -- Aggregate donations by artist
  insert into public.daily_aggregates (aggregate_date, entity_type, entity_id, metric_type, metric_value)
  select p_date, 'artist', artist_id, 'donations', sum(amount)::numeric
  from public.donations
  where (created_at at time zone 'utc')::date = p_date
  group by artist_id
  on conflict (aggregate_date, entity_type, entity_id, metric_type) do update
  set metric_value = excluded.metric_value;

  -- Update song_stats from daily aggregates
  update public.song_stats s
  set
    total_streams = coalesce(s.total_streams, 0) + coalesce(d.metric_value, 0),
    last_aggregation_at = now()
  from public.daily_aggregates d
  where d.aggregate_date = p_date
    and d.entity_type = 'song'
    and d.metric_type = 'streams'
    and d.entity_id = s.song_id;

  -- Update artist_stats from daily aggregates
  update public.artist_stats a
  set
    total_donations = coalesce(a.total_donations, 0) + coalesce(d.metric_value, 0),
    last_aggregation_at = now()
  from public.daily_aggregates d
  where d.aggregate_date = p_date
    and d.entity_type = 'artist'
    and d.metric_type = 'donations'
    and d.entity_id = a.artist_id;

  select count(*) into v_stream_count from public.streams where (created_at at time zone 'utc')::date = p_date;
  select coalesce(sum(amount), 0) into v_donation_total from public.donations where (created_at at time zone 'utc')::date = p_date;

  return json_build_object(
    'date', p_date,
    'streams_processed', v_stream_count,
    'donation_total', v_donation_total,
    'aggregated', true
  );
end;
$$;

grant execute on function public.aggregate_daily_metrics(date) to authenticated;

-- ============================================================
-- 6. REVENUE LEDGER INSERT TRIGGER
-- ============================================================

create or replace function public.write_revenue_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_song_id uuid;
  v_user_id uuid;
  v_gross numeric;
  v_artist numeric;
  v_platform numeric;
begin
  if new.source = 'stream' then
    -- Get song_id from stream record if available
    select song_id, user_id into v_song_id, v_user_id
    from public.streams
    where id = new.id;

    v_gross := 0.01;
    v_artist := round(v_gross * 0.70, 4);
    v_platform := round(v_gross * 0.30, 4);
  elsif new.source = 'donation' then
    v_song_id := null;
    v_user_id := null;
    v_gross := new.amount;
    v_artist := new.amount; -- already computed in register_donation
    v_platform := 0;
  else
    return new;
  end if;

  insert into public.revenue_ledger (
    transaction_type,
    artist_id,
    song_id,
    user_id,
    amount_gross,
    amount_artist,
    amount_platform,
    metadata
  ) values (
    new.source,
    new.artist_id,
    v_song_id,
    v_user_id,
    v_gross,
    v_artist,
    v_platform,
    json_build_object('earnings_id', new.id)
  );

  return new;
end;
$$;

drop trigger if exists trg_revenue_ledger on public.earnings;
create trigger trg_revenue_ledger
after insert on public.earnings
for each row execute function public.write_revenue_ledger();

-- ============================================================
-- 7. RLS POLICIES FOR NEW TABLES
-- ============================================================

alter table public.song_stats enable row level security;
alter table public.artist_stats enable row level security;
alter table public.daily_aggregates enable row level security;
alter table public.revenue_ledger enable row level security;

-- song_stats: public read
create policy "song_stats_select_all" on public.song_stats for select using (true);

-- artist_stats: public read
create policy "artist_stats_select_all" on public.artist_stats for select using (true);

-- daily_aggregates: public read
create policy "daily_agg_select_all" on public.daily_aggregates for select using (true);

-- revenue_ledger: artists read own, admin reads all
create policy "revenue_ledger_select_artist" on public.revenue_ledger for select using (
  exists (select 1 from public.artists a where a.id = artist_id and a.user_id = auth.uid())
);

-- ============================================================
-- 8. SUMMARY
-- ============================================================
comment on table public.songs is 'Core song catalog. Counter columns (stream_count, likes_count) are present but song_stats is the authoritative source for analytics.';
comment on table public.streams is 'Individual stream events. Server-validated only via register_stream RPC.';
comment on table public.earnings is 'Artist earnings summary. Immutable ledger in revenue_ledger is the audit source of truth.';
