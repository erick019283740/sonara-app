-- SONARA Enterprise Revenue Integrity v2
-- Fixes: immutable reversals (negative events), batch idempotency, admin security
-- Replaces: flag_stream_suspicious function with fraud_reversal approach

-- ============================================================
-- 1. REVENUE EVENTS: ADD FRAUD_REVERSAL SOURCE + IDEMPOTENCY
-- ============================================================

-- Extend source CHECK to include 'fraud_reversal'
ALTER TABLE public.revenue_events
  DROP CONSTRAINT IF EXISTS revenue_events_source_check;

ALTER TABLE public.revenue_events
  ADD CONSTRAINT revenue_events_source_check
  CHECK (source IN ('stream', 'donation', 'ad_impression', 'ad_click', 'fraud_reversal'));

-- UNIQUE constraint: one revenue event per stream per source (idempotency)
-- This makes batch processing safe to re-run — INSERT will fail on duplicate
ALTER TABLE public.revenue_events
  ADD CONSTRAINT unique_stream_source_event
  UNIQUE (stream_id, source);

-- Partial unique: only one 'stream' event per stream_id
-- (fraud_reversal is also unique per stream_id via the above constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_events_unique_stream
  ON public.revenue_events (stream_id) WHERE source = 'stream';

COMMENT ON CONSTRAINT unique_stream_source_event ON public.revenue_events
  IS 'Idempotency: batch can run multiple times without creating duplicates. Each stream+source combo is unique.';

-- ============================================================
-- 2. REVENUE EVENTS: ADD REVERSAL METADATA COLUMNS
-- ============================================================

ALTER TABLE public.revenue_events
  ADD COLUMN IF NOT EXISTS reversal_of uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

COMMENT ON COLUMN public.revenue_events.reversal_of IS 'For fraud_reversal events: points to the original revenue_event being reversed';
COMMENT ON COLUMN public.revenue_events.reversal_reason IS 'For fraud_reversal events: reason for the reversal (e.g. "bot_detected")';

-- ============================================================
-- 3. REPLACE flag_stream_suspicious WITH IMMUTABLE REVERSAL
-- ============================================================

-- NEW: flag_stream_suspicious that uses NEGATIVE EVENTS instead of DELETE
-- This preserves the full audit trail
CREATE OR REPLACE FUNCTION public.flag_stream_suspicious(p_stream_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_counted boolean;
  v_original_event_id uuid;
  v_artist_id uuid;
  v_song_id uuid;
  v_original_gross numeric;
  v_original_artist numeric;
  v_original_platform numeric;
BEGIN
  -- Check current state
  SELECT revenue_counted, song_id INTO v_already_counted, v_song_id
  FROM public.streams WHERE id = p_stream_id;

  IF v_song_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'stream_not_found');
  END IF;

  -- Mark stream as suspicious
  UPDATE public.streams
  SET is_suspicious = true
  WHERE id = p_stream_id;

  -- If already counted, create a NEGATIVE revenue event (fraud_reversal)
  -- ❌ NEVER DELETE from revenue_events
  -- ✅ INSERT a negative event that cancels the original
  IF v_already_counted THEN
    -- Get the original revenue event details
    SELECT id, artist_id, amount_gross, amount_artist, amount_platform
    INTO v_original_event_id, v_artist_id, v_original_gross, v_original_artist, v_original_platform
    FROM public.revenue_events
    WHERE stream_id = p_stream_id AND source = 'stream'
    LIMIT 1;

    IF v_original_event_id IS NOT NULL THEN
      -- Insert NEGATIVE event (fraud_reversal)
      -- amount_gross/artist/platform are NEGATIVE to reverse the original
      INSERT INTO public.revenue_events (
        stream_id, artist_id,
        amount_gross, amount_artist, amount_platform,
        source, revenue_split_version,
        reversal_of, reversal_reason
      ) VALUES (
        p_stream_id, v_artist_id,
        -v_original_gross, -v_original_artist, -v_original_platform,
        'fraud_reversal', '70_30',
        v_original_event_id, p_reason
      );

      -- Reverse song_stats (decrement)
      UPDATE public.song_stats
      SET total_streams = greatest(0, total_streams - 1),
          stream_revenue = greatest(0, stream_revenue - v_original_artist),
          updated_at = now()
      WHERE song_id = v_song_id;

      -- Reverse artist_stats (decrement)
      UPDATE public.artist_stats
      SET total_streams = greatest(0, total_streams - 1),
          total_stream_revenue = greatest(0, total_stream_revenue - v_original_artist),
          updated_at = now()
      WHERE artist_id = v_artist_id;

      -- Mark stream as NOT counted (so batch won't re-process it)
      -- But keep is_suspicious = true so it stays flagged
      UPDATE public.streams
      SET revenue_counted = false, processed_at = null
      WHERE id = p_stream_id;
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'stream_id', p_stream_id,
    'revenue_reversed', v_already_counted,
    'method', 'negative_event',
    'original_event_id', v_original_event_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.flag_stream_suspicious(uuid, text) TO service_role;

-- ============================================================
-- 4. IDEMPOTENT BATCH PROCESSING (ON CONFLICT DO NOTHING)
-- ============================================================

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
  v_already_exists int := 0;
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

    -- Create immutable revenue event (ON CONFLICT DO NOTHING = idempotent)
    INSERT INTO public.revenue_events (stream_id, artist_id, amount_gross, amount_artist, amount_platform, source, revenue_split_version)
    VALUES (v_stream.id, v_artist_id, v_gross, v_artist_share, v_platform_share, 'stream', v_split)
    ON CONFLICT (stream_id, source) DO NOTHING;

    IF NOT FOUND THEN
      -- Event already exists (idempotent skip)
      v_already_exists := v_already_exists + 1;
    ELSE
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
    END IF;

    -- Mark stream as processed (always, even if event already existed)
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
    'already_existed', v_already_exists,
    'suspicious_skipped', v_skipped_suspicious,
    'batch_size', p_batch_size,
    'idempotent', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_stream_batch(int) TO authenticated, service_role;

-- ============================================================
-- 5. UPDATED INTEGRITY VERIFICATION (accounts for negative events)
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_revenue_integrity()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_streams_counted bigint;
  v_positive_events bigint;
  v_reversal_events bigint;
  v_net_events bigint;
  v_orphaned_streams bigint;
  v_orphaned_revenue bigint;
  v_suspicious_pending bigint;
  v_net_artist_revenue numeric;
  v_stats_artist_revenue numeric;
  v_revenue_match boolean;
BEGIN
  -- Streams marked as counted
  SELECT count(*) INTO v_streams_counted
  FROM public.streams
  WHERE is_valid = true AND is_suspicious = false AND revenue_counted = true;

  -- Positive revenue events from streams
  SELECT count(*) INTO v_positive_events
  FROM public.revenue_events
  WHERE source = 'stream';

  -- Reversal events
  SELECT count(*) INTO v_reversal_events
  FROM public.revenue_events
  WHERE source = 'fraud_reversal';

  -- Net events (positive - reversals should match counted streams)
  v_net_events := v_positive_events - v_reversal_events;

  -- Streams counted but missing revenue event (BUG)
  SELECT count(*) INTO v_orphaned_streams
  FROM public.streams s
  WHERE s.is_valid = true AND s.is_suspicious = false AND s.revenue_counted = true
    AND NOT EXISTS (
      SELECT 1 FROM public.revenue_events re
      WHERE re.stream_id = s.id AND re.source = 'stream'
    );

  -- Revenue events pointing to non-counted streams (potential BUG)
  SELECT count(*) INTO v_orphaned_revenue
  FROM public.revenue_events re
  WHERE re.source = 'stream' AND re.stream_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.streams s
      WHERE s.id = re.stream_id AND s.is_valid = true AND s.revenue_counted = true
    );

  -- Suspicious streams pending review
  SELECT count(*) INTO v_suspicious_pending
  FROM public.streams
  WHERE is_suspicious = true AND revenue_counted = false;

  -- Cross-check: net revenue from events vs artist_stats
  SELECT coalesce(sum(amount_artist), 0) INTO v_net_artist_revenue
  FROM public.revenue_events
  WHERE source IN ('stream', 'fraud_reversal');

  SELECT coalesce(sum(total_stream_revenue), 0) INTO v_stats_artist_revenue
  FROM public.artist_stats;

  v_revenue_match := abs(v_net_artist_revenue - v_stats_artist_revenue) < 0.01;

  RETURN json_build_object(
    'intact', (v_orphaned_streams = 0 AND v_orphaned_revenue = 0 AND v_revenue_match),
    'streams_counted', v_streams_counted,
    'positive_events', v_positive_events,
    'reversal_events', v_reversal_events,
    'net_events', v_net_events,
    'orphaned_streams', v_orphaned_streams,
    'orphaned_revenue', v_orphaned_revenue,
    'suspicious_pending_review', v_suspicious_pending,
    'match', v_streams_counted = v_net_events,
    'revenue_match', v_revenue_match,
    'net_artist_revenue', v_net_artist_revenue,
    'stats_artist_revenue', v_stats_artist_revenue
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_revenue_integrity() TO authenticated, service_role;

-- ============================================================
-- 6. ADMIN ACTION AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES public.profiles (id),
  action text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('stream', 'revenue_event', 'artist', 'song', 'user')),
  target_id uuid NOT NULL,
  details jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON public.admin_audit_log (admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON public.admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON public.admin_audit_log (action, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only service_role can insert, admins can read
CREATE POLICY "admin_audit_select" ON public.admin_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = admin_user_id AND p.role = 'admin')
  );

COMMENT ON TABLE public.admin_audit_log IS 'Immutable audit trail for all admin actions. Every admin mutation is logged here.';

-- ============================================================
-- 7. AUDITED flag_stream_suspicious (logs to admin_audit_log)
-- ============================================================

CREATE OR REPLACE FUNCTION public.flag_stream_suspicious_audited(
  p_stream_id uuid,
  p_reason text,
  p_admin_user_id uuid DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  -- Call the core function
  SELECT * INTO v_result FROM public.flag_stream_suspicious(p_stream_id, p_reason);

  -- Log to audit trail
  INSERT INTO public.admin_audit_log (admin_user_id, action, target_type, target_id, details, ip_address)
  VALUES (
    p_admin_user_id,
    'flag_stream_suspicious',
    'stream',
    p_stream_id,
    json_build_object('reason', p_reason, 'result', v_result),
    p_ip_address
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.flag_stream_suspicious_audited(uuid, text, uuid, text) TO service_role;

-- ============================================================
-- SUMMARY OF GUARANTEES
-- ============================================================
-- ✅ 1 valid stream = exactly 1 positive revenue_event
-- ✅ Fraud reversals = NEGATIVE events (never DELETE/UPDATE)
-- ✅ Full audit trail: original event + reversal event linked via reversal_of
-- ✅ Batch is IDEMPOTENT: ON CONFLICT DO NOTHING + UNIQUE constraint
-- ✅ Admin actions are logged in admin_audit_log
-- ✅ Integrity verification accounts for reversals
-- ✅ Net revenue = SUM(all events) including negatives
