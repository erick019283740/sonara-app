import { ExploreSongFeed } from "@/components/ads/explore-song-feed";
import { RisingArtistCard } from "@/components/discovery/rising-artist-card";
import { SwipeMusicFeed } from "@/components/feed/swipe-music-feed";
import { fetchPersonalizedFeed } from "@/lib/algorithms/personalized-feed";
import { fetchRisingArtists } from "@/lib/algorithms/rising-artists";
import { fetchTrendingSongs, type TrendingSong } from "@/lib/algorithms/trending";
import { isPremium } from "@/lib/ads/isPremium";
import { createClient } from "@/lib/supabase/server";
import type { Song } from "@/types/database";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string; tab?: string }> };

const TABS = [
  { id: "trending", label: "🔥 Trending" },
  { id: "rising", label: "🚀 Rising Artists" },
  { id: "foryou", label: "🎧 For You" },
  { id: "swipe", label: "🔥 Swipe Mode" },
] as const;

function tabHref(tab: string, q?: string) {
  const p = new URLSearchParams();
  p.set("tab", tab);
  if (q?.trim()) p.set("q", q.trim());
  return `/explore?${p.toString()}`;
}

export default async function ExplorePage({ searchParams }: Props) {
  const { q, tab } = await searchParams;
  const term = (q ?? "").trim();
  const activeTab = TABS.some((t) => t.id === (tab ?? "")) ? (tab as string) : "trending";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profileRow } = user
    ? await supabase
        .from("profiles")
        .select("subscription_status")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const showAds = !isPremium(profileRow);

  let searchSongs: Song[] = [];
  if (term) {
    const { data: raw } = await supabase
      .from("songs")
      .select(
        "id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count, artist:artists(id, stage_name, user_id)"
      )
      .or(`title.ilike.%${term}%,genre.ilike.%${term}%`)
      .order("stream_count", { ascending: false })
      .limit(40);
    searchSongs = (raw ?? []) as unknown as Song[];
  }

  let trending: TrendingSong[] = [];
  let rising: Awaited<ReturnType<typeof fetchRisingArtists>> = [];
  let forYou: Song[] = [];
  let swipeSongs: Song[] = [];

  if (!term) {
    if (activeTab === "trending") {
      trending = await fetchTrendingSongs(supabase, 40);
    } else if (activeTab === "rising") {
      rising = await fetchRisingArtists(supabase, 20);
    } else if (activeTab === "foryou" && user) {
      forYou = await fetchPersonalizedFeed(supabase, user.id, 40);
    } else if (activeTab === "swipe") {
      if (user) {
        swipeSongs = await fetchPersonalizedFeed(supabase, user.id, 55);
      }
      if (!swipeSongs.length) {
        swipeSongs = await fetchTrendingSongs(supabase, 55);
      }
    }
  }

  const isSwipe = !term && activeTab === "swipe";

  return (
    <div className={isSwipe ? "space-y-4" : "space-y-8"}>
      {!isSwipe && (
        <div>
          <h1 className="text-2xl font-semibold text-white">Explore</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Discover what&apos;s trending, who&apos;s rising, and a feed tuned to your taste.
          </p>
        </div>
      )}

      <form className={`flex gap-2 ${isSwipe ? "px-1" : ""}`}>
        <input
          name="q"
          defaultValue={term}
          placeholder="Search songs or genres…"
          className="flex-1 rounded-xl border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500"
        />
        <input type="hidden" name="tab" value={activeTab} />
        <button
          type="submit"
          className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white"
        >
          Search
        </button>
      </form>

      {term ? (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-zinc-300">Search results</h2>
          {searchSongs.length === 0 ? (
            <p className="text-sm text-zinc-500">No tracks match that search.</p>
          ) : (
            <ExploreSongFeed songs={searchSongs} showAds={showAds} />
          )}
        </section>
      ) : (
        <>
          <nav className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={tabHref(t.id, q)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  activeTab === t.id
                    ? "bg-white text-zinc-900"
                    : "bg-white/5 text-zinc-300 hover:bg-white/10"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          {activeTab === "swipe" && (
            <section className="min-h-[calc(100dvh-8rem)]">
              <SwipeMusicFeed
                key={swipeSongs.map((s) => s.id).join("|")}
                songs={swipeSongs}
              />
            </section>
          )}

          {activeTab === "trending" && (
            <section className="space-y-4">
              <p className="text-xs text-zinc-500">
                Ranked by a lightweight SONARA trending score (streams, likes, recent listens,
                artist reach, shares).
              </p>
              {trending.length === 0 ? (
                <p className="text-sm text-zinc-500">No songs yet.</p>
              ) : (
                <ExploreSongFeed
                  songs={trending}
                  showAds={showAds}
                  trendingScores={Object.fromEntries(
                    trending.map((s) => [s.id, s.trending_score])
                  )}
                />
              )}
            </section>
          )}

          {activeTab === "rising" && (
            <section className="space-y-4">
              <p className="text-xs text-zinc-500">
                Artists gaining followers, plays, and fresh uploads in the last 7 days.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rising.length === 0 ? (
                  <p className="text-sm text-zinc-500">No rising artists yet.</p>
                ) : (
                  rising.map((a) => <RisingArtistCard key={a.id} artist={a} />)
                )}
              </div>
            </section>
          )}

          {activeTab === "foryou" && (
            <section className="space-y-4">
              {!user ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
                  <p>Sign in for a personalized mix (genres you like, listening history, follows).</p>
                  <Link href="/login" className="mt-3 inline-block text-violet-300 hover:underline">
                    Log in
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-xs text-zinc-500">
                    ~60% similar to your taste, ~40% discovery from what&apos;s trending.
                  </p>
                  {forYou.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      Like songs and follow artists to improve this feed.
                    </p>
                  ) : (
                    <ExploreSongFeed songs={forYou} showAds={showAds} />
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
