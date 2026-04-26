-- SONARA — run in Supabase SQL Editor (or as migration)
-- Extensions
create extension if not exists "uuid-ossp";

-- Profiles (1:1 auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  avatar_url text,
  role text not null default 'listener' check (role in ('listener', 'artist')),
  subscription_status text not null default 'free' check (subscription_status in ('free', 'premium')),
  created_at timestamptz not null default now()
);

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  stage_name text not null,
  bio text default '',
  follower_count int not null default 0,
  total_earnings numeric(14,4) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete cascade,
  title text not null,
  genre text not null default 'Unknown',
  duration int not null default 0,
  file_url text not null,
  cover_url text,
  created_at timestamptz not null default now(),
  stream_count int not null default 0,
  likes_count int not null default 0
);

create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  seconds_played int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists streams_user_song_day on public.streams (user_id, song_id, (created_at::date));

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,
  amount numeric(14,4) not null check (amount > 0),
  payment_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.playlist_songs (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  unique (playlist_id, song_id)
);

create table if not exists public.earnings (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete cascade,
  amount numeric(14,4) not null,
  source text not null check (source in ('stream', 'donation')),
  created_at timestamptz not null default now()
);

-- Social / library
create table if not exists public.song_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, song_id)
);

create table if not exists public.artist_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, artist_id)
);

create table if not exists public.saved_songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, song_id)
);

-- Triggers: stream_count
create or replace function public.on_stream_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.songs
  set stream_count = stream_count + 1
  where id = new.song_id;
  return new;
end;
$$;

drop trigger if exists trg_streams_count on public.streams;
create trigger trg_streams_count
after insert on public.streams
for each row execute function public.on_stream_insert();

-- Song likes count
create or replace function public.on_like_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.songs set likes_count = likes_count + 1 where id = new.song_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.songs set likes_count = greatest(0, likes_count - 1) where id = old.song_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_song_likes_ins on public.song_likes;
create trigger trg_song_likes_ins
after insert on public.song_likes
for each row execute function public.on_like_change();

drop trigger if exists trg_song_likes_del on public.song_likes;
create trigger trg_song_likes_del
after delete on public.song_likes
for each row execute function public.on_like_change();

-- Follower count
create or replace function public.on_follow_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.artists set follower_count = follower_count + 1 where id = new.artist_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.artists set follower_count = greatest(0, follower_count - 1) where id = old.artist_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_follow_ins on public.artist_follows;
create trigger trg_follow_ins
after insert on public.artist_follows
for each row execute function public.on_follow_change();

drop trigger if exists trg_follow_del on public.artist_follows;
create trigger trg_follow_del
after delete on public.artist_follows
for each row execute function public.on_follow_change();

-- Earnings → artist total_earnings
create or replace function public.on_earning_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.artists
  set total_earnings = total_earnings + new.amount
  where id = new.artist_id;
  return new;
end;
$$;

drop trigger if exists trg_earnings_total on public.earnings;
create trigger trg_earnings_total
after insert on public.earnings
for each row execute function public.on_earning_insert();

-- New auth user → profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
  rrole text;
begin
  uname := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  rrole := coalesce(new.raw_user_meta_data->>'role', 'listener');
  if rrole not in ('listener', 'artist') then
    rrole := 'listener';
  end if;
  insert into public.profiles (id, username, role, subscription_status)
  values (new.id, uname, rrole, 'free');
  if rrole = 'artist' then
    insert into public.artists (user_id, stage_name, bio)
    values (new.id, coalesce(new.raw_user_meta_data->>'stage_name', uname), '');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Atomic stream + earnings (70/30 on gross); demo gross €0.01 per qualifying stream
