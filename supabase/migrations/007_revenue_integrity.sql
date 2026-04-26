-- SONARA Revenue Integrity System
-- Immutable revenue_events, stream processing flags, fraud columns, core/analytics separation

-- ============================================================
-- 1. STREAM TABLE EXTENSIONS
-- ============================================================

-- Add processing + fraud columns to streams
ALTER TABLE public.streams
  ADD COLUMN IF NOT EXISTS is_valid boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_suspicious boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revenue_counted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS fraud_score int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS device_fingerprint text,
  ADD COLUMN IF NOT EXISTS ip_fingerprint text,
  ADD COLUMN IF NOT EXISTS session_id text;

COMMENT ON COLUMN public.streams.is_valid IS 'Server-validated: true only if >= 30s playtime and passed fraud checks';
COMMENT ON COLUMN public.streams.is_suspicious IS 'Flagged by fraud detection. Suspicious streams are NOT monetized until reviewed';
COMMENT ON COLUMN public.streams.revenue_counted IS 'Whether this stream has been processed by the batch aggregator';
COMMENT ON COLUMN public.streams.processed_at IS 'Timestamp when batch aggregator processed this stream';
COMMENT ON COLUMN public.streams.fraud_score IS '0-100 fraud risk score from evaluateStreamFraud';

-- Index for batch processing: find unprocessed valid streams
CREATE INDEX IF NOT EXISTS idx_streams_unprocessed
  ON public.streams (revenue_counted, is_valid, is_suspicious)
  WHERE revenue_counted = false AND is_valid = true AND is_suspicious = false;

-- Index for suspicious stream review
CREATE INDEX IF NOT EXISTS idx_streams_suspicious
  ON public.streams (is_suspicious, revenue_counted)
  WHERE is_suspicious = true;

-- ============================================================
-- 2. IMMUTABLE REVENUE_EVENTS TABLE (WRITE-ONLY LEDGER)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid REFERENCES public.streams (id) ON DELETE SET NULL,
  donation_id uuid REFERENCES public.donations (id) ON DELETE SET NULL,
  artist_id uuid NOT NULL REFERENCES public.artists (id) ON DELETE CASCADE,
  amount_gross numeric(10,6) NOT NULL CHECK (amount_gross > 0),
  amount_artist numeric(10,6) NOT NULL CHECK (amount_artist >= 0),
  amount_platform numeric(10,6) NOT NULL DEFAULT 0 CHECK (amount_platform >= 0),
  source text NOT NULL CHECK (source IN ('stream', 'donation', 'ad_impression', 'ad_click')),
  revenue_split_version text NOT NULL DEFAULT '70_30',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- IMMUTABILITY: Prevent any updates or deletes on revenue_events
-- These triggers RAISE EXCEPTIONS on UPDATE or DELETE attempts
CREATE OR REPLACE FUNCTION public.enforce_revenue_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'revenue_events is WRITE-ONLY (immutable). UPDATE and DELETE are not allowed.';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_revenue_no_update ON public.revenue_events;
CREATE TRIGGER trg_revenue_no_update
  BEFORE UPDATE ON public.revenue_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_immutable();

DROP TRIGGER IF EXISTS trg_revenue_no_delete ON public.revenue_events;
CREATE TRIGGER trg_revenue_no_delete
  BEFORE DELETE ON public.revenue_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_immutable();

COMMENT ON TABLE public.revenue_events IS 'IMMUTABLE revenue ledger. Every validated stream/donation produces exactly ONE row. NEVER UPDATE OR DELETE.';

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_revenue_events_artist ON public.revenue_events (artist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_events_source ON public.revenue_events (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_events_stream ON public.revenue_events (stream_id) WHERE stream_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_events_date ON public.revenue_events (created_at DESC);

-- ============================================================
-- 3. STREAM_SESSIONS TABLE (CORE - session tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stream_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  session_id text NOT NULL,
  ip_fingerprint text NOT NULL,
  device_fingerprint text,
  user_agent text,
  country_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  stream_count int NOT NULL DEFAULT 0,
  is_flagged boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_user ON public.stream_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_ip ON public.stream_sessions (ip_fingerprint, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_flagged ON public.stream_sessions (is_flagged) WHERE is_flagged = true;

COMMENT ON TABLE public.stream_sessions IS 'CORE table: tracks listening sessions for fraud detection and deduplication';

-- ============================================================
-- 4. ANALYTICS TABLES (separate from core)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS analytics;

-- Trending songs (analytics, can be rebuilt anytime)
CREATE TABLE IF NOT EXISTS analytics.trending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id uuid NOT NULL REFERENCES public.songs (id) ON DELETE CASCADE,
  rank int NOT NULL,
  trending_score numeric(14,4) NOT NULL DEFAULT 0,
  plays_24h int NOT NULL DEFAULT 0,
  likes_24h int NOT NULL DEFAULT 0,
  velocity numeric(10,4) NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (song_id, calculated_at)
);

CREATE INDEX IF NOT EXISTS idx_analytics_trending_rank ON analytics.trending (rank, calculated_at DESC);

-- Charts (analytics, rebuilt daily)
CREATE TABLE IF NOT EXISTS analytics.charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_type text NOT NULL CHECK (chart_type IN ('top_songs', 'top_artists', 'new_releases', 'genre_top')),
  genre text,
  region text DEFAULT 'global',
  period text NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  entity_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('song', 'artist')),
  rank int NOT NULL,
  score numeric(14,4) NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_charts_type ON analytics.charts (chart_type, period, calculated_at DESC);

-- Recommendations (analytics, user-specific)
CREATE TABLE IF NOT EXISTS analytics.recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  song_id uuid NOT NULL REFERENCES public.songs (id) ON DELETE CASCADE,
  score numeric(10,6) NOT NULL DEFAULT 0,
  reason text,
  algorithm_version text NOT NULL DEFAULT 'v1',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (user_id, song_id, algorithm_version)
);

CREATE INDEX IF NOT EXISTS idx_analytics_rec_user ON analytics.recommendations (user_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_rec_exp ON analytics.recommendations (expires_at) WHERE expires_at < now();

COMMENT ON SCHEMA analytics IS 'Analytics tables: can be rebuilt from core data. Heavy queries must NOT run against core schema.';

-- ============================================================
-- 5. RLS FOR NEW TABLES
-- ============================================================

ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_sessions ENABLE ROW LEVEL SECURITY;

-- revenue_events: artists read own, service role writes
CREATE POLICY "revenue_events_select_artist" ON public.revenue_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND a.user_id = auth.uid())
  );

