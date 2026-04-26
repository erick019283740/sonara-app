"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AdminLiveChannel =
  | "all"
  | "streams"
  | "fraud"
  | "earnings"
  | "trending"
  | "alerts"
  | "health";

export type AdminLiveEventName =
  | "connected"
  | "heartbeat"
  | "admin:update"
  | "streams:update"
  | "fraud:update"
  | "earnings:update"
  | "trending:update"
  | "alerts:update"
  | "health:update"
  | "error";

export type StreamsLivePayload = {
  streamsPerSecond: number;
  activeListeners: number;
  streamsLastMinute: number;
  streamsLast5m: number;
  topSongsNow: Array<{
    songId: string;
    title: string;
    artistId: string | null;
    artistName: string;
    streamsLast5m: number;
    listenersLast5m: number;
    trendScore: number;
  }>;
  series: Array<{
    ts: string;
    streams: number;
    listeners: number;
  }>;
  generatedAt: string;
};

export type FraudLivePayload = {
  suspiciousUsers: Array<{
    userId: string;
    email: string | null;
    severity: "low" | "medium" | "high";
    status: "flagged" | "blocked" | "cleared";
    maxRiskScore: number;
    lastRiskScore: number;
    flagCount: number;
    reasons: string[];
    updatedAt: string;
  }>;
  anomalyLogs: Array<{
    id: string;
    userId: string;
    songId: string | null;
    artistId: string | null;
    anomalyScore: number;
    graphScore: number;
    riskScore: number;
    severity: "low" | "medium" | "high";
    reasons: string[];
    createdAt: string;
  }>;
  fraudClusters: Array<{
    id: string;
    clusterKey: string;
    songId: string | null;
    artistId: string | null;
    status: "active" | "investigating" | "resolved";
    userCount: number;
    sharedIpCount: number;
    sharedDeviceCount: number;
    clusterScore: number;
    updatedAt: string;
  }>;
  totals: {
    suspiciousUsers: number;
    blockedUsers: number;
    activeClusters: number;
    highSeverityAnomalies24h: number;
  };
  generatedAt: string;
};

export type EarningsLivePayload = {
  summary: {
    dailyRevenue: number;
    monthlyRevenue: number;
    dailyPlatformFee: number;
    monthlyPlatformFee: number;
  };
  topArtists: Array<{
    artistId: string;
    stageName: string;
    totalEarnings: number;
    thisMonthEarnings: number;
    platformFee: number;
  }>;
  payouts: Array<{
    id: string;
    artistId: string;
    stageName: string;
    amount: number;
    status: "pending" | "completed" | "failed";
    payoutDate: string;
    streamId: string | null;
    riskScore: number;
    suspicious: boolean;
  }>;
  generatedAt: string;
};

export type TrendingLivePayload = {
  topTrending: Array<{
    songId: string;
    title: string;
    artistId: string | null;
    artistName: string;
    trendingScore: number;
    growthRate24h: number;
    plays24h: number;
    abuseRisk: number;
  }>;
  fastestGrowing: Array<{
    songId: string;
    title: string;
    artistId: string | null;
    artistName: string;
    trendingScore: number;
    growthRate24h: number;
    plays24h: number;
    abuseRisk: number;
  }>;
  viralSpikes: Array<{
    songId: string;
    title: string;
    artistId: string | null;
    artistName: string;
    trendingScore: number;
    growthRate24h: number;
    plays24h: number;
    abuseRisk: number;
  }>;
  generatedAt: string;
};

export type AlertsLivePayload = {
  alerts: Array<{
    id: string;
    type: "stream_abuse" | "cluster_detected" | "geo_anomaly" | "payout_abuse";
    severity: "low" | "medium" | "high";
    riskScore: number;
    message: string;
    createdAt: string;
    userId: string | null;
    songId: string | null;
    artistId: string | null;
    clusterId: string | null;
    state: "open" | "investigating" | "resolved";
  }>;
  totals: {
    low: number;
    medium: number;
    high: number;
    open: number;
  };
  generatedAt: string;
};

export type HealthLivePayload = {
  queue: {
    streamQueue: number;
    earningsQueue: number;
    trendingQueue: number;
    deadLetterQueue: number;
  };
  events: {
    streamsLast5m: number;
    fraudEventsLast5m: number;
    alertsLast5m: number;
  };
  generatedAt: string;
};

export type AdminLiveSnapshot = {
  streams?: StreamsLivePayload;
  fraud?: FraudLivePayload;
  earnings?: EarningsLivePayload;
  trending?: TrendingLivePayload;
  alerts?: AlertsLivePayload;
  health?: HealthLivePayload;
  generatedAt?: string;
};

export type AdminLiveMessage<T = unknown> = {
  id?: string;
  event: AdminLiveEventName | string;
  data: T;
};

