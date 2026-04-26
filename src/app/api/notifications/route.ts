import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import notificationService from "@/lib/services/notificationService";

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

function parseBoolean(raw: string | null, fallback = false): boolean {
  if (raw === null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
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

/**
 * GET /api/notifications
 * Query params:
 * - limit: number (default 25, max 100)
 * - unreadOnly: boolean (default false)
 * - withUnreadCount: boolean (default true)
 * - markAllRead: boolean (default false)
 * - useCache: boolean (default true)
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const search = request.nextUrl.searchParams;
    const limit = parsePositiveInt(search.get("limit"), 25, 100);
    const unreadOnly = parseBoolean(search.get("unreadOnly"), false);
    const withUnreadCount = parseBoolean(search.get("withUnreadCount"), true);
    const markAllRead = parseBoolean(search.get("markAllRead"), false);
    const useCache = parseBoolean(search.get("useCache"), true);

    if (markAllRead) {
      await notificationService.markAllAsRead(userId);
    }

    const [notifications, unreadCount] = await Promise.all([
      notificationService.getNotifications(userId, {
        limit,
        unreadOnly,
        useCache,
      }),
      withUnreadCount ? notificationService.getUnreadCount(userId) : Promise.resolve(null),
    ]);

    const pushReady = notifications.map((n) => ({
      ...n,
      push: notificationService.buildPushPayload(n),
    }));

    return NextResponse.json(
      {
        ok: true,
        userId,
        unreadCount,
        notifications: pushReady,
        fetchedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=5, stale-while-revalidate=20",
        },
      },
    );
  } catch (error) {
    console.error("Error in GET /api/notifications:", error);
    return NextResponse.json({ error: "internal_server_error" }, { status: 500 });
  }
}

type MarkReadBody =
  | {
      notificationId: string;
      markAll?: false;
    }
  | {
      markAll: true;
      notificationId?: never;
    };

/**
 * POST /api/notifications
 * Body:
 * - { notificationId: string } => mark a single notification as read
 * - { markAll: true } => mark all notifications as read
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Partial<MarkReadBody>;
    const markAll = body.markAll === true;

    if (markAll) {
      await notificationService.markAllAsRead(userId);
      return NextResponse.json(
        { ok: true, marked: "all", userId, updatedAt: new Date().toISOString() },
        { status: 200 },
      );
    }

    const notificationId =
      typeof body.notificationId === "string" ? body.notificationId.trim() : "";

    if (!notificationId) {
      return NextResponse.json(
        { error: "notificationId_required" },
        { status: 400 },
      );
    }

    await notificationService.markAsRead(userId, notificationId);

    return NextResponse.json(
      {
        ok: true,
        marked: "single",
        userId,
        notificationId,
        updatedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in POST /api/notifications:", error);
    return NextResponse.json({ error: "internal_server_error" }, { status: 500 });
  }
}
