import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { enqueueEvent } from "@/lib/services/queueService";

type EventType = "stream" | "like" | "follow" | "support";

type GenericEventBody = {
  type?: EventType | string;
  data?: Record<string, unknown>;
};

const VALID_TYPES: readonly EventType[] = [
  "stream",
  "like",
  "follow",
  "support",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeEventType(value: unknown): EventType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return VALID_TYPES.includes(normalized as EventType)
    ? (normalized as EventType)
    : null;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function ensureOwnedUserId(
  payload: Record<string, unknown>,
  authenticatedUserId: string,
): boolean {
  const candidate = payload.userId;
  if (candidate === undefined || candidate === null) return true;
  return (
    typeof candidate === "string" && candidate.trim() === authenticatedUserId
  );
}

function validatePayload(
  type: EventType,
  data: Record<string, unknown>,
): string | null {
  if (type === "stream") {
    const songId = typeof data.songId === "string" ? data.songId.trim() : "";
    const artistId =
      typeof data.artistId === "string" ? data.artistId.trim() : "";
    const sessionId =
      typeof data.sessionId === "string" ? data.sessionId.trim() : "";
    const durationPlayedSeconds =
      typeof data.durationPlayedSeconds === "number"
        ? data.durationPlayedSeconds
        : Number.NaN;
    const totalDurationSeconds =
      typeof data.totalDurationSeconds === "number"
        ? data.totalDurationSeconds
        : Number.NaN;

    if (!songId) return "stream_songId_required";
    if (!artistId) return "stream_artistId_required";
    if (!sessionId || !isUuidLike(sessionId)) return "stream_sessionId_invalid";
    if (!Number.isFinite(durationPlayedSeconds) || durationPlayedSeconds <= 0) {
      return "stream_durationPlayedSeconds_invalid";
    }
    if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) {
      return "stream_totalDurationSeconds_invalid";
    }
    if (durationPlayedSeconds > totalDurationSeconds) {
      return "stream_duration_exceeds_total";
    }
    return null;
  }

  if (type === "like") {
    const songId = typeof data.songId === "string" ? data.songId.trim() : "";
    const liked = data.liked;
    if (!songId) return "like_songId_required";
    if (typeof liked !== "boolean") return "like_liked_boolean_required";
    return null;
  }

  if (type === "follow") {
    const targetType =
      typeof data.targetType === "string" ? data.targetType.trim() : "";
    const targetId =
      typeof data.targetId === "string" ? data.targetId.trim() : "";
    const followed = data.followed;
    if (targetType !== "artist" && targetType !== "user") {
      return "follow_targetType_invalid";
    }
    if (!targetId) return "follow_targetId_required";
    if (typeof followed !== "boolean")
      return "follow_followed_boolean_required";
    return null;
  }

  if (type === "support") {
    const artistId =
      typeof data.artistId === "string" ? data.artistId.trim() : "";
    const amount = typeof data.amount === "number" ? data.amount : Number.NaN;
    if (!artistId) return "support_artistId_required";
    if (!Number.isFinite(amount) || amount <= 0)
      return "support_amount_invalid";
    return null;
  }

  return "invalid_event_type";
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId();
    if (!authenticatedUserId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: GenericEventBody;
    try {
      body = (await request.json()) as GenericEventBody;
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }

    const type = normalizeEventType(body.type);
    if (!type) {
      return NextResponse.json(
        { error: `invalid_type_must_be_one_of_${VALID_TYPES.join("_")}` },
        { status: 400 },
      );
    }

    if (!isRecord(body.data)) {
      return NextResponse.json(
        { error: "data_object_required" },
        { status: 400 },
      );
    }

    if (!ensureOwnedUserId(body.data, authenticatedUserId)) {
      return NextResponse.json(
        { error: "forbidden_user_mismatch" },
        { status: 403 },
      );
    }

    const validationError = validatePayload(type, body.data);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    await enqueueEvent(type, {
      ...body.data,
      userId: authenticatedUserId,
      timestamp: new Date().toISOString(),
      source: "api_events_route",
    });

    return NextResponse.json({ ok: true, type, queued: true }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
