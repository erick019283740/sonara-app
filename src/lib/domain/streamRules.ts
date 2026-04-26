export const MIN_VALID_STREAM_SECONDS = 30;
export const DAILY_STREAM_LIMIT_PER_SONG = 10;
export const FRAUD_BLOCK_THRESHOLD = 75;

export type EarningsSplit = {
  artistShare: number;
  platformShare: number;
};

export function isValidStreamDuration(durationPlayedSeconds: number): boolean {
  return Number.isFinite(durationPlayedSeconds) && durationPlayedSeconds >= MIN_VALID_STREAM_SECONDS;
}

export function calculateEarningsSplit(total: number): EarningsSplit {
  const amount = Number.isFinite(total) ? total : 0;
  const artistShare = Number((amount * 0.6).toFixed(6));
  const platformShare = Number((amount * 0.4).toFixed(6));
  return { artistShare, platformShare };
}

export function exceedsDailyStreamLimit(
  currentCount: number,
  limit = DAILY_STREAM_LIMIT_PER_SONG,
): boolean {
  return currentCount >= limit;
}

export function isFraudBlocked(riskScore: number, threshold = FRAUD_BLOCK_THRESHOLD): boolean {
  return riskScore > threshold;
}
