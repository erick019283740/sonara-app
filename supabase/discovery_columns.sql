-- SONARA discovery / viral layer (run in Supabase SQL editor)
alter table public.songs
  add column if not exists shares_count int not null default 0;

alter table public.songs
  add column if not exists external_click_count int not null default 0;

create index if not exists streams_song_created_at_idx
  on public.streams (song_id, created_at desc);

create index if not exists artist_follows_artist_created_idx
  on public.artist_follows (artist_id, created_at desc);

create index if not exists songs_artist_created_idx
  on public.songs (artist_id, created_at desc);
