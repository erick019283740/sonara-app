import { FullPlayer } from "@/components/player/full-player";
import { MiniPlayer } from "@/components/player/mini-player";
import { GlobalPlayer } from "@/components/player/global-player";
import { Navbar } from "@/components/layout/navbar";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col pb-24">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <MiniPlayer />
      <FullPlayer />
      <GlobalPlayer />
    </div>
  );
}
