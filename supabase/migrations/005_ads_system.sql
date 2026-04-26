-- SONARA Ads System Schema
-- Migration 005: Ad monetization system for free users

begin;

-- 1. ADS TABLE
-- Stores all advertisements
create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  media_url text not null,
  target_url text,
  ad_type text not null check (ad_type in ('banner', 'audio', 'video')),
  duration_seconds int check (duration_seconds > 0),
  active boolean default true,
  weight int default 100 check (weight > 0),
  impressions int default 0 check (impressions >= 0),
  clicks int default 0 check (clicks >= 0),
  completions int default 0 check (completions >= 0),
  cpm numeric(10, 4) default 0.00 check (cpm >= 0),
  cpc numeric(10, 4) default 0.00 check (cpc >= 0),
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ads_active on public.ads(active, start_date, end_date);
create index if not exists idx_ads_type on public.ads(ad_type);
create index if not exists idx_ads_weight on public.ads(weight desc);

-- 2. AD IMPRESSIONS TABLE
-- Tracks all ad impressions
create table if not exists public.ad_impressions (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  session_id text,
  ip_address text,
  user_agent text,
  completed boolean default false,
  duration_seconds int,
  created_at timestamptz not null default now()
);

create index if not exists idx_ad_impressions_ad on public.ad_impressions(ad_id, created_at desc);
create index if not exists idx_ad_impressions_user on public.ad_impressions(user_id, created_at desc);
create index if not exists idx_ad_impressions_session on public.ad_impressions(session_id, created_at desc);

