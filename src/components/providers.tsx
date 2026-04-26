"use client";

import { AdSenseScript } from "@/components/ads/adsense-script";
import { PlayerProvider } from "@/contexts/player-context";
import { UserProvider } from "@/contexts/user-context";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <UserProvider>
      <AdSenseScript />
      <PlayerProvider>{children}</PlayerProvider>
    </UserProvider>
  );
}
