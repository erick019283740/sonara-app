import { NextRequest, NextResponse } from "next/server";
import { batchRecalculateTrendingScores } from "@/lib/workers/trendingProcessor";
import {
  processEarningsAggregation,
  processMonthlyPayouts,
  cleanupExpiredSessions,
  archiveOldStreamData,
} from "@/lib/workers/earningsProcessor";

type CronJob =
  | "trending"
  | "earnings"
  | "payouts"
  | "cleanup"
  | "archive"
  | "all";

type CronRequestBody = {
  job?: unknown;
};

const ALLOWED_JOBS: readonly CronJob[] = [
  "trending",
  "earnings",
  "payouts",
  "cleanup",
  "archive",
  "all",
];

function getCronSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error(
      "CRON_SECRET is missing or too weak. Set a strong secret with at least 16 characters.",
    );
  }
  return secret;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

function parseJob(value: unknown): CronJob | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ALLOWED_JOBS.includes(normalized as CronJob)
    ? (normalized as CronJob)
    : null;
}

async function runJob(job: CronJob): Promise<void> {
  switch (job) {
    case "trending":
      await batchRecalculateTrendingScores();
      return;
    case "earnings":
      await processEarningsAggregation();
      return;
    case "payouts":
      await processMonthlyPayouts();
      return;
    case "cleanup":
      await cleanupExpiredSessions();
      return;
    case "archive":
      await archiveOldStreamData();
      return;
    case "all":
      await batchRecalculateTrendingScores();
      await processEarningsAggregation();
      await processMonthlyPayouts();
      await cleanupExpiredSessions();
      await archiveOldStreamData();
      return;
    default: {
      const neverJob: never = job;
      throw new Error(`Unhandled cron job: ${String(neverJob)}`);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const secret = getCronSecret();
    const token = extractBearerToken(request.headers.get("authorization"));

    if (!token || !safeEqual(token, secret)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: CronRequestBody;
    try {
      body = (await request.json()) as CronRequestBody;
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }

    const job = parseJob(body.job);
    if (!job) {
      return NextResponse.json(
        {
          error: "invalid_job",
          allowedJobs: ALLOWED_JOBS,
        },
        { status: 400 },
      );
    }

    await runJob(job);

    return NextResponse.json(
      {
        ok: true,
        job,
        executedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("CRON_SECRET")) {
      return NextResponse.json(
        { error: "server_misconfigured_cron_secret" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
