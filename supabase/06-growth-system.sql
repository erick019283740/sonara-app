-- SONARA Growth System Migration
-- File: supabase/06-growth-system.sql

create extension if not exists pgcrypto;

-- =========================================================
-- 1) REFERRAL SYSTEM
-- =========================================================

alter table public.profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by uuid references public.profiles(id) on delete set null,
  add column if not exists onboarding_boost_until timestamptz,
  add column if not exists onboarding_boost_meta jsonb not null default '{}'::jsonb;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_user_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'converted', 'expired', 'rejected')),
  conversion_source text not null default 'referral_code',
  created_at timestamptz not null default now(),
  converted_at timestamptz
);

create index if not exists idx_referrals_inviter_created
  on public.referrals(inviter_user_id, created_at desc);

create index if not exists idx_referrals_code
  on public.referrals(referral_code);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_type text not null
    check (reward_type in ('premium_days', 'visibility_boost', 'boost_credits', 'onboarding_boost')),
  reward_value numeric(14,4) not null default 0,
  meta jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  unique (referral_id, user_id, reward_type)
);

create index if not exists idx_referral_rewards_user_granted
  on public.referral_rewards(user_id, granted_at desc);

-- =========================================================
-- 2) CREATOR BOOST SYSTEM
-- =========================================================

create table if not exists public.artist_boost_wallets (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  credits_balance int not null default 0 check (credits_balance >= 0),
  daily_limit int not null default 3 check (daily_limit >= 0),
  daily_used int not null default 0 check (daily_used >= 0),
  daily_reset_at timestamptz not null default date_trunc('day', now()) + interval '1 day',
  updated_at timestamptz not null default now()
);

create table if not exists public.song_boosts (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  credits_used int not null default 1 check (credits_used > 0),
  exposure_multiplier numeric(8,4) not null default 1.15 check (exposure_multiplier >= 1 and exposure_multiplier <= 1.50),
  decay_factor numeric(8,4) not null default 0.70 check (decay_factor > 0 and decay_factor <= 1),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null default now() + interval '6 hours',
  created_at timestamptz not null default now(),
  constraint song_boosts_boost_window check (ends_at > starts_at)
);

create index if not exists idx_song_boosts_song_active
  on public.song_boosts(song_id, starts_at, ends_at);

create index if not exists idx_song_boosts_artist_created
  on public.song_boosts(artist_id, created_at desc);

-- =========================================================
-- 3) SHARE VIRAL LOOP
-- =========================================================

create table if not exists public.share_tracking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  artist_id uuid references public.artists(id) on delete set null,
  song_id uuid not null references public.songs(id) on delete cascade,
  platform text not null
    check (platform in ('tiktok', 'instagram', 'whatsapp', 'x', 'other')),
  share_token text not null unique,
  share_url text not null,
  campaign text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists idx_share_tracking_song_created
  on public.share_tracking(song_id, created_at desc);

create index if not exists idx_share_tracking_artist_created
  on public.share_tracking(artist_id, created_at desc);

create table if not exists public.share_conversions (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.share_tracking(id) on delete cascade,
  new_user_id uuid references public.profiles(id) on delete set null,
  conversion_type text not null default 'signup'
    check (conversion_type in ('signup', 'stream', 'follow', 'support')),
  revenue_amount numeric(14,4) not null default 0,
  converted_at timestamptz not null default now(),
  unique (share_id, new_user_id, conversion_type)
);

create index if not exists idx_share_conversions_share_time
  on public.share_conversions(share_id, converted_at desc);

alter table public.songs
  add column if not exists viral_score numeric(14,6) not null default 0,
  add column if not exists external_click_count int not null default 0,
  add column if not exists share_boost_score numeric(10,4) not null default 0;

-- =========================================================
-- 4) FOLLOW GRAPH SYSTEM
-- =========================================================

create table if not exists public.user_follows (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references public.profiles(id) on delete cascade,
  followed_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_user_id, followed_user_id),
  constraint user_follows_no_self_follow check (follower_user_id <> followed_user_id)
);

create index if not exists idx_user_follows_follower_created
  on public.user_follows(follower_user_id, created_at desc);

