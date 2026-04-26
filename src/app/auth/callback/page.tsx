"use client";

import { Suspense } from "react";
import { AuthCallbackHandler } from "@/components/auth/callback-handler";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense
        fallback={
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center max-w-md">
            <p className="text-sm text-zinc-400">Verifying email...</p>
          </div>
        }
      >
        <AuthCallbackHandler />
      </Suspense>
    </div>
  );
}
