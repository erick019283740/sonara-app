import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import growthService, {
  type SharePlatform,
  type ConversionType,
} from "@/lib/services/growthService";

type ShareCreateBody = {
  action?: "create" | "convert";
  songId?: string;
  platform?: SharePlatform;
  campaign?: string;
  expiresInDays?: number;
  shareToken?: string;
  conversionType?: ConversionType;
  newUserId?: string | null;
};

const VALID_PLATFORMS: SharePlatform[] = [
  "tiktok",
  "instagram",
  "whatsapp",
  "x",
  "other",
];

const VALID_CONVERSION_TYPES: ConversionType[] = [
  "signup",
  "stream",
  "follow",
  "support",
];

function isValidPlatform(value: unknown): value is SharePlatform {
  return typeof value === "string" && VALID_PLATFORMS.includes(value as SharePlatform);
}

function isValidConversionType(value: unknown): value is ConversionType {
  return (
    typeof value === "string" &&
    VALID_CONVERSION_TYPES.includes(value as ConversionType)
  );
}

function parsePositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Unified share API:
 * - POST /api/share { action: "create", songId, platform, campaign?, expiresInDays? }
 * - POST /api/share { action: "convert", shareToken, conversionType?, newUserId? }
 *
 * Backward-compatible behavior:
 * - if `action` is omitted and `songId + platform` are provided => create
 * - if `action` is omitted and `shareToken` is provided => convert
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ShareCreateBody;

    const inferredAction: "create" | "convert" | null =
      body.action === "create" || body.action === "convert"
        ? body.action
        : body.songId && body.platform
        ? "create"
        : body.shareToken
        ? "convert"
        : null;

    if (!inferredAction) {
      return NextResponse.json(
        { error: "invalid_body", message: "action must be create or convert" },
        { status: 400 },
      );
    }

    if (inferredAction === "create") {
      const userId = await getAuthenticatedUserId();
      if (!userId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      const songId = body.songId?.trim();
      if (!songId) {
        return NextResponse.json(
          { error: "invalid_song_id", message: "songId is required" },
          { status: 400 },
        );
      }

      if (!isValidPlatform(body.platform)) {
        return NextResponse.json(
          {
            error: "invalid_platform",
            message: `platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
          },
          { status: 400 },
        );
      }

      const expiresInDays = parsePositiveInt(body.expiresInDays);
      const result = await growthService.createShareLink({
        userId,
        songId,
        platform: body.platform,
        campaign: body.campaign?.trim() || undefined,
        expiresInDays,
      });

      return NextResponse.json(
        {
          ok: true,
          action: "create",
          shareId: result.shareId,
          shareToken: result.shareToken,
          shareUrl: result.shareUrl,
          platform: result.platform,
          songId: result.songId,
          artistId: result.artistId,
          createdAt: result.createdAt,
        },
        { status: 201 },
      );
    }

    const shareToken = body.shareToken?.trim();
    if (!shareToken) {
      return NextResponse.json(
        { error: "invalid_share_token", message: "shareToken is required" },
        { status: 400 },
      );
    }

    if (
      body.conversionType !== undefined &&
      !isValidConversionType(body.conversionType)
    ) {
      return NextResponse.json(
        {
          error: "invalid_conversion_type",
          message: `conversionType must be one of: ${VALID_CONVERSION_TYPES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const authUserId = await getAuthenticatedUserId();
    const conversionResult = await growthService.trackShareConversion({
      shareToken,
      conversionType: body.conversionType ?? "signup",
      newUserId: body.newUserId ?? authUserId ?? null,
    });

    if (!conversionResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          action: "convert",
          error: conversionResult.error ?? "conversion_failed",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        action: "convert",
        shareId: conversionResult.shareId,
        conversionId: conversionResult.conversionId,
        songId: conversionResult.songId,
        viralScoreIncrement: conversionResult.viralScoreIncrement ?? 0,
        deduplicated: conversionResult.deduplicated ?? false,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in POST /api/share:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/share
 * - /api/share?shareToken=...&conversionType=signup&newUserId=...
 *   -> conversion attribution
 */
export async function GET(request: NextRequest) {
  try {
    const shareToken = request.nextUrl.searchParams.get("shareToken")?.trim();
    if (!shareToken) {
      return NextResponse.json(
        { error: "invalid_share_token", message: "shareToken is required" },
        { status: 400 },
      );
    }

    const conversionTypeRaw = request.nextUrl.searchParams.get("conversionType");
    const newUserIdRaw = request.nextUrl.searchParams.get("newUserId");
    const conversionType: ConversionType =
      conversionTypeRaw && isValidConversionType(conversionTypeRaw)
        ? conversionTypeRaw
        : "signup";

    const authUserId = await getAuthenticatedUserId();
    const newUserId = newUserIdRaw?.trim() || authUserId || null;

    const conversionResult = await growthService.trackShareConversion({
      shareToken,
      conversionType,
      newUserId,
    });

    if (!conversionResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          action: "convert",
          error: conversionResult.error ?? "conversion_failed",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        action: "convert",
        shareId: conversionResult.shareId,
        conversionId: conversionResult.conversionId,
        songId: conversionResult.songId,
        viralScoreIncrement: conversionResult.viralScoreIncrement ?? 0,
        deduplicated: conversionResult.deduplicated ?? false,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in GET /api/share:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