create index if not exists idx_user_follows_followed_created
  on public.user_follows(followed_user_id, created_at desc);

-- =========================================================
-- 5) NOTIFICATION SYSTEM
-- =========================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null
    check (type in (
      'new_follower',
      'song_trending',
      'earnings_update',
      'artist_supported',
      'daily_streak',
      'new_songs_for_you',
      'reengagement'
    )),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_read_created
  on public.notifications(user_id, read, created_at desc);

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'fcm'
    check (provider in ('fcm', 'apns', 'webpush')),
  device_token text not null unique,
  platform text not null default 'web'
    check (platform in ('ios', 'android', 'web')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_devices_user_enabled
  on public.push_devices(user_id, enabled);

-- =========================================================
-- 6) CREATOR DASHBOARD / ANALYTICS SNAPSHOT
-- =========================================================

create table if not exists public.creator_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  metric_date date not null,
  streams_count int not null default 0,
  unique_listeners int not null default 0,
  followers_gained int not null default 0,
  total_earnings numeric(14,4) not null default 0,
  support_amount numeric(14,4) not null default 0,
  shares_count int not null default 0,
  conversions_count int not null default 0,
  viral_score_avg numeric(14,6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, metric_date)
);

create index if not exists idx_creator_daily_metrics_artist_date
  on public.creator_daily_metrics(artist_id, metric_date desc);

-- =========================================================
-- 7) RETENTION SYSTEM
-- =========================================================

create table if not exists public.user_retention_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_active_date date,
  reengagement_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  daily_streak_enabled boolean not null default true,
  new_songs_enabled boolean not null default true,
  reengagement_enabled boolean not null default true,
  earnings_enabled boolean not null default true,
  follows_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 8) GAMIFICATION
-- =========================================================

create table if not exists public.artist_leaderboard_daily (
  id uuid primary key default gen_random_uuid(),
  leaderboard_date date not null,
  artist_id uuid not null references public.artists(id) on delete cascade,
  rank int not null check (rank > 0),
  score numeric(14,6) not null default 0,
  streams_count int not null default 0,
  followers_gained int not null default 0,
  earnings_amount numeric(14,4) not null default 0,
  unique (leaderboard_date, artist_id),
  unique (leaderboard_date, rank)
);

create index if not exists idx_artist_leaderboard_date_rank
  on public.artist_leaderboard_daily(leaderboard_date desc, rank asc);

create table if not exists public.fan_badges (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_type text not null check (badge_type in ('top_supporter', 'super_fan', 'early_supporter')),
  badge_level int not null default 1 check (badge_level > 0),
  awarded_at timestamptz not null default now(),
  unique (artist_id, user_id, badge_type)
);

create index if not exists idx_fan_badges_artist_type
  on public.fan_badges(artist_id, badge_type, awarded_at desc);

-- =========================================================
-- HELPERS / FUNCTIONS
-- =========================================================

create or replace function public.ensure_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.referral_code is null or length(trim(new.referral_code)) = 0 then
    new.referral_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_referral_code on public.profiles;
create trigger trg_profiles_referral_code
before insert or update on public.profiles
for each row execute function public.ensure_referral_code();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_push_devices_touch on public.push_devices;
create trigger trg_push_devices_touch
before update on public.push_devices
for each row execute function public.touch_updated_at();

drop trigger if exists trg_creator_daily_metrics_touch on public.creator_daily_metrics;
create trigger trg_creator_daily_metrics_touch
before update on public.creator_daily_metrics
for each row execute function public.touch_updated_at();

drop trigger if exists trg_user_retention_stats_touch on public.user_retention_stats;
create trigger trg_user_retention_stats_touch
before update on public.user_retention_stats
for each row execute function public.touch_updated_at();

drop trigger if exists trg_user_notification_preferences_touch on public.user_notification_preferences;
create trigger trg_user_notification_preferences_touch
before update on public.user_notification_preferences
for each row execute function public.touch_updated_at();

