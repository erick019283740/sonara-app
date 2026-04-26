import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireAdminApi } from "@/lib/admin/auth";
import { getStreamsLiveMetrics } from "@/lib/admin/metrics";
import { createSSEStream, createEventId } from "@/lib/realtime/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBool(input: string | null | undefined): boolean {
  if (!input) return false;
  const v = input.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseIntervalMs(input: string | null | undefined, fallback = 2000): number {
  const n = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(n, 500), 15000);
}

function parseMode(request: NextRequest): "json" | "sse" {
  const modeParam = request.nextUrl.searchParams.get("mode");
  if (modeParam === "sse" || modeParam === "json") return modeParam;

  const streamFlag = parseBool(request.nextUrl.searchParams.get("stream"));
  if (streamFlag) return "sse";

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) return "sse";

  return "json";
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminApi();

    const mode = parseMode(request);

    if (mode === "json") {
      const data = await getStreamsLiveMetrics();
      return NextResponse.json(
        {
          ok: true,
          mode: "json",
          data,
        },
        { status: 200 },
      );
    }

    const intervalMs = parseIntervalMs(request.nextUrl.searchParams.get("intervalMs"), 2000);

    return createSSEStream(
      request,
      async ({ send, close, signal }) => {
        let timer: ReturnType<typeof setInterval> | null = null;

        const pushUpdate = async () => {
          if (signal.aborted) {
            close();
            return;
          }

          try {
            const data = await getStreamsLiveMetrics();

            send({
              id: createEventId("streams"),
              event: "streams:update",
              data: {
                ok: true,
                channel: "streams",
                generatedAt: data.generatedAt,
                payload: data,
              },
            });
          } catch (error) {
            send({
              id: createEventId("streams_err"),
              event: "error",
              data: {
                ok: false,
                channel: "streams",
                message:
                  error instanceof Error ? error.message : "Failed to fetch stream metrics",
                ts: new Date().toISOString(),
              },
            });
          }
        };

        await pushUpdate();

        timer = setInterval(() => {
          void pushUpdate();
        }, intervalMs);

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
        heartbeatMs: 10000,
        initialRetryMs: 3000,
      },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
