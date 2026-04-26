-- Core compatibility tables expected by SONARA application
-- Safe to run multiple times

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key,
  username text,
  full_name text,
  avatar_url text,
  role text default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid,
  title text not null,
  genre text,
  duration integer default 0,
  file_url text not null,
  cover_url text,
  stream_count integer not null default 0,
  likes_count integer not null default 0,
  shares_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  song_id uuid not null,
  artist_id uuid,
  duration_played_seconds integer not null default 0,
  total_duration_seconds integer not null default 0,
  is_valid boolean not null default true,
  stream_value numeric(12,6) not null default 0,
  event_id uuid,
  is_earnings_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_songs_artist_id on public.songs(artist_id);
create index if not exists idx_songs_created_at on public.songs(created_at desc);
create index if not exists idx_streams_user_song_date on public.streams(user_id, song_id, created_at desc);
create index if not exists idx_streams_song_valid_date on public.streams(song_id, is_valid, created_at desc);
