-- SONARA Discovery Personalization + Viral Feed Migration
-- File: supabase/04-feed-personalization.sql

begin;

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- =========================================================
-- 1) User behavior tracking (high-volume event table)
-- =========================================================

create table if not exists public.user_behavior (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  artist_id uuid references public.artists (id) on delete set null,
  genre text,
  watch_time_seconds int not null default 0 check (watch_time_seconds >= 0),
  completion_rate numeric(6,3) not null default 0 check (completion_rate >= 0 and completion_rate <= 100),
  skip_rate numeric(6,3) not null default 0 check (skip_rate >= 0 and skip_rate <= 100),
  skip_latency_seconds numeric(10,3) not null default 0 check (skip_latency_seconds >= 0),
  liked boolean not null default false,
  shared boolean not null default false,
  followed boolean not null default false,
  replayed boolean not null default false,
  session_id text,
  source text not null default 'feed' check (source in ('feed', 'song', 'artist', 'search', 'other')),
  created_at timestamptz not null default now()
);

-- =========================================================
-- 2) Song behavior rollup metrics
-- =========================================================

create table if not exists public.song_behavior_metrics (
  song_id uuid primary key references public.songs (id) on delete cascade,
  total_events bigint not null default 0 check (total_events >= 0),
  total_watch_time_seconds bigint not null default 0 check (total_watch_time_seconds >= 0),
  avg_completion_rate numeric(6,3) not null default 0 check (avg_completion_rate >= 0 and avg_completion_rate <= 100),
  avg_skip_rate numeric(6,3) not null default 0 check (avg_skip_rate >= 0 and avg_skip_rate <= 100),
  like_count bigint not null default 0 check (like_count >= 0),
  share_count bigint not null default 0 check (share_count >= 0),
  follow_count bigint not null default 0 check (follow_count >= 0),
  replay_count bigint not null default 0 check (replay_count >= 0),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 3) User profile rollup for personalization
-- =========================================================

create table if not exists public.user_discovery_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  preferred_genres text[] not null default array[]::text[],
  preferred_artists uuid[] not null default array[]::uuid[],
  avg_session_time_seconds numeric(12,3) not null default 0,
  avg_completion_rate numeric(6,3) not null default 0 check (avg_completion_rate >= 0 and avg_completion_rate <= 100),
  avg_skip_rate numeric(6,3) not null default 0 check (avg_skip_rate >= 0 and avg_skip_rate <= 100),
  engagement_score numeric(6,3) not null default 0 check (engagement_score >= 0 and engagement_score <= 100),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 4) Precomputed "for-you" feed cache
-- =========================================================

create table if not exists public.for_you_feed_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  session_id text,
  cache_version int not null default 1,
  songs jsonb not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(user_id, session_id, cache_version)
);

-- =========================================================
-- 5) Optional score snapshots for batch precompute / audits
-- =========================================================

create table if not exists public.for_you_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  base_trending_score numeric(12,4) not null default 0,
  user_affinity_score numeric(12,4) not null default 0,
  recent_growth_rate numeric(12,4) not null default 0,
  growth_boost_multiplier numeric(12,4) not null default 1,
  anti_spam_penalty numeric(12,4) not null default 1,
  final_score numeric(12,4) not null default 0,
  source_bucket text not null default 'trending' check (source_bucket in ('personalized', 'trending', 'discovery')),
  snapshot_at timestamptz not null default now(),
  unique(user_id, song_id, snapshot_at)
);

-- =========================================================
-- 6) Updated-at trigger helper
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_song_behavior_metrics_updated_at on public.song_behavior_metrics;
create trigger trg_song_behavior_metrics_updated_at
before update on public.song_behavior_metrics
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_discovery_profiles_updated_at on public.user_discovery_profiles;
create trigger trg_user_discovery_profiles_updated_at
before update on public.user_discovery_profiles
for each row execute function public.set_updated_at();

-- =========================================================
-- 7) Performance indexes
-- =========================================================

-- user_behavior: event ingestion + query paths
create index if not exists idx_user_behavior_user_created_desc
  on public.user_behavior (user_id, created_at desc);
create index if not exists idx_user_behavior_song_created_desc
  on public.user_behavior (song_id, created_at desc);
create index if not exists idx_user_behavior_artist_created_desc
  on public.user_behavior (artist_id, created_at desc);
create index if not exists idx_user_behavior_genre_created_desc
  on public.user_behavior (genre, created_at desc);
create index if not exists idx_user_behavior_session_created_desc
  on public.user_behavior (session_id, created_at desc);
create index if not exists idx_user_behavior_source_created_desc
  on public.user_behavior (source, created_at desc);
