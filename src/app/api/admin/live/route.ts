import { NextRequest } from "next/server";
import { requireAdminApi, adminErrorResponse } from "@/lib/admin/auth";
import {
  getStreamsLiveMetrics,
  getFraudMetrics,
  getEarningsMetrics,
  getTrendingMetrics,
  getAlertsMetrics,
  getPlatformHealthMetrics,
} from "@/lib/admin/metrics";
import { createSSEStream, createEventId } from "@/lib/realtime/sse";

type Channel =
  | "all"
  | "streams"
  | "fraud"
  | "earnings"
  | "trending"
  | "alerts"
  | "health";

type AdminLiveQuery = {
  channel: Channel;
  intervalMs: number;
  severity: "all" | "low" | "medium" | "high";
  userId: string | null;
  alertsLimit: number;
};

const CHANNELS = new Set<Channel>([
  "all",
  "streams",
  "fraud",
  "earnings",
  "trending",
  "alerts",
  "health",
]);

const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 30000;
const DEFAULT_INTERVAL_MS = 3000;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function parseChannel(raw: string | null): Channel {
  const v = (raw ?? "all").trim().toLowerCase() as Channel;
  return CHANNELS.has(v) ? v : "all";
}

function parseSeverity(raw: string | null): "all" | "low" | "medium" | "high" {
  const v = (raw ?? "all").trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return "all";
}

function parseInterval(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS;
  return clamp(parsed, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
}

function parseAlertsLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return clamp(parsed, 1, 500);
}

function parseQuery(request: NextRequest): AdminLiveQuery {
  const sp = request.nextUrl.searchParams;
  return {
    channel: parseChannel(sp.get("channel")),
    intervalMs: parseInterval(sp.get("intervalMs")),
    severity: parseSeverity(sp.get("severity")),
    userId: sp.get("userId"),
    alertsLimit: parseAlertsLimit(sp.get("alertsLimit")),
  };
}

async function getPayloadByChannel(query: AdminLiveQuery) {
  switch (query.channel) {
    case "streams":
      return {
        streams: await getStreamsLiveMetrics(),
      };
    case "fraud":
      return {
        fraud: await getFraudMetrics({
          severity: query.severity,
          userId: query.userId ?? undefined,
        }),
      };
    case "earnings":
      return {
        earnings: await getEarningsMetrics(),
      };
    case "trending":
      return {
        trending: await getTrendingMetrics(),
      };
    case "alerts":
      return {
        alerts: await getAlertsMetrics({
          severity: query.severity,
          limit: query.alertsLimit,
        }),
      };
    case "health":
      return {
        health: await getPlatformHealthMetrics(),
      };
    case "all":
    default: {
      const [streams, fraud, earnings, trending, alerts, health] =
        await Promise.all([
          getStreamsLiveMetrics(),
          getFraudMetrics({
            severity: query.severity,
            userId: query.userId ?? undefined,
          }),
          getEarningsMetrics(),
          getTrendingMetrics(),
          getAlertsMetrics({
            severity: query.severity,
            limit: query.alertsLimit,
          }),
          getPlatformHealthMetrics(),
        ]);

      return {
        streams,
        fraud,
        earnings,
        trending,
        alerts,
        health,
      };
    }
  }
}

function inferEventName(channel: Channel): string {
  switch (channel) {
    case "streams":
      return "streams:update";
    case "fraud":
      return "fraud:update";
    case "earnings":
      return "earnings:update";
    case "trending":
      return "trending:update";
    case "alerts":
      return "alerts:update";
    case "health":
      return "health:update";
    case "all":
    default:
      return "admin:update";
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminApi();
    const query = parseQuery(request);

    return createSSEStream(
      request,
      async ({ send, signal, close }) => {
        let busy = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        const emit = async () => {
          if (busy || signal.aborted) return;
          busy = true;

          try {
            const payload = await getPayloadByChannel(query);
            send({
              id: createEventId("admin"),
              event: inferEventName(query.channel),
              data: {
                channel: query.channel,
                generatedAt: new Date().toISOString(),
                ...payload,
              },
            });
          } catch (error) {
            send({
              id: createEventId("admin_err"),
              event: "error",
              data: {
                channel: query.channel,
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to produce admin live payload",
                ts: new Date().toISOString(),
              },
            });
          } finally {
            busy = false;
          }
        };

        // initial snapshot immediately
        await emit();

        timer = setInterval(() => {
          void emit();
        }, query.intervalMs);

        signal.addEventListener(
          "abort",
          () => {
            if (timer) clearInterval(timer);
            close();
          },
          { once: true },
        );
      },
      {
        heartbeatMs: 15000,
        initialRetryMs: 3000,
      },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
