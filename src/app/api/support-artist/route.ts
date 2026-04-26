import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Decimal } from "decimal.js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { enqueueEvent } from "@/lib/services/queueService";

type SupportRequestBody = {
  artistId?: string;
  amount?: number | string;
};

const MIN_AMOUNT_EUR = new Decimal("1");
const MAX_AMOUNT_EUR = new Decimal("500");

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseAmount(value: unknown): Decimal | null {
  try {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const amount = new Decimal(value);
    if (!amount.isFinite() || amount.lte(0)) return null;
    return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  } catch {
    return null;
  }
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

async function artistExists(artistId: string): Promise<boolean> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("artists")
    .select("id")
    .eq("id", artistId)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: SupportRequestBody;
    try {
      body = (await request.json()) as SupportRequestBody;
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }

    const artistId = normalizeId(body.artistId);
    if (!artistId) {
      return NextResponse.json({ error: "artistId_required" }, { status: 400 });
    }

    if (!isUuidLike(artistId)) {
      return NextResponse.json(
        { error: "invalid_artistId_format" },
        { status: 400 },
      );
    }

    if (!(await artistExists(artistId))) {
      return NextResponse.json({ error: "artist_not_found" }, { status: 404 });
    }

    const amount = parseAmount(body.amount);
    if (!amount) {
      return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
    }

    if (amount.lt(MIN_AMOUNT_EUR) || amount.gt(MAX_AMOUNT_EUR)) {
      return NextResponse.json(
        {
          error: "amount_out_of_range",
          min: MIN_AMOUNT_EUR.toString(),
          max: MAX_AMOUNT_EUR.toString(),
        },
        { status: 400 },
      );
    }

    const supportId = crypto.randomUUID();

    await enqueueEvent("support", {
      supportId,
      userId,
      artistId,
      amount: amount.toString(),
      currency: "EUR",
      timestamp: new Date().toISOString(),
      source: "support_artist_api",
    });

    return NextResponse.json(
      {
        ok: true,
        queued: true,
        supportId,
        amount: amount.toString(),
        artistReceives: amount.times("0.9").toString(),
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