create or replace function public.register_stream(p_song_id uuid, p_seconds_played int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today_count int;
  v_artist uuid;
  v_gross numeric := 0.01;
  v_artist_share numeric;
begin
  if v_user is null then
    return json_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_seconds_played < 30 then
    return json_build_object('ok', false, 'error', 'too_short');
  end if;
  select count(*)::int into v_today_count
  from public.streams
  where user_id = v_user and song_id = p_song_id and (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date;
  if v_today_count >= 10 then
    return json_build_object('ok', false, 'error', 'daily_limit');
  end if;
  select artist_id into v_artist from public.songs where id = p_song_id;
  if v_artist is null then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into public.streams (user_id, song_id, seconds_played)
  values (v_user, p_song_id, p_seconds_played);
  v_artist_share := round(v_gross * 0.70, 4);
  insert into public.earnings (artist_id, amount, source)
  values (v_artist, v_artist_share, 'stream');
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.register_stream(uuid, int) to authenticated;

-- Donation + earnings (90% artist, 10% platform — platform not stored as row)
create or replace function public.register_donation(p_artist_id uuid, p_amount numeric)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pay text;
  v_share numeric;
begin
  if v_user is null then
    return json_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_amount is null or p_amount <= 0 then
    return json_build_object('ok', false, 'error', 'invalid_amount');
  end if;
  if not exists (select 1 from public.artists where id = p_artist_id) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  v_pay := 'sim_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.donations (user_id, artist_id, amount, payment_id)
  values (v_user, p_artist_id, p_amount, v_pay);
  v_share := round(p_amount * 0.90, 4);
  insert into public.earnings (artist_id, amount, source)
  values (p_artist_id, v_share, 'donation');
  return json_build_object('ok', true, 'payment_id', v_pay);
end;
$$;

grant execute on function public.register_donation(uuid, numeric) to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.artists enable row level security;
alter table public.songs enable row level security;
alter table public.streams enable row level security;
alter table public.donations enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_songs enable row level security;
alter table public.earnings enable row level security;
alter table public.song_likes enable row level security;
alter table public.artist_follows enable row level security;
alter table public.saved_songs enable row level security;

-- Profiles
create policy "profiles_select_all" on public.profiles for select using (true);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- Artists
create policy "artists_select_all" on public.artists for select using (true);
create policy "artists_insert_own" on public.artists for insert with check (auth.uid() = user_id);
create policy "artists_update_own" on public.artists for update using (auth.uid() = user_id);

-- Songs
create policy "songs_select_all" on public.songs for select using (true);
create policy "songs_insert_artist" on public.songs for insert with check (
  exists (select 1 from public.artists a where a.id = artist_id and a.user_id = auth.uid())
);
create policy "songs_update_artist" on public.songs for update using (
  exists (select 1 from public.artists a where a.id = artist_id and a.user_id = auth.uid())
);
create policy "songs_delete_artist" on public.songs for delete using (
  exists (select 1 from public.artists a where a.id = artist_id and a.user_id = auth.uid())
);

-- Streams (insert only via register_stream)
create policy "streams_select_own" on public.streams for select using (auth.uid() = user_id);

-- Donations (insert only via register_donation)
create policy "donations_select_fan" on public.donations for select using (auth.uid() = user_id);
create policy "donations_select_artist" on public.donations for select using (
  exists (select 1 from public.artists a where a.id = artist_id and a.user_id = auth.uid())
);

-- Playlists
create policy "playlists_select_own" on public.playlists for select using (auth.uid() = user_id);
create policy "playlists_insert_own" on public.playlists for insert with check (auth.uid() = user_id);
create policy "playlists_update_own" on public.playlists for update using (auth.uid() = user_id);
create policy "playlists_delete_own" on public.playlists for delete using (auth.uid() = user_id);

-- Playlist songs
create policy "playlist_songs_select" on public.playlist_songs for select using (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = auth.uid())
);
create policy "playlist_songs_insert" on public.playlist_songs for insert with check (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = auth.uid())
);
create policy "playlist_songs_delete" on public.playlist_songs for delete using (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = auth.uid())
);

-- Earnings (artists read own; writes via security definer RPCs only)
create policy "earnings_select_artist" on public.earnings for select using (
  exists (select 1 from public.artists a where a.id = artist_id and a.user_id = auth.uid())
);

-- Song likes
create policy "likes_select_own" on public.song_likes for select using (auth.uid() = user_id);
create policy "likes_insert_own" on public.song_likes for insert with check (auth.uid() = user_id);
create policy "likes_delete_own" on public.song_likes for delete using (auth.uid() = user_id);

-- Follows
create policy "follows_select_own" on public.artist_follows for select using (auth.uid() = user_id);
create policy "follows_insert_own" on public.artist_follows for insert with check (auth.uid() = user_id);
create policy "follows_delete_own" on public.artist_follows for delete using (auth.uid() = user_id);

-- Saved songs
create policy "saved_select_own" on public.saved_songs for select using (auth.uid() = user_id);
create policy "saved_insert_own" on public.saved_songs for insert with check (auth.uid() = user_id);
create policy "saved_delete_own" on public.saved_songs for delete using (auth.uid() = user_id);

-- Storage bucket (run in SQL or create via dashboard)
insert into storage.buckets (id, name, public)
values ('songs', 'songs', true)
on conflict (id) do nothing;

-- Storage policies for songs bucket
create policy "songs_storage_read" on storage.objects for select using (bucket_id = 'songs');
create policy "songs_storage_upload" on storage.objects for insert to authenticated
with check (bucket_id = 'songs' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "songs_storage_update_own" on storage.objects for update to authenticated
using (bucket_id = 'songs' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "songs_storage_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'songs' and auth.uid()::text = (storage.foldername(name))[1]);
