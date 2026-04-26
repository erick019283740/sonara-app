import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { enqueueEvent } from "@/lib/services/queueService";

type LikeRequestBody = {
  songId?: string;
  liked?: boolean;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
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

async function songExists(songId: string): Promise<boolean> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("songs")
    .select("id")
    .eq("id", songId)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId();
    if (!authenticatedUserId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: LikeRequestBody;
    try {
      body = (await request.json()) as LikeRequestBody;
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }

    const songId = normalizeId(body.songId);
    if (!songId) {
      return NextResponse.json({ error: "songId_required" }, { status: 400 });
    }

    if (!isUuidLike(songId)) {
      return NextResponse.json(
        { error: "invalid_songId_format" },
        { status: 400 },
      );
    }

    if (typeof body.liked !== "boolean") {
      return NextResponse.json(
        { error: "liked_must_be_boolean" },
        { status: 400 },
      );
    }

    if (!(await songExists(songId))) {
      return NextResponse.json({ error: "song_not_found" }, { status: 404 });
    }

    await enqueueEvent("like", {
      userId: authenticatedUserId,
      songId,
      liked: body.liked,
      timestamp: new Date().toISOString(),
      source: "api_like_route",
    });

    return NextResponse.json(
      {
        ok: true,
        queued: true,
        userId: authenticatedUserId,
        songId,
        liked: body.liked,
      },
      { status: 202 },
    );
  } catch {
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
