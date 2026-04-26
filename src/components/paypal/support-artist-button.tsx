"use client";

import { useUser } from "@/contexts/user-context";
import { getPayPalClientId } from "@/lib/paypal/config";
import { useCallback, useEffect, useRef, useState } from "react";

const PRESETS = [1, 5, 10, 20] as const;
const MIN_EUR = 1;
const MAX_EUR = 500;

type Props = {
  artistId: string;
  artistName?: string;
};

function clampDonationEur(n: number) {
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  if (rounded < MIN_EUR || rounded > MAX_EUR) return null;
  return rounded;
}

export function SupportArtistButton({ artistId, artistName }: Props) {
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<number>(5);
  const [custom, setCustom] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const paypalRef = useRef<HTMLDivElement | null>(null);

  const resolvedAmount = (() => {
    if (custom.trim()) return clampDonationEur(Number(custom));
    return clampDonationEur(preset);
  })();

  const loadPayPalSdk = useCallback(() => {
    const clientId = getPayPalClientId();
    if (!clientId) {
      setNotice("PayPal client ID is not configured.");
      return;
    }

    if (window.paypal) {
      setSdkReady(true);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-sonara-paypal-sdk="true"]'
    );
    if (existing) {
      existing.addEventListener("load", () => setSdkReady(true), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.dataset.sonaraPaypalSdk = "true";
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId
    )}&currency=EUR&intent=capture`;
    script.async = true;
    script.onload = () => setSdkReady(true);
    script.onerror = () => setNotice("Could not load PayPal.");
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (!open || !sdkReady || !paypalRef.current || !resolvedAmount) return;

    const container = paypalRef.current;
    container.innerHTML = "";

    const pp = window.paypal;
    if (!pp) {
      queueMicrotask(() => setNotice("PayPal is unavailable."));
      return;
    }

    const buttons = pp.Buttons({
      style: { layout: "vertical", shape: "rect", label: "paypal" },
      createOrder: async () => {
        setBusy(true);
        setNotice(null);
        const res = await fetch("/api/paypal/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artist_id: artistId,
            amount_eur: resolvedAmount,
          }),
        });
        const data = (await res.json()) as { id?: string; error?: string };
        setBusy(false);
        if (!res.ok || !data.id) {
          throw new Error(data.error ?? "Could not create PayPal order.");
        }
        return data.id;
      },
      onApprove: async (data) => {
        setBusy(true);
        setNotice(null);
        const res = await fetch("/api/paypal/capture-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderID: data.orderID }),
        });
        const payload = (await res.json()) as {
          ok?: boolean;
          error?: string;
          amount_eur?: number;
          duplicate?: boolean;
        };
        setBusy(false);
        if (!res.ok || !payload.ok) {
          setNotice(payload.error ?? "Payment could not be verified.");
          return;
        }
        if (payload.duplicate) {
          setNotice("This payment was already recorded. Thank you!");
        } else {
          setNotice(
            `Thank you! €${payload.amount_eur?.toFixed(2) ?? resolvedAmount.toFixed(2)} received.`
          );
        }
        setOpen(false);
      },
      onCancel: () => {
        setNotice("Checkout cancelled.");
      },
      onError: (err) => {
        setNotice(err instanceof Error ? err.message : "PayPal error.");
      },
    });

    void buttons.render(container);

    return () => {
      container.innerHTML = "";
    };
  }, [open, sdkReady, artistId, resolvedAmount]);

  const label = artistName ? `Support ${artistName}` : "Support Artist";

  return (
    <>
      <button
        type="button"
        disabled={!user}
        onClick={() => {
          setNotice(null);
          setSdkReady(false);
          setOpen(true);
          loadPayPalSdk();
        }}
        className="rounded-full bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/20 hover:shadow-violet-500/40 hover:from-violet-500 hover:to-violet-400 disabled:opacity-40 disabled:shadow-none transition-all"
        title={!user ? "Sign in to support artists" : undefined}
      >
        Support Artist ❤️
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-violet-500/20 bg-gradient-to-b from-zinc-900 to-zinc-950 p-8 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Support artist with PayPal"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-white">
                  {label} <span aria-hidden>❤️</span>
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Direct support goes 90% to the artist
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-2xl text-zinc-400 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Preset Amounts */}
            <div className="mt-6 space-y-2">
              <p className="text-xs font-semibold text-zinc-400">QUICK AMOUNTS</p>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setPreset(p);
                      setCustom("");
                    }}
                    className={`rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                      preset === p && !custom.trim()
                        ? "bg-violet-600 text-white ring-2 ring-violet-400/50"
                        : "bg-white/10 text-zinc-200 hover:bg-white/20"
                    }`}
                  >
                    €{p}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Amount */}
            <div className="mt-6">
              <label className="block text-xs font-semibold text-zinc-400">CUSTOM AMOUNT</label>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-lg font-bold text-white">€</span>
                <input
                  type="number"
                  min={MIN_EUR}
                  max={MAX_EUR}
                  step={0.5}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                  placeholder={`${MIN_EUR}–${MAX_EUR}`}
                />
              </div>
            </div>

            {/* Amount Summary */}
            {resolvedAmount && (
              <div className="mt-6 rounded-lg border border-violet-500/30 bg-violet-500/10 p-4">
                <p className="text-sm text-zinc-300">Amount to support:</p>
                <p className="mt-2 text-2xl font-bold text-white">€{resolvedAmount.toFixed(2)}</p>
                <p className="mt-2 text-xs text-zinc-400">
                  <strong className="text-white">€{(resolvedAmount * 0.9).toFixed(2)}</strong> goes to the artist
                </p>
              </div>
            )}

            {!resolvedAmount && (
              <p className="mt-4 text-xs text-amber-300">
                Choose a preset or enter a custom amount (€{MIN_EUR}–€{MAX_EUR}) to enable PayPal.
              </p>
            )}

            {/* PayPal Button Container */}
            <div className="mt-6 min-h-[120px]" ref={paypalRef} />

            {busy && <p className="mt-4 text-xs text-zinc-400">Processing with PayPal…</p>}
            {notice && (
              <div className={`mt-4 rounded-lg p-3 text-sm ${
                notice.startsWith("Thank you") || notice.includes("received")
                  ? "border border-green-500/30 bg-green-500/10 text-green-300"
                  : "border border-amber-500/30 bg-amber-500/10 text-amber-300"
              }`}>
                {notice}
              </div>
            )}

            <div className="mt-8 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setNotice(null);
                }}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
