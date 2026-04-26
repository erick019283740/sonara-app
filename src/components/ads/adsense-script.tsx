"use client";

import { useUser } from "@/contexts/user-context";
import { isPremium } from "@/lib/ads/isPremium";
import { useEffect } from "react";

const SCRIPT_SRC =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
const SCRIPT_ATTR = "data-sonara-adsense";

/**
 * Loads the global AdSense library once for free-tier users (async, non-blocking).
 * Premium users never fetch the script.
 */
export function AdSenseScript() {
  const { profile, loading } = useUser();

  useEffect(() => {
    if (loading) return;
    if (typeof document === "undefined") return;
    if (isPremium(profile)) return;
    if (document.querySelector(`script[${SCRIPT_ATTR}="1"]`)) return;

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.setAttribute(SCRIPT_ATTR, "1");
    document.head.appendChild(script);
  }, [loading, profile]);

  return null;
}
