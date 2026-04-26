-- Real-Time + Batch Hybrid Trending System
-- Cache layer + version tracking for fast feed access

-- Trending Scores Cache (real-time updates)
create table if not exists public.trending_scores_cache (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null unique references public.songs (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,
  score numeric(12,2) not null default 0,
  score_version int not null default 0,
  plays_24h int not null default 0,
  plays_7d int not null default 0,
  likes_count int not null default 0,
  shares_count int not null default 0,
  completion_rate numeric(5,2) not null default 0,
  follower_boost numeric(10,2) not null default 0,
  rising_boost numeric(5,2) not null default 1.0,
  rank_position int,
  last_recalc_at timestamptz,
  cache_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_trending_score desc on public.trending_scores_cache(score desc);
create index if not exists idx_trending_rank on public.trending_scores_cache(rank_position);
create index if not exists idx_trending_expires on public.trending_scores_cache(cache_expires_at);
create index if not exists idx_trending_artist on public.trending_scores_cache(artist_id);
create index if not exists idx_trending_recalc on public.trending_scores_cache(last_recalc_at);

-- Score Version History (track score changes)
create table if not exists public.score_version_history (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  version int not null,
  score numeric(12,2) not null,
  score_components jsonb,
  calculation_timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_version_song on public.score_version_history(song_id, version desc);

-- Real-Time Score Updates (micro-updates queue)
create table if not exists public.realtime_score_updates (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  update_type text not null check (update_type in ('like', 'unlike', 'share', 'completion', 'skip')),
  delta numeric(12,2) not null,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_realtime_updates_song on public.realtime_score_updates(song_id);
create index if not exists idx_realtime_updates_processed on public.realtime_score_updates(processed, created_at);

-- Trending Leaderboard Snapshot (materialized view cache)
create table if not exists public.trending_leaderboard (
  id uuid primary key default gen_random_uuid(),
  rank int not null unique,
  song_id uuid not null references public.songs (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,
  score numeric(12,2) not null,
  title text not null,
  artist_name text not null,
  cover_url text,
  snapshot_time timestamptz not null default now(),
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_leaderboard_rank on public.trending_leaderboard(rank);
create index if not exists idx_leaderboard_valid on public.trending_leaderboard(valid_until);
create index if not exists idx_leaderboard_song on public.trending_leaderboard(song_id);

-- Batch Recalculation Schedule
create table if not exists public.trending_batch_runs (
  id uuid primary key default gen_random_uuid(),
  batch_number int not null unique,
  run_type text not null check (run_type in ('hourly', 'daily', 'weekly')),
  started_at timestamptz not null,
  completed_at timestamptz,
  songs_processed int default 0,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'failed', 'aborted')),
  error_message text,
  duration_ms int,
  created_at timestamptz not null default now()
);

create index if not exists idx_batch_status on public.trending_batch_runs(status, started_at desc);