create index if not exists idx_user_behavior_completion_desc
  on public.user_behavior (completion_rate desc, created_at desc);
create index if not exists idx_user_behavior_skip_desc
  on public.user_behavior (skip_rate desc, created_at desc);

-- partial indexes for common filters
create index if not exists idx_user_behavior_liked_user_created
  on public.user_behavior (user_id, created_at desc)
  where liked = true;
create index if not exists idx_user_behavior_shared_user_created
  on public.user_behavior (user_id, created_at desc)
  where shared = true;
create index if not exists idx_user_behavior_followed_user_created
  on public.user_behavior (user_id, created_at desc)
  where followed = true;
create index if not exists idx_user_behavior_replayed_user_created
  on public.user_behavior (user_id, created_at desc)
  where replayed = true;

-- song_behavior_metrics
create index if not exists idx_song_behavior_metrics_updated_desc
  on public.song_behavior_metrics (updated_at desc);
create index if not exists idx_song_behavior_metrics_completion_desc
  on public.song_behavior_metrics (avg_completion_rate desc, updated_at desc);
create index if not exists idx_song_behavior_metrics_skip_asc
  on public.song_behavior_metrics (avg_skip_rate asc, updated_at desc);
create index if not exists idx_song_behavior_metrics_engagement_signals
  on public.song_behavior_metrics (like_count desc, share_count desc, replay_count desc);

-- user_discovery_profiles
create index if not exists idx_user_discovery_profiles_updated_desc
  on public.user_discovery_profiles (updated_at desc);
create index if not exists idx_user_discovery_profiles_engagement_desc
  on public.user_discovery_profiles (engagement_score desc, updated_at desc);

-- for_you_feed_cache
create index if not exists idx_for_you_feed_cache_user_expires_desc
  on public.for_you_feed_cache (user_id, expires_at desc);
create index if not exists idx_for_you_feed_cache_expires
  on public.for_you_feed_cache (expires_at);
create index if not exists idx_for_you_feed_cache_generated_desc
  on public.for_you_feed_cache (generated_at desc);

-- for_you_score_snapshots
create index if not exists idx_for_you_score_snapshots_user_snapshot_desc
  on public.for_you_score_snapshots (user_id, snapshot_at desc);
create index if not exists idx_for_you_score_snapshots_song_snapshot_desc
  on public.for_you_score_snapshots (song_id, snapshot_at desc);
create index if not exists idx_for_you_score_snapshots_final_score_desc
  on public.for_you_score_snapshots (final_score desc, snapshot_at desc);
create index if not exists idx_for_you_score_snapshots_bucket_score_desc
  on public.for_you_score_snapshots (source_bucket, final_score desc, snapshot_at desc);

-- GIN indexes for arrays/jsonb
create index if not exists idx_user_discovery_profiles_preferred_genres_gin
  on public.user_discovery_profiles using gin (preferred_genres);
create index if not exists idx_user_discovery_profiles_preferred_artists_gin
  on public.user_discovery_profiles using gin (preferred_artists);
create index if not exists idx_for_you_feed_cache_songs_gin
  on public.for_you_feed_cache using gin (songs);

-- =========================================================
-- 8) RLS
-- =========================================================

alter table public.user_behavior enable row level security;
alter table public.song_behavior_metrics enable row level security;
alter table public.user_discovery_profiles enable row level security;
alter table public.for_you_feed_cache enable row level security;
alter table public.for_you_score_snapshots enable row level security;

do $$
begin
  -- user_behavior
  begin
    create policy "user_behavior_select_own"
      on public.user_behavior
      for select
      to authenticated
      using (auth.uid() = user_id);
  exception when duplicate_object then null; end;

  -- user_discovery_profiles
  begin
    create policy "user_discovery_profiles_select_own"
      on public.user_discovery_profiles
      for select
      to authenticated
      using (auth.uid() = user_id);
  exception when duplicate_object then null; end;

  -- for_you_feed_cache
  begin
    create policy "for_you_feed_cache_select_own"
      on public.for_you_feed_cache
      for select
      to authenticated
      using (auth.uid() = user_id);
  exception when duplicate_object then null; end;

  -- read-only analytics visibility for authenticated users
  begin
    create policy "song_behavior_metrics_select_authenticated"
      on public.song_behavior_metrics
      for select
      to authenticated
      using (true);
  exception when duplicate_object then null; end;

  begin
    create policy "for_you_score_snapshots_select_authenticated"
      on public.for_you_score_snapshots
      for select
      to authenticated
      using (true);
  exception when duplicate_object then null; end;
end$$;

commit;
