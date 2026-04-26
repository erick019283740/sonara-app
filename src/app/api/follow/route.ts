import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import growthService from "@/lib/services/growthService";
import notificationService from "@/lib/services/notificationService";

type FollowTargetType = "artist" | "user";

type FollowRequestBody = {
  targetType?: FollowTargetType;
  targetId?: string;
  followed?: boolean;

  // Backward compatibility
  userId?: string;
  artistId?: string;
};

function isValidTargetType(value: unknown): value is FollowTargetType {
  return value === "artist" || value === "user";
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseFollowFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
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

async function getProfileById(
  userId: string,
): Promise<{ id: string; username: string | null } | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    username: (data.username as string | null) ?? null,
  };
}

async function getArtistOwnerByArtistId(
  artistId: string,
): Promise<{
  artistId: string;
  userId: string;
  stageName: string | null;
} | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("artists")
    .select("id, user_id, stage_name")
    .eq("id", artistId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    artistId: data.id as string,
    userId: data.user_id as string,
    stageName: (data.stage_name as string | null) ?? null,
  };
}

async function followArtist(userId: string, artistId: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase.from("artist_follows").insert({
    user_id: userId,
    artist_id: artistId,
  });

  if (error) {
    // Unique conflict means already followed; treat as success.
    const msg = error.message.toLowerCase();
    const isDuplicate =
      msg.includes("duplicate") ||
      msg.includes("unique") ||
      msg.includes("already exists");

    if (!isDuplicate) {
      throw new Error(`failed_to_follow_artist: ${error.message}`);
    }
  }
}

async function unfollowArtist(userId: string, artistId: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("artist_follows")
    .delete()
    .eq("user_id", userId)
    .eq("artist_id", artistId);

  if (error) {
    throw new Error(`failed_to_unfollow_artist: ${error.message}`);
  }
}

async function sendArtistFollowNotification(params: {
  followerUserId: string;
  artistId: string;
  artistOwnerUserId: string;
}): Promise<void> {
  if (params.followerUserId === params.artistOwnerUserId) return;

  const follower = await getProfileById(params.followerUserId);
  await notificationService.notifyNewFollower({
    artistUserId: params.artistOwnerUserId,
    followerId: params.followerUserId,
    followerName: follower?.username ?? "A user",
    artistId: params.artistId,
  });
}

async function sendUserFollowNotification(params: {
  followerUserId: string;
  followedUserId: string;
}): Promise<void> {
  if (params.followerUserId === params.followedUserId) return;

  const follower = await getProfileById(params.followerUserId);

  await notificationService.createNotification({
    userId: params.followedUserId,
    type: "new_follower",
    title: "New follower",
    body: `${follower?.username ?? "A user"} just followed you.`,
    payload: {
      followerId: params.followerUserId,
      deepLink: `/profile/${params.followerUserId}`,
    },
    priority: "normal",
  });
}

export async function POST(request: NextRequest) {
  try {
    const authUserId = await getAuthenticatedUserId();
    if (!authUserId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: FollowRequestBody;
    try {
      body = (await request.json()) as FollowRequestBody;
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    // Backward-compatible fallback:
    // old payload: { userId, artistId, followed }
    const targetType: FollowTargetType =
      body.targetType ?? (body.artistId ? "artist" : "user");
    const targetId = normalizeId(body.targetId ?? body.artistId);
    const followed = parseFollowFlag(body.followed);

    if (!isValidTargetType(targetType)) {
      return NextResponse.json(
        {
          error: "invalid_target_type",
          message: "targetType must be 'artist' or 'user'",
        },
        { status: 400 },
      );
    }

    if (!targetId) {
      return NextResponse.json(
        {
          error: "targetId_required",
          message: "targetId (or artistId for legacy clients) is required",
        },
        { status: 400 },
      );
    }

    if (followed === null) {
      return NextResponse.json(
        { error: "followed_required", message: "followed must be boolean" },
        { status: 400 },
      );
    }

    if (targetType === "artist") {
      const artist = await getArtistOwnerByArtistId(targetId);
      if (!artist) {
        return NextResponse.json(
          { error: "artist_not_found" },
          { status: 404 },
        );
      }

      if (followed) {
        await followArtist(authUserId, targetId);
        await sendArtistFollowNotification({
          followerUserId: authUserId,
          artistId: targetId,
          artistOwnerUserId: artist.userId,
        });

        return NextResponse.json(
          {
            ok: true,
            targetType: "artist",
            targetId,
            followed: true,
            followerUserId: authUserId,
            followedArtistId: targetId,
            createdAt: new Date().toISOString(),
          },
          { status: 200 },
        );
      }

      await unfollowArtist(authUserId, targetId);
      return NextResponse.json(
        {
          ok: true,
          targetType: "artist",
          targetId,
          followed: false,
          followerUserId: authUserId,
          followedArtistId: targetId,
          deleted: true,
        },
        { status: 200 },
      );
    }

    // targetType === "user"
    if (targetId === authUserId) {
      return NextResponse.json(
        { error: "self_follow_not_allowed" },
        { status: 400 },
      );
    }

    const targetProfile = await getProfileById(targetId);
    if (!targetProfile) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }

    if (followed) {
      const result = await growthService.followUser({
        followerUserId: authUserId,
        followedUserId: targetId,
      });

      await sendUserFollowNotification({
        followerUserId: authUserId,
        followedUserId: targetId,
      });

      return NextResponse.json(
        {
          ok: true,
          targetType: "user",
          targetId,
          followed: true,
          followerUserId: result.followerUserId,
          followedUserId: result.followedUserId,
          createdAt: result.createdAt ?? new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    const result = await growthService.unfollowUser({
      followerUserId: authUserId,
      followedUserId: targetId,
    });

    return NextResponse.json(
      {
        ok: true,
        targetType: "user",
        targetId,
        followed: false,
        followerUserId: result.followerUserId,
        followedUserId: result.followedUserId,
        deleted: true,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in POST /api/follow:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
