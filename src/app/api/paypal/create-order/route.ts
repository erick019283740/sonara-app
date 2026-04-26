import { createClient } from "@/lib/supabase/server";
import { paypalCreateOrder } from "@/lib/paypal/server";
import { NextResponse } from "next/server";

const MIN_EUR = 1;
const MAX_EUR = 500;

function normalizeAmountEur(raw: unknown): string | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  if (rounded < MIN_EUR || rounded > MAX_EUR) return null;
  return rounded.toFixed(2);
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      artist_id?: string;
      amount_eur?: number;
    };

    if (!body.artist_id || typeof body.amount_eur !== "number") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const value = normalizeAmountEur(body.amount_eur);
    if (!value) {
      return NextResponse.json(
        { error: "invalid_amount", min: MIN_EUR, max: MAX_EUR },
        { status: 400 }
      );
    }

    const { data: artist, error: aErr } = await supabase
      .from("artists")
      .select("id")
      .eq("id", body.artist_id)
      .maybeSingle();

    if (aErr || !artist) {
      return NextResponse.json({ error: "artist_not_found" }, { status: 404 });
    }

    const order = await paypalCreateOrder({
      valueEur: value,
      artistId: body.artist_id,
      userId: user.id,
    });

    return NextResponse.json({
      id: order.id,
      status: order.status,
      approval_url: order.approvalUrl ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "paypal_error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