create or replace function public.redeem_referral_code(
  p_referral_code text,
  p_invited_user_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter_id uuid;
  v_referral_id uuid;
begin
  if p_referral_code is null or length(trim(p_referral_code)) = 0 then
    return json_build_object('ok', false, 'error', 'invalid_referral_code');
  end if;

  select id into v_inviter_id
  from public.profiles
  where upper(referral_code) = upper(trim(p_referral_code))
  limit 1;

  if v_inviter_id is null then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_inviter_id = p_invited_user_id then
    return json_build_object('ok', false, 'error', 'self_referral_not_allowed');
  end if;

  insert into public.referrals (inviter_user_id, invited_user_id, referral_code, status, converted_at)
  values (v_inviter_id, p_invited_user_id, upper(trim(p_referral_code)), 'converted', now())
  on conflict (invited_user_id) do update
  set inviter_user_id = excluded.inviter_user_id,
      referral_code = excluded.referral_code,
      status = 'converted',
      converted_at = now()
  returning id into v_referral_id;

  update public.profiles
  set referred_by = v_inviter_id,
      onboarding_boost_until = now() + interval '14 days',
      onboarding_boost_meta = jsonb_build_object(
        'source', 'referral',
        'granted_at', now(),
        'boost', 'new_user_onboarding'
      )
  where id = p_invited_user_id;

  insert into public.referral_rewards (referral_id, user_id, reward_type, reward_value, meta)
  values
    (v_referral_id, v_inviter_id, 'visibility_boost', 1, jsonb_build_object('days', 7)),
    (v_referral_id, v_inviter_id, 'boost_credits', 3, jsonb_build_object('reason', 'referral_conversion')),
    (v_referral_id, p_invited_user_id, 'onboarding_boost', 1, jsonb_build_object('days', 14))
  on conflict do nothing;

  update public.artist_boost_wallets w
  set credits_balance = w.credits_balance + 3,
      updated_at = now()
  from public.artists a
  where a.id = w.artist_id
    and a.user_id = v_inviter_id;

  return json_build_object(
    'ok', true,
    'inviter_user_id', v_inviter_id,
    'invited_user_id', p_invited_user_id,
    'referral_id', v_referral_id
  );
end;
$$;

grant execute on function public.redeem_referral_code(text, uuid) to authenticated;

create or replace function public.consume_artist_boost(
  p_artist_id uuid,
  p_song_id uuid,
  p_credits int default 1
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.artist_boost_wallets%rowtype;
  v_used int;
begin
  if p_credits is null or p_credits <= 0 then
    return json_build_object('ok', false, 'error', 'invalid_credits');
  end if;

  select * into v_wallet
  from public.artist_boost_wallets
  where artist_id = p_artist_id
  for update;

  if not found then
    insert into public.artist_boost_wallets (artist_id, credits_balance, daily_limit, daily_used, daily_reset_at)
    values (p_artist_id, 0, 3, 0, date_trunc('day', now()) + interval '1 day')
    on conflict do nothing;

    select * into v_wallet
    from public.artist_boost_wallets
    where artist_id = p_artist_id
    for update;
  end if;

  if now() >= v_wallet.daily_reset_at then
    update public.artist_boost_wallets
    set daily_used = 0,
        daily_reset_at = date_trunc('day', now()) + interval '1 day',
        updated_at = now()
    where artist_id = p_artist_id;

    select * into v_wallet
    from public.artist_boost_wallets
    where artist_id = p_artist_id
    for update;
  end if;

  if v_wallet.credits_balance < p_credits then
    return json_build_object('ok', false, 'error', 'insufficient_credits');
  end if;

  if (v_wallet.daily_used + p_credits) > v_wallet.daily_limit then
    return json_build_object('ok', false, 'error', 'daily_limit_reached');
  end if;

  update public.artist_boost_wallets
  set credits_balance = credits_balance - p_credits,
      daily_used = daily_used + p_credits,
      updated_at = now()
  where artist_id = p_artist_id
  returning daily_used into v_used;

  insert into public.song_boosts (artist_id, song_id, credits_used, exposure_multiplier, decay_factor, starts_at, ends_at)
  values (
    p_artist_id,
    p_song_id,
    p_credits,
    least(1.50, 1 + (p_credits::numeric * 0.10)),
    0.70,
    now(),
    now() + interval '6 hours'
  );

  update public.songs
  set share_boost_score = greatest(share_boost_score, least(2.5, share_boost_score + (p_credits::numeric * 0.20)))
  where id = p_song_id and artist_id = p_artist_id;

  return json_build_object(
    'ok', true,
    'artist_id', p_artist_id,
    'song_id', p_song_id,
    'credits_used', p_credits,
    'daily_used', v_used
  );
end;
$$;

grant execute on function public.consume_artist_boost(uuid, uuid, int) to authenticated;

create or replace function public.record_share_conversion(
  p_share_token text,
  p_new_user_id uuid,
  p_conversion_type text default 'signup'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.share_tracking%rowtype;
  v_conversion_id uuid;
  v_score_increment numeric(14,6);
begin
  select * into v_share
  from public.share_tracking
  where share_token = p_share_token
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'share_not_found');
  end if;

  insert into public.share_conversions (share_id, new_user_id, conversion_type, converted_at)
  values (v_share.id, p_new_user_id, coalesce(p_conversion_type, 'signup'), now())
  on conflict (share_id, new_user_id, conversion_type) do nothing
  returning id into v_conversion_id;

  if v_conversion_id is null then
    return json_build_object('ok', true, 'deduplicated', true, 'share_id', v_share.id);
  end if;

  v_score_increment :=
    case coalesce(p_conversion_type, 'signup')
      when 'signup' then 2.000000
      when 'stream' then 0.600000
      when 'follow' then 0.900000
      when 'support' then 1.500000
      else 0.500000
    end;

  update public.songs
  set viral_score = viral_score + v_score_increment,
      share_boost_score = share_boost_score + (v_score_increment / 2.0)
  where id = v_share.song_id;

  return json_build_object(
    'ok', true,
    'share_id', v_share.id,
    'conversion_id', v_conversion_id,
    'song_id', v_share.song_id,
    'viral_score_increment', v_score_increment
  );
end;
$$;

grant execute on function public.record_share_conversion(text, uuid, text) to authenticated;

create or replace view public.creator_dashboard_v as
select
  a.id as artist_id,
  a.user_id as artist_user_id,
  a.stage_name,
  a.follower_count as total_followers,
  a.total_earnings,
  coalesce(sum(case when e.created_at >= now() - interval '30 days' then e.amount else 0 end), 0)::numeric(14,4) as earnings_30d,
  coalesce(sum(case when s.created_at >= now() - interval '30 days' then 1 else 0 end), 0)::bigint as streams_30d,
  coalesce(sum(case when st.created_at >= now() - interval '30 days' then 1 else 0 end), 0)::bigint as shares_30d,
  coalesce(avg(so.viral_score), 0)::numeric(14,6) as avg_viral_score,
  coalesce(max(so.viral_score), 0)::numeric(14,6) as top_song_viral_score
from public.artists a
left join public.earnings e on e.artist_id = a.id
left join public.songs so on so.artist_id = a.id
left join public.streams s on s.song_id = so.id
left join public.share_tracking st on st.song_id = so.id
group by a.id, a.user_id, a.stage_name, a.follower_count, a.total_earnings;

-- =========================================================
-- RLS
-- =========================================================

alter table public.referrals enable row level security;
alter table public.referral_rewards enable row level security;
alter table public.artist_boost_wallets enable row level security;
alter table public.song_boosts enable row level security;
alter table public.share_tracking enable row level security;
alter table public.share_conversions enable row level security;
alter table public.user_follows enable row level security;
alter table public.notifications enable row level security;
alter table public.push_devices enable row level security;
alter table public.creator_daily_metrics enable row level security;
alter table public.user_retention_stats enable row level security;
alter table public.user_notification_preferences enable row level security;
alter table public.artist_leaderboard_daily enable row level security;
alter table public.fan_badges enable row level security;

-- Referrals
create policy "referrals_select_own_related"
  on public.referrals
  for select
  using (auth.uid() = inviter_user_id or auth.uid() = invited_user_id);

create policy "referrals_insert_invited_or_inviter"
  on public.referrals
  for insert
  with check (auth.uid() = inviter_user_id or auth.uid() = invited_user_id);

-- Referral rewards
create policy "referral_rewards_select_own"
  on public.referral_rewards
  for select
  using (auth.uid() = user_id);

-- Artist boost wallets
create policy "artist_boost_wallets_select_owner"
  on public.artist_boost_wallets
  for select
  using (exists (
    select 1 from public.artists a
    where a.id = artist_id and a.user_id = auth.uid()
  ));

-- Song boosts
create policy "song_boosts_select_owner"
  on public.song_boosts
  for select
  using (exists (
    select 1 from public.artists a
    where a.id = artist_id and a.user_id = auth.uid()
  ));

create policy "song_boosts_insert_owner"
  on public.song_boosts
  for insert
  with check (exists (
    select 1 from public.artists a
    where a.id = artist_id and a.user_id = auth.uid()
  ));

-- Share tracking
create policy "share_tracking_select_all"
  on public.share_tracking
  for select
  using (true);

create policy "share_tracking_insert_owner_or_artist_owner"
  on public.share_tracking
  for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.artists a
      where a.id = artist_id and a.user_id = auth.uid()
    )
  );