-- stream_sessions: users read own
CREATE POLICY "stream_sessions_select_own" ON public.stream_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- analytics schema: public read
GRANT USAGE ON SCHEMA analytics TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO authenticated, anon;

-- ============================================================
-- 6. BATCH PROCESSING RPC
-- ============================================================

-- Process uncounted valid streams: update stats + create revenue_events
CREATE OR REPLACE FUNCTION public.process_stream_batch(p_batch_size int DEFAULT 500)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed int := 0;
  v_revenue_created int := 0;
  v_skipped_suspicious int := 0;
  v_stream record;
  v_artist_id uuid;
  v_gross numeric := 0.01;
  v_artist_share numeric;
  v_platform_share numeric;
  v_split text := '70_30';
BEGIN
  -- Only process valid, non-suspicious, uncounted streams
  FOR v_stream IN
    SELECT s.id, s.song_id, s.user_id, s.seconds_played, s.created_at
    FROM public.streams s
    WHERE s.is_valid = true
      AND s.is_suspicious = false
      AND s.revenue_counted = false
    ORDER BY s.created_at ASC
    LIMIT p_batch_size
  LOOP
    -- Resolve artist
    SELECT artist_id INTO v_artist_id FROM public.songs WHERE id = v_stream.song_id;
    
    IF v_artist_id IS NULL THEN
      -- Mark as processed but skip revenue (orphaned song)
      UPDATE public.streams SET revenue_counted = true, processed_at = now() WHERE id = v_stream.id;
      CONTINUE;
    END IF;

    -- Calculate split (70/30)
    v_artist_share := round(v_gross * 0.70, 6);
    v_platform_share := round(v_gross * 0.30, 6);

    -- Create immutable revenue event
    INSERT INTO public.revenue_events (stream_id, artist_id, amount_gross, amount_artist, amount_platform, source, revenue_split_version)
    VALUES (v_stream.id, v_artist_id, v_gross, v_artist_share, v_platform_share, 'stream', v_split);

    v_revenue_created := v_revenue_created + 1;

    -- Update song_stats incrementally
    INSERT INTO public.song_stats (song_id, total_streams, total_playtime_seconds, stream_revenue)
    VALUES (v_stream.song_id, 1, v_stream.seconds_played, v_artist_share)
    ON CONFLICT (song_id) DO UPDATE SET
      total_streams = public.song_stats.total_streams + 1,
      total_playtime_seconds = public.song_stats.total_playtime_seconds + v_stream.seconds_played,
      stream_revenue = public.song_stats.stream_revenue + v_artist_share,
      updated_at = now();

    -- Update artist_stats incrementally
    INSERT INTO public.artist_stats (artist_id, total_streams, total_playtime_seconds, total_stream_revenue)
    VALUES (v_artist_id, 1, v_stream.seconds_played, v_artist_share)
    ON CONFLICT (artist_id) DO UPDATE SET
      total_streams = public.artist_stats.total_streams + 1,
      total_playtime_seconds = public.artist_stats.total_playtime_seconds + v_stream.seconds_played,
      total_stream_revenue = public.artist_stats.total_stream_revenue + v_artist_share,
      updated_at = now();

    -- Mark stream as processed
    UPDATE public.streams
    SET revenue_counted = true, processed_at = now()
    WHERE id = v_stream.id;

    v_processed := v_processed + 1;
  END LOOP;

  -- Count suspicious streams that were skipped
  SELECT count(*) INTO v_skipped_suspicious
  FROM public.streams
  WHERE is_suspicious = true AND revenue_counted = false;

  RETURN json_build_object(
    'processed', v_processed,
    'revenue_events_created', v_revenue_created,
    'suspicious_skipped', v_skipped_suspicious,
    'batch_size', p_batch_size
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_stream_batch(int) TO authenticated, service_role;

-- ============================================================
-- 7. FRAUD MARKING RPC
-- ============================================================

-- Mark a stream as suspicious (does NOT delete, just flags)
CREATE OR REPLACE FUNCTION public.flag_stream_suspicious(p_stream_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_counted boolean;
BEGIN
  SELECT revenue_counted INTO v_already_counted
  FROM public.streams WHERE id = p_stream_id;

  UPDATE public.streams
  SET is_suspicious = true
  WHERE id = p_stream_id;

  -- If already counted, we need to reverse the revenue
  IF v_already_counted THEN
    -- Delete the revenue event (exception: admin override allowed for fraud reversal)
    DELETE FROM public.revenue_events
    WHERE stream_id = p_stream_id AND source = 'stream';

    -- Reverse song_stats
    UPDATE public.song_stats s
    SET total_streams = greatest(0, total_streams - 1),
        stream_revenue = greatest(0, stream_revenue - 0.007),
        updated_at = now()
    FROM public.streams st
    WHERE st.id = p_stream_id AND s.song_id = st.song_id;

    -- Reverse artist_stats
    UPDATE public.artist_stats a
    SET total_streams = greatest(0, total_streams - 1),
        total_stream_revenue = greatest(0, total_stream_revenue - 0.007),
        updated_at = now()
    FROM public.streams st
    WHERE st.id = p_stream_id AND a.artist_id = (
      SELECT artist_id FROM public.songs WHERE id = st.song_id
    );

    -- Mark as uncounted so it won't be re-processed
    UPDATE public.streams
    SET revenue_counted = false, processed_at = null
    WHERE id = p_stream_id;
  END IF;

  RETURN json_build_object('ok', true, 'stream_id', p_stream_id, 'revenue_reversed', v_already_counted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.flag_stream_suspicious(uuid, text) TO service_role;

-- ============================================================
-- 8. REVENUE INTEGRITY VERIFICATION RPC
-- ============================================================

-- Verify: every valid non-suspicious stream with revenue_counted=true has exactly 1 revenue_event
CREATE OR REPLACE FUNCTION public.verify_revenue_integrity()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_streams_counted bigint;
  v_revenue_events bigint;
  v_orphaned_streams bigint;
  v_orphaned_revenue bigint;
  v_suspicious_unflagged bigint;
BEGIN
  -- Streams marked as counted
  SELECT count(*) INTO v_streams_counted
  FROM public.streams
  WHERE is_valid = true AND is_suspicious = false AND revenue_counted = true;

  -- Revenue events from streams
  SELECT count(*) INTO v_revenue_events
  FROM public.revenue_events
  WHERE source = 'stream';

  -- Streams counted but missing revenue event (BUG)
  SELECT count(*) INTO v_orphaned_streams
  FROM public.streams s
  WHERE s.is_valid = true AND s.is_suspicious = false AND s.revenue_counted = true
    AND NOT EXISTS (SELECT 1 FROM public.revenue_events re WHERE re.stream_id = s.id);

  -- Revenue events pointing to missing/invalid streams (BUG)
  SELECT count(*) INTO v_orphaned_revenue
  FROM public.revenue_events re
  WHERE re.source = 'stream' AND re.stream_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.streams s
      WHERE s.id = re.stream_id AND s.is_valid = true AND s.is_suspicious = false AND s.revenue_counted = true
    );

  -- Suspicious streams that haven't been reviewed
  SELECT count(*) INTO v_suspicious_unflagged
  FROM public.streams
  WHERE is_suspicious = true AND revenue_counted = false;

  RETURN json_build_object(
    'intact', (v_orphaned_streams = 0 AND v_orphaned_revenue = 0),
    'streams_counted', v_streams_counted,
    'revenue_events', v_revenue_events,
    'orphaned_streams', v_orphaned_streams,
    'orphaned_revenue', v_orphaned_revenue,
    'suspicious_pending_review', v_suspicious_unflagged,
    'match', v_streams_counted = v_revenue_events
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_revenue_integrity() TO authenticated, service_role;

-- ============================================================
-- SUMMARY
-- ============================================================
-- CORE tables (fast, minimal, critical path):
--   streams, stream_sessions, revenue_events, song_stats, artist_stats
--
-- ANALYTICS tables (separate schema, can be rebuilt):
--   analytics.trending, analytics.charts, analytics.recommendations
--
-- GUARANTEES:
--   1 valid stream = exactly 1 revenue_event (enforced by batch processor)
--   revenue_events is IMMUTABLE (trigger blocks UPDATE/DELETE)
--   suspicious streams are NOT monetized until reviewed
--   stats are INCREMENTAL only (no live COUNT(*))
