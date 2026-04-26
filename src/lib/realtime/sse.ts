import { NextResponse } from "next/server";

export type SSEEventName =
  | "connected"
  | "heartbeat"
  | "streams:update"
  | "fraud:update"
  | "earnings:update"
  | "trending:update"
  | "alerts:update"
  | "health:update"
  | "error";

export type SSEPayload = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type SSEMessage<T extends SSEPayload = SSEPayload> = {
  event: SSEEventName | string;
  data: T;
  id?: string | number;
  retry?: number;
};

export type SSEHandlerContext = {
  send: <T extends SSEPayload>(message: SSEMessage<T>) => void;
  close: () => void;
  signal: AbortSignal;
  request: Request;
};

export type SSEHandler = (ctx: SSEHandlerContext) => void | Promise<void>;

const encoder = new TextEncoder();

function toLine(field: string, value: string | number): string {
  return `${field}: ${String(value)}\n`;
}

function toDataLines(data: SSEPayload): string {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return json
    .split(/\r?\n/)
    .map((line) => `data: ${line}\n`)
    .join("");
}

export function formatSSE<T extends SSEPayload>(message: SSEMessage<T>): string {
  let out = "";

  if (message.id !== undefined) out += toLine("id", message.id);
  if (message.event) out += toLine("event", message.event);
  if (message.retry !== undefined) out += toLine("retry", message.retry);

  out += toDataLines(message.data);
  out += "\n";

  return out;
}

export function sseHeaders(extra?: HeadersInit): Headers {
  const base = new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  if (extra) {
    const additional = new Headers(extra);
    additional.forEach((value, key) => base.set(key, value));
  }

  return base;
}

export function heartbeatEvent(ts = new Date().toISOString()): SSEMessage {
  return {
    event: "heartbeat",
    data: { ts },
  };
}

export function createSSEStream(
  request: Request,
  handler: SSEHandler,
  options?: {
    heartbeatMs?: number;
    initialRetryMs?: number;
    headers?: HeadersInit;
  },
): Response {
  const heartbeatMs = Math.max(1_000, options?.heartbeatMs ?? 15_000);
  const initialRetryMs = options?.initialRetryMs ?? 3_000;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // noop
        }
      };

      const send = <T extends SSEPayload>(message: SSEMessage<T>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatSSE(message)));
        } catch {
          close();
        }
      };

      request.signal.addEventListener("abort", close, { once: true });

      send({
        event: "connected",
        retry: initialRetryMs,
        data: {
          ok: true,
          ts: new Date().toISOString(),
        },
      });

      heartbeatTimer = setInterval(() => {
        send(heartbeatEvent());
      }, heartbeatMs);

      Promise.resolve(
        handler({
          send,
          close,
          signal: request.signal,
          request,
        }),
      ).catch((error) => {
        send({
          event: "error",
          data: {
            message:
              error instanceof Error ? error.message : "SSE handler failure",
            ts: new Date().toISOString(),
          },
        });
        close();
      });
    },
    cancel() {
      // client disconnected; cleanup is handled by abort listener
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: sseHeaders(options?.headers),
  });
}

export function parseLastEventId(request: Request): string | null {
  const id = request.headers.get("last-event-id");
  return id && id.trim() ? id.trim() : null;
}

export function createEventId(prefix = "evt"): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}_${r}`;
}