-- Share conversions
create policy "share_conversions_select_related"
  on public.share_conversions
  for select
  using (
    exists (
      select 1
      from public.share_tracking st
      left join public.artists a on a.id = st.artist_id
      where st.id = share_id
        and (st.user_id = auth.uid() or a.user_id = auth.uid())
    )
  );

create policy "share_conversions_insert_authenticated"
  on public.share_conversions
  for insert
  with check (auth.uid() is not null);

-- User follows graph
create policy "user_follows_select_own_or_public_target"
  on public.user_follows
  for select
  using (auth.uid() = follower_user_id or auth.uid() = followed_user_id);

create policy "user_follows_insert_own"
  on public.user_follows
  for insert
  with check (auth.uid() = follower_user_id);

create policy "user_follows_delete_own"
  on public.user_follows
  for delete
  using (auth.uid() = follower_user_id);

-- Notifications
create policy "notifications_select_own"
  on public.notifications
  for select
  using (auth.uid() = user_id);

create policy "notifications_update_own"
  on public.notifications
  for update
  using (auth.uid() = user_id);

-- Push devices
create policy "push_devices_select_own"
  on public.push_devices
  for select
  using (auth.uid() = user_id);

create policy "push_devices_insert_own"
  on public.push_devices
  for insert
  with check (auth.uid() = user_id);

