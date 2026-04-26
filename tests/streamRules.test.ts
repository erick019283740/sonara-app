import { describe, expect, it } from "vitest";
import {
  DAILY_STREAM_LIMIT_PER_SONG,
  FRAUD_BLOCK_THRESHOLD,
  calculateEarningsSplit,
  exceedsDailyStreamLimit,
  isFraudBlocked,
  isValidStreamDuration,
} from "../src/lib/domain/streamRules";

describe("stream validation rules", () => {
  it("enforces 30-second minimum stream duration", () => {
    expect(isValidStreamDuration(29)).toBe(false);
    expect(isValidStreamDuration(30)).toBe(true);
    expect(isValidStreamDuration(61)).toBe(true);
  });

  it("enforces fraud detection thresholds", () => {
    expect(isFraudBlocked(FRAUD_BLOCK_THRESHOLD)).toBe(false);
    expect(isFraudBlocked(FRAUD_BLOCK_THRESHOLD + 1)).toBe(true);
    expect(exceedsDailyStreamLimit(DAILY_STREAM_LIMIT_PER_SONG - 1)).toBe(false);
    expect(exceedsDailyStreamLimit(DAILY_STREAM_LIMIT_PER_SONG)).toBe(true);
  });

  it("splits earnings 60/40 between artist and platform", () => {
    const split = calculateEarningsSplit(10);
    expect(split.artistShare).toBe(6);
    expect(split.platformShare).toBe(4);
  });
});
