import { createClient } from "@/lib/supabase/server";
import type { Song } from "@/types/database";
import Link from "next/link";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <Link href="/login" className="text-violet-300 hover:underline">
          Log in
        </Link>
      </div>
    );
  }

  const { data: artist } = await supabase
    .from("artists")
    .select("id, stage_name, follower_count, total_earnings")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!artist) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm text-zinc-300">You need an artist profile to view this dashboard.</p>
        <Link href="/profile" className="mt-4 inline-block text-violet-300 hover:underline">
          Open profile
        </Link>
      </div>
    );
  }

  const { data: songsRaw } = await supabase
    .from("songs")
    .select("id, title, stream_count, likes_count, genre, created_at")
    .eq("artist_id", artist.id)
    .order("stream_count", { ascending: false });

  const songs = (songsRaw ?? []) as Pick<
    Song,
    "id" | "title" | "stream_count" | "likes_count" | "genre" | "created_at"
  >[];

  const totalStreams = songs.reduce((acc, s) => acc + (s.stream_count ?? 0), 0);

  const { data: recentEarnings } = await supabase
    .from("earnings")
    .select("id, amount, source, created_at")
    .eq("artist_id", artist.id)
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-white">Artist dashboard</h1>
        <p className="text-sm text-zinc-400">{artist.stage_name}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Total streams (sum)</p>
          <p className="mt-2 text-3xl font-semibold text-white">{totalStreams}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Artist earnings (ledger)</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-300">
            €{Number(artist.total_earnings).toFixed(2)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Followers</p>
          <p className="mt-2 text-3xl font-semibold text-white">{artist.follower_count}</p>
        </div>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">Top songs</h2>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Genre</th>
                <th className="px-4 py-3 text-right">Streams</th>
                <th className="px-4 py-3 text-right">Likes</th>
              </tr>
            </thead>
            <tbody>
              {songs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                    No uploads yet.{" "}
                    <Link href="/upload" className="text-violet-300 hover:underline">
                      Upload a song
                    </Link>
                  </td>
                </tr>
              ) : (
                songs.map((s) => (
                  <tr key={s.id} className="border-t border-white/5">
                    <td className="px-4 py-3 text-zinc-200">{s.title}</td>
                    <td className="px-4 py-3 text-zinc-500">{s.genre}</td>
                    <td className="px-4 py-3 text-right text-zinc-200">{s.stream_count}</td>
                    <td className="px-4 py-3 text-right text-zinc-200">{s.likes_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">Recent earnings</h2>
        <ul className="space-y-2 text-sm">
          {(recentEarnings ?? []).length === 0 ? (
            <li className="text-zinc-500">No ledger entries yet.</li>
          ) : (
            (recentEarnings ?? []).map((e) => (
              <li
                key={e.id}
                className="flex justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3"
              >
                <span className="capitalize text-zinc-400">{e.source}</span>
                <span className="text-emerald-300">+€{Number(e.amount).toFixed(4)}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