create policy "push_devices_update_own"
  on public.push_devices
  for update
  using (auth.uid() = user_id);

create policy "push_devices_delete_own"
  on public.push_devices
  for delete
  using (auth.uid() = user_id);

-- Creator daily metrics
create policy "creator_daily_metrics_select_artist_owner"
  on public.creator_daily_metrics
  for select
  using (exists (
    select 1 from public.artists a
    where a.id = artist_id and a.user_id = auth.uid()
  ));

-- Retention stats
create policy "user_retention_stats_select_own"
  on public.user_retention_stats
  for select
  using (auth.uid() = user_id);

create policy "user_retention_stats_insert_own"
  on public.user_retention_stats
  for insert
  with check (auth.uid() = user_id);

create policy "user_retention_stats_update_own"
  on public.user_retention_stats
  for update
  using (auth.uid() = user_id);

-- Notification preferences
create policy "user_notification_preferences_select_own"
  on public.user_notification_preferences
  for select
  using (auth.uid() = user_id);

create policy "user_notification_preferences_insert_own"
  on public.user_notification_preferences
  for insert
  with check (auth.uid() = user_id);

create policy "user_notification_preferences_update_own"
  on public.user_notification_preferences
  for update
  using (auth.uid() = user_id);

-- Leaderboard and badges
create policy "artist_leaderboard_daily_select_all"
  on public.artist_leaderboard_daily
  for select
  using (true);

create policy "fan_badges_select_all"
  on public.fan_badges
  for select
  using (true);

-- Seed defaults for existing users
insert into public.user_notification_preferences (user_id)
select p.id
from public.profiles p
left join public.user_notification_preferences up on up.user_id = p.id
where up.user_id is null;

insert into public.user_retention_stats (user_id)
select p.id
from public.profiles p
left join public.user_retention_stats rs on rs.user_id = p.id
where rs.user_id is null;