-- 3. AD CLICKS TABLE
-- Tracks ad clicks
create table if not exists public.ad_clicks (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  impression_id uuid references public.ad_impressions(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ad_clicks_ad on public.ad_clicks(ad_id, created_at desc);
create index if not exists idx_ad_clicks_user on public.ad_clicks(user_id, created_at desc);

-- 4. AD REVENUE TABLE
-- Tracks ad revenue
create table if not exists public.ad_revenue (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads(id) on delete cascade,
  revenue_type text not null check (revenue_type in ('cpm', 'cpc')),
  amount numeric(10, 4) not null check (amount >= 0),
  metric_count int not null check (metric_count > 0),
  calculated_at timestamptz not null default now()
);

create index if not exists idx_ad_revenue_ad on public.ad_revenue(ad_id, calculated_at desc);
create index if not exists idx_ad_revenue_type on public.ad_revenue(revenue_type, calculated_at desc);

-- 5. USER AD FREQUENCY TABLE
-- Tracks when user last saw ads (frequency cap)
create table if not exists public.user_ad_frequency (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ad_type text not null,
  last_impression timestamptz not null default now(),
  impression_count int default 0 check (impression_count >= 0),
  unique(user_id, ad_type)
);

create index if not exists idx_user_ad_frequency_user on public.user_ad_frequency(user_id, ad_type);
create index if not exists idx_user_ad_frequency_last on public.user_ad_frequency(last_impression);

-- 6. AD SESSION TABLE
-- Tracks ad playback sessions
create table if not exists public.ad_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  ad_id uuid not null references public.ads(id) on delete cascade,
  song_id uuid references public.songs(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  completed boolean default false,
  skipped boolean default false
);

create index if not exists idx_ad_sessions_user on public.ad_sessions(user_id, started_at desc);
create index if not exists idx_ad_sessions_ad on public.ad_sessions(ad_id, started_at desc);

-- Updated-at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ads_updated_at on public.ads;
create trigger trg_ads_updated_at
before update on public.ads
for each row execute function public.set_updated_at();

-- RLS Policies
alter table public.ads enable row level security;
alter table public.ad_impressions enable row level security;
alter table public.ad_clicks enable row level security;
alter table public.ad_revenue enable row level security;
alter table public.user_ad_frequency enable row level security;
alter table public.ad_sessions enable row level security;

-- Ads - service role only (admin manages)
create policy "ads_select_none" on public.ads for select to authenticated using (false);
create policy "ads_insert_service" on public.ads for insert to authenticated using (false) with check (false);
create policy "ads_update_service" on public.ads for update to authenticated using (false) with check (false);

-- Ad impressions - service role only
create policy "ad_impressions_select_none" on public.ad_impressions for select to authenticated using (false);
create policy "ad_impressions_insert_service" on public.ad_impressions for insert to authenticated using (false) with check (false);

-- Ad clicks - service role only
create policy "ad_clicks_select_none" on public.ad_clicks for select to authenticated using (false);
create policy "ad_clicks_insert_service" on public.ad_clicks for insert to authenticated using (false) with check (false);

-- Ad revenue - service role only
create policy "ad_revenue_select_none" on public.ad_revenue for select to authenticated using (false);
create policy "ad_revenue_insert_service" on public.ad_revenue for insert to authenticated using (false) with check (false);

-- User ad frequency - service role only
create policy "user_ad_frequency_select_none" on public.user_ad_frequency for select to authenticated using (false);
create policy "user_ad_frequency_insert_service" on public.user_ad_frequency for insert to authenticated using (false) with check (false);
create policy "user_ad_frequency_update_service" on public.user_ad_frequency for update to authenticated using (false) with check (false);

-- Ad sessions - users can see their own
create policy "ad_sessions_select_own" on public.ad_sessions for select to authenticated using (auth.uid() = user_id);
create policy "ad_sessions_insert_service" on public.ad_sessions for insert to authenticated using (false) with check (false);
create policy "ad_sessions_update_service" on public.ad_sessions for update to authenticated using (false) with check (false);

-- Grant service role permissions
grant select, insert, update on public.ads to postgres;
grant select, insert, update on public.ad_impressions to postgres;
grant select, insert, update on public.ad_clicks to postgres;
grant select, insert, update on public.ad_revenue to postgres;
grant select, insert, update on public.user_ad_frequency to postgres;
grant select, insert, update on public.ad_sessions to postgres;

-- Ad delivery function
create or replace function public.get_next_ad(p_user_id uuid, p_ad_type text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad record;
  v_last_impression timestamptz;
  v_frequency_cap_minutes int := 3; -- Max 1 ad per 3 minutes
  v_subscription text;
begin
  -- Check user subscription
  select subscription_status into v_subscription
  from public.profiles
  where id = p_user_id;
  
  -- No ads for premium users
  if v_subscription = 'premium' then
    return json_build_object('ok', false, 'reason', 'premium_user');
  end if;
  
  -- Check frequency cap
  select last_impression into v_last_impression
  from public.user_ad_frequency
  where user_id = p_user_id and ad_type = p_ad_type;
  
  if v_last_impression is not null and
     (now() - v_last_impression) < (v_frequency_cap_minutes || ' minutes')::interval then
    return json_build_object('ok', false, 'reason', 'frequency_cap');
  end if;
  
  -- Get weighted random ad
  select a.id, a.title, a.media_url, a.target_url, a.ad_type, a.duration_seconds
  into v_ad
  from public.ads a
  where a.active = true
    and a.ad_type = p_ad_type
    and (a.start_date is null or a.start_date <= now())
    and (a.end_date is null or a.end_date >= now())
  order by random() * a.weight
  limit 1;
  
  if not found then
    return json_build_object('ok', false, 'reason', 'no_ads_available');
  end if;
  
  -- Update frequency cap
  insert into public.user_ad_frequency (user_id, ad_type, last_impression, impression_count)
  values (p_user_id, p_ad_type, now(), 1)
  on conflict (user_id, ad_type)
  do update set
    last_impression = now(),
    impression_count = user_ad_frequency.impression_count + 1;
  
  return json_build_object(
    'ok', true,
    'ad', json_build_object(
      'id', v_ad.id,
      'title', v_ad.title,
      'media_url', v_ad.media_url,
      'target_url', v_ad.target_url,
      'ad_type', v_ad.ad_type,
      'duration_seconds', v_ad.duration_seconds
    )
  );
end;
$$;

grant execute on function public.get_next_ad(uuid, text) to authenticated;

-- Track impression function
create or replace function public.track_ad_impression(p_ad_id uuid, p_user_id uuid, p_session_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_impression_id uuid;
begin
  -- Create impression record
  insert into public.ad_impressions (ad_id, user_id, session_id)
  values (p_ad_id, p_user_id, p_session_id)
  returning id into v_impression_id;
  
  -- Update ad impressions count
  update public.ads
  set impressions = impressions + 1
  where id = p_ad_id;
  
  return json_build_object('ok', true, 'impression_id', v_impression_id);
end;
$$;

grant execute on function public.track_ad_impression(uuid, uuid, text) to authenticated;

-- Track completion function
create or replace function public.track_ad_completion(p_impression_id uuid, p_duration_seconds int)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Mark impression as completed
  update public.ad_impressions
  set completed = true,
      duration_seconds = p_duration_seconds
  where id = p_impression_id;
  
  -- Update ad completions count
  update public.ads a
  set completions = a.completions + 1
  from public.ad_impressions i
  where i.id = p_impression_id and i.ad_id = a.id;
  
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.track_ad_completion(uuid, int) to authenticated;

commit;
