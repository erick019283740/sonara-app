-- SONARA Core Monetization System Schema
-- Stream tracking, earnings, and trending scores

-- 1. STREAMS TABLE
-- Tracks all play events for monetization and analytics
CREATE TABLE IF NOT EXISTS streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL,
  duration_played_seconds INT NOT NULL,
  total_duration_seconds INT NOT NULL,
  is_valid BOOLEAN DEFAULT FALSE,
  stream_value DECIMAL(10, 4) DEFAULT 0.01,
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Indexes for fast queries
  CONSTRAINT valid_duration CHECK (duration_played_seconds >= 0 AND duration_played_seconds <= total_duration_seconds)
);

CREATE INDEX idx_streams_user_song ON streams(user_id, song_id, created_at);
CREATE INDEX idx_streams_valid ON streams(is_valid, created_at);
CREATE INDEX idx_streams_song ON streams(song_id, created_at DESC);

-- 2. STREAM DAILY LIMITS
-- Tracks streams per user per song per day (fraud prevention)
CREATE TABLE IF NOT EXISTS stream_daily_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  song_id UUID NOT NULL,
  stream_count INT DEFAULT 0,
  last_stream_date DATE DEFAULT CURRENT_DATE,
  
  UNIQUE(user_id, song_id, last_stream_date),
  CONSTRAINT max_10_streams CHECK (stream_count <= 10)
);

CREATE INDEX idx_stream_limits_user_song ON stream_daily_limits(user_id, song_id, last_stream_date);

-- 3. EARNINGS TABLE
-- Aggregated earnings for artists and platform
CREATE TABLE IF NOT EXISTS earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_earnings DECIMAL(15, 2) DEFAULT 0,
  platform_fee DECIMAL(15, 2) DEFAULT 0,
  earnings_this_month DECIMAL(15, 2) DEFAULT 0,
  earnings_last_month DECIMAL(15, 2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(artist_id)
);

CREATE INDEX idx_earnings_artist ON earnings(artist_id);

-- 4. STREAM PAYOUTS
-- Individual payout records for transparency
CREATE TABLE IF NOT EXISTS stream_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL,
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  payout_amount DECIMAL(10, 4) NOT NULL,
  payout_date TIMESTAMP DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'pending' -- pending, completed, failed
);

CREATE INDEX idx_payouts_artist_date ON stream_payouts(artist_id, payout_date DESC);
CREATE INDEX idx_payouts_stream ON stream_payouts(stream_id);

-- 5. TRENDING SCORES
-- Cached trending scores for fast feed queries (recalculated periodically)
CREATE TABLE IF NOT EXISTS trending_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trending_score DECIMAL(15, 4) NOT NULL DEFAULT 0,
  plays_24h INT DEFAULT 0,
  likes_count INT DEFAULT 0,
  completion_rate DECIMAL(5, 2) DEFAULT 0,
  shares_count INT DEFAULT 0,
  is_new_song BOOLEAN DEFAULT FALSE,
  days_since_upload INT DEFAULT 0,
  calculated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(song_id)
);

CREATE INDEX idx_trending_score ON trending_scores(trending_score DESC, calculated_at DESC);
CREATE INDEX idx_trending_new_songs ON trending_scores(is_new_song, trending_score DESC);

-- 6. SONG METADATA FOR TRENDING
-- Extends songs table with metrics needed for trending calculations
CREATE TABLE IF NOT EXISTS song_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL,
  plays_last_24h INT DEFAULT 0,
  likes INT DEFAULT 0,
  shares INT DEFAULT 0,
  completion_rate DECIMAL(5, 2) DEFAULT 0,
  total_play_time_seconds INT DEFAULT 0,
  total_listeners INT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(song_id)
);

CREATE INDEX idx_song_metrics_plays ON song_metrics(plays_last_24h DESC);

-- 7. VIRAL DISCOVERY FEED
-- Stores feed personalization and engagement tracking
CREATE TABLE IF NOT EXISTS discovery_feed_engagement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL,
  liked BOOLEAN DEFAULT FALSE,
  followed_artist BOOLEAN DEFAULT FALSE,
  supported_artist BOOLEAN DEFAULT FALSE,
  engaged_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, song_id)
);

CREATE INDEX idx_feed_engagement_user ON discovery_feed_engagement(user_id, engaged_at DESC);
CREATE INDEX idx_feed_engagement_song ON discovery_feed_engagement(song_id);

-- GRANT PERMISSIONS FOR SERVICE ROLE
-- This allows backend to update earnings and trending scores
GRANT SELECT, INSERT, UPDATE ON streams TO postgres;
GRANT SELECT, INSERT, UPDATE ON earnings TO postgres;
GRANT SELECT, INSERT, UPDATE ON stream_payouts TO postgres;
GRANT SELECT, INSERT, UPDATE ON trending_scores TO postgres;
GRANT SELECT, INSERT, UPDATE ON song_metrics TO postgres;
GRANT SELECT, INSERT, UPDATE ON discovery_feed_engagement TO postgres;
GRANT SELECT, INSERT, UPDATE ON stream_daily_limits TO postgres;
