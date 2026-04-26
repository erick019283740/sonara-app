import type { RisingArtist } from "@/lib/algorithms/rising-artists";
import Link from "next/link";

type Props = { artist: RisingArtist };

export function RisingArtistCard({ artist }: Props) {
  return (
    <Link
      href={`/artist/${artist.id}`}
      className="flex flex-col rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-violet-500/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{artist.stage_name}</p>
          <p className="text-xs text-zinc-500">
            {artist.follower_count.toLocaleString()} followers
          </p>
        </div>
        <span className="rounded-full bg-violet-600/20 px-2 py-0.5 text-[10px] font-medium text-violet-200">
          Rising
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-zinc-400">
        <div>
          <dt className="text-zinc-500">+Follows 7d</dt>
          <dd className="text-zinc-200">{artist.new_follows_7d}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Streams 7d</dt>
          <dd className="text-zinc-200">{artist.streams_7d}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Uploads 7d</dt>
          <dd className="text-zinc-200">{artist.uploads_7d}</dd>
        </div>
      </dl>
    </Link>
  );
}