export type AdminLiveStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type UseAdminLiveOptions = {
  channel?: AdminLiveChannel;
  intervalMs?: number;
  severity?: "all" | "low" | "medium" | "high";
  userId?: string | null;
  alertsLimit?: number;
  autoStart?: boolean;
  maxReconnectDelayMs?: number;
  baseReconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  withCredentials?: boolean;
  endpoint?: string;
};

export type UseAdminLiveResult = {
  status: AdminLiveStatus;
  connected: boolean;
  reconnectAttempts: number;
  lastEventId: string | null;
  lastMessageAt: string | null;
  error: string | null;
  snapshot: AdminLiveSnapshot;
  rawEvent: AdminLiveMessage | null;
  start: () => void;
  stop: () => void;
  reconnect: () => void;
};

const DEFAULTS: Required<
  Pick<
    UseAdminLiveOptions,
    | "channel"
    | "intervalMs"
    | "severity"
    | "alertsLimit"
    | "autoStart"
    | "maxReconnectDelayMs"
    | "baseReconnectDelayMs"
    | "maxReconnectAttempts"
    | "withCredentials"
    | "endpoint"
  >
> = {
  channel: "all",
  intervalMs: 3000,
  severity: "all",
  alertsLimit: 100,
  autoStart: true,
  maxReconnectDelayMs: 30000,
  baseReconnectDelayMs: 1000,
  maxReconnectAttempts: 200,
  withCredentials: true,
  endpoint: "/api/admin/live",
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildUrl(opts: Required<UseAdminLiveOptions>): string {
  const params = new URLSearchParams();
  params.set("channel", opts.channel);
  params.set("intervalMs", String(clamp(opts.intervalMs ?? 3000, 1000, 30000)));
  params.set("severity", opts.severity ?? "all");
  params.set("alertsLimit", String(clamp(opts.alertsLimit ?? 100, 1, 500)));
  if (opts.userId) params.set("userId", opts.userId);

  return `${opts.endpoint}?${params.toString()}`;
}

function parseEventData(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function useAdminLive(
  options: UseAdminLiveOptions = {},
): UseAdminLiveResult {
  const opts = useMemo<Required<UseAdminLiveOptions>>(
    () => ({
      ...DEFAULTS,
      ...options,
      channel: options.channel ?? DEFAULTS.channel,
      severity: options.severity ?? DEFAULTS.severity,
      intervalMs: options.intervalMs ?? DEFAULTS.intervalMs,
      alertsLimit: options.alertsLimit ?? DEFAULTS.alertsLimit,
      endpoint: options.endpoint ?? DEFAULTS.endpoint,
      userId: options.userId ?? null,
    }),
    [options],
  );

  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualStopRef = useRef(false);
  const startedRef = useRef(false);

  const reconnectAttemptsRef = useRef(0);
  const lastEventIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<AdminLiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AdminLiveSnapshot>({});
  const [rawEvent, setRawEvent] = useState<AdminLiveMessage | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const cleanupSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    clearReconnectTimer();
    cleanupSource();
    setStatus("idle");
  }, [clearReconnectTimer, cleanupSource]);

  const applyPayload = useCallback((eventName: string, payload: unknown) => {
    const dataObj =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : null;

    setSnapshot((prev) => {
      const next: AdminLiveSnapshot = { ...prev };

      if (eventName === "streams:update") {
        next.streams = (dataObj?.payload ??
          dataObj?.streams ??
          payload) as StreamsLivePayload;
      } else if (eventName === "fraud:update") {
        next.fraud = (dataObj?.payload ??
          dataObj?.fraud ??
          payload) as FraudLivePayload;
      } else if (eventName === "earnings:update") {
        next.earnings = (dataObj?.payload ??
          dataObj?.earnings ??
          payload) as EarningsLivePayload;
      } else if (eventName === "trending:update") {
        next.trending = (dataObj?.payload ??
          dataObj?.trending ??
          payload) as TrendingLivePayload;
      } else if (eventName === "alerts:update") {
        next.alerts = (dataObj?.payload ??
          dataObj?.alerts ??
          payload) as AlertsLivePayload;
      } else if (eventName === "health:update") {
        next.health = (dataObj?.payload ??
          dataObj?.health ??
          payload) as HealthLivePayload;
      } else if (eventName === "admin:update") {
        const p = payload as Record<string, unknown>;
        if (p.streams) next.streams = p.streams as StreamsLivePayload;
        if (p.fraud) next.fraud = p.fraud as FraudLivePayload;
        if (p.earnings) next.earnings = p.earnings as EarningsLivePayload;
        if (p.trending) next.trending = p.trending as TrendingLivePayload;
        if (p.alerts) next.alerts = p.alerts as AlertsLivePayload;
        if (p.health) next.health = p.health as HealthLivePayload;
      }

      const generatedAt =
        (dataObj?.generatedAt as string | undefined) ??
        (dataObj?.ts as string | undefined) ??
        new Date().toISOString();

      next.generatedAt = generatedAt;
      return next;
    });
  }, []);

  const startInternalRef = useRef<(() => void) | null>(null);

  const scheduleReconnect = useCallback(() => {
    if (manualStopRef.current) return;
    if (reconnectAttemptsRef.current >= opts.maxReconnectAttempts) {
      setStatus("error");
      setError("Maximum reconnect attempts reached");
      return;
    }

    reconnectAttemptsRef.current += 1;
    setReconnectAttempts(reconnectAttemptsRef.current);
    setStatus("reconnecting");

    const backoff = Math.min(
      opts.maxReconnectDelayMs,
      opts.baseReconnectDelayMs *
        2 ** Math.max(0, reconnectAttemptsRef.current - 1),
    );
    const jitter = Math.floor(Math.random() * 300);
    const waitMs = backoff + jitter;

    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      startInternalRef.current?.();
    }, waitMs);
  }, [
    clearReconnectTimer,
    opts.baseReconnectDelayMs,
    opts.maxReconnectAttempts,
    opts.maxReconnectDelayMs,
  ]);

  const onMessage = useCallback(
    (ev: MessageEvent<string>) => {
      const eventName = (ev.type || "message") as AdminLiveEventName | string;
      const payload = parseEventData(ev.data);

      const msg: AdminLiveMessage = {
        id: ev.lastEventId || undefined,
        event: eventName,
        data: payload,
      };

      setRawEvent(msg);

      const now = new Date().toISOString();
      setLastMessageAt(now);
      setError(null);
      setStatus("connected");

      if (ev.lastEventId) {
        lastEventIdRef.current = ev.lastEventId;
        setLastEventId(ev.lastEventId);
      }

      if (eventName === "error") {
        const text =
          payload &&
          typeof payload === "object" &&
          "message" in (payload as Record<string, unknown>)
            ? String((payload as Record<string, unknown>).message)
            : "Live stream error event";
        setError(text);
        return;
      }

      if (eventName !== "connected" && eventName !== "heartbeat") {
        applyPayload(eventName, payload);
      }
    },
    [applyPayload],
  );

  const attachNamedListener = useCallback(
    (source: EventSource, eventName: AdminLiveEventName | string) => {
      source.addEventListener(eventName, (evt) => {
        onMessage(evt as MessageEvent<string>);
      });
    },
    [onMessage],
  );

  const startInternal = useCallback(() => {
    if (manualStopRef.current) return;

    cleanupSource();
    clearReconnectTimer();
    setStatus(reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting");

    const url = buildUrl(opts);

    const source = new EventSource(url, {
      withCredentials: opts.withCredentials,
    });
    sourceRef.current = source;

    source.onopen = () => {
      setStatus("connected");
      setError(null);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
    };

    source.onmessage = (ev) => {
      onMessage(ev);
    };

    source.onerror = () => {
      cleanupSource();
      scheduleReconnect();
    };

    const names: Array<AdminLiveEventName | string> = [
      "connected",
      "heartbeat",
      "admin:update",
      "streams:update",
      "fraud:update",
      "earnings:update",
      "trending:update",
      "alerts:update",
      "health:update",
      "error",
    ];

    for (const name of names) {
      attachNamedListener(source, name);
    }
  }, [
    attachNamedListener,
    cleanupSource,
    clearReconnectTimer,
    onMessage,
    opts,
    scheduleReconnect,
  ]);

  useEffect(() => {
    startInternalRef.current = startInternal;
  }, [startInternal]);

  const start = useCallback(() => {
    manualStopRef.current = false;
    startedRef.current = true;
    startInternalRef.current?.();
  }, []);

  const reconnect = useCallback(() => {
    manualStopRef.current = false;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    clearReconnectTimer();
    cleanupSource();
    startInternalRef.current?.();
  }, [clearReconnectTimer, cleanupSource]);

  useEffect(() => {
    if (!opts.autoStart) return;
    if (startedRef.current) return;

    start();
    return () => {
      stop();
    };
  }, [opts.autoStart, start, stop]);

  useEffect(() => {
    if (!opts.autoStart && !startedRef.current) return;
    reconnect();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts.channel,
    opts.intervalMs,
    opts.severity,
    opts.userId,
    opts.alertsLimit,
    opts.endpoint,
  ]);

  return {
    status,
    connected: status === "connected",
    reconnectAttempts,
    lastEventId,
    lastMessageAt,
    error,
    snapshot,
    rawEvent,
    start,
    stop,
    reconnect,
  };
}
