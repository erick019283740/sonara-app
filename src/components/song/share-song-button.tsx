"use client";

import { useCallback, useState } from "react";

type Props = {
  songId: string;
  title?: string;
  className?: string;
};

const SHARE_BLURB = "🔥 Listen to this on SONARA";

export function ShareSongButton({ songId, title, className }: Props) {
  const [msg, setMsg] = useState<string | null>(null);

  const shareUrl = useCallback(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/song/${songId}`;
  }, [songId]);

  const recordShare = useCallback(() => {
    void fetch("/api/share/song", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_id: songId }),
    }).catch(() => {});
  }, [songId]);

  const copyLink = useCallback(async () => {
    setMsg(null);
    const url = shareUrl();
    const text = `${SHARE_BLURB}${title ? ` — ${title}` : ""}\n${url}`;
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Link copied!");
      recordShare();
    } catch {
      setMsg("Copy failed — copy manually.");
    }
  }, [recordShare, shareUrl, title]);

  const shareX = useCallback(() => {
    const url = encodeURIComponent(shareUrl());
    const text = encodeURIComponent(`${SHARE_BLURB}${title ? ` — ${title}` : ""}`);
    recordShare();
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
  }, [recordShare, shareUrl, title]);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => void copyLink()}
        className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10"
      >
        Share song
      </button>
      <button
        type="button"
        onClick={shareX}
        className="rounded-lg border border-white/20 px-2 py-1 text-xs text-zinc-300 hover:bg-white/5"
      >
        Post to X
      </button>
      {msg && <span className="text-[10px] text-emerald-400">{msg}</span>}
    </div>
  );
}
