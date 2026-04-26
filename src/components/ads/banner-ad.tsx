"use client";

import { isPremium } from "@/lib/ads/isPremium";
import { useUser } from "@/contexts/user-context";
import { useEffect, useRef, useState } from "react";

const PUBLISHER = "ca-pub-2908270698120929";

type Props = {
  /** When false, renders an inert placeholder (e.g. server knows user is premium). */
  enabled?: boolean;
  className?: string;
};

/**
 * Responsive AdSense unit. Lazy-fills when scrolled into view; no-ops for premium.
 */
export function BannerAd({ enabled = true, className }: Props) {
  const { profile, loading, user } = useUser();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pushedRef = useRef(false);
  const [visible, setVisible] = useState(false);

  const allow =
    enabled &&
    (!user ? true : !loading && !isPremium(profile));

  useEffect(() => {
    if (!allow || typeof IntersectionObserver === "undefined") return;
    const el = containerRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "120px 0px", threshold: 0.01 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [allow]);

  useEffect(() => {
    if (!allow || !visible || pushedRef.current) return;

    let cancelled = false;
    const tryPush = () => {
      if (cancelled || pushedRef.current) return;
      if (!window.adsbygoogle) {
        window.requestAnimationFrame(tryPush);
        return;
      }
      pushedRef.current = true;
      try {
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
      } catch {
        pushedRef.current = false;
      }
    };

    const id = window.requestAnimationFrame(tryPush);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id);
    };
  }, [allow, visible]);

  if (!allow) {
    return (
      <div
        className={className}
        aria-hidden
        data-adsense-disabled="premium"
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-white/5 bg-zinc-900/40 ${className ?? ""}`}
    >
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={PUBLISHER}
        data-ad-slot="AUTO"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
