"use client";

import { Song } from "@/types/database";
import Image from "next/image";

interface ArtistStats {
  totalStreams: number;
  totalDonations: number;
  songsUploaded: number;
  totalListeners: number;
}

interface ArtistDashboardProps {
  songs: Song[];
}

export function ArtistDashboard({ songs }: ArtistDashboardProps) {
  const totalStreams = songs.reduce((sum, song) => sum + (song.stream_count || 0), 0);
  const stats: ArtistStats = {
    totalStreams,
    totalDonations: 0,
    songsUploaded: songs.length,
    totalListeners: Math.ceil(totalStreams / 5),
  };

  const topSong = songs.length > 0 
    ? songs.reduce((prev, current) => 
        (prev.stream_count || 0) > (current.stream_count || 0) ? prev : current
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Artist Dashboard</h1>
        <p className="mt-1 text-zinc-400">Track your performance and manage uploads</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Total Streams",
            value: stats.totalStreams.toLocaleString(),
            icon: "▶",
            color: "bg-blue-500/10 border-blue-500/30",
          },
          {
            label: "Total Listeners",
            value: stats.totalListeners.toLocaleString(),
            icon: "👥",
            color: "bg-green-500/10 border-green-500/30",
          },
          {
            label: "Songs Uploaded",
            value: stats.songsUploaded.toString(),
            icon: "🎵",
            color: "bg-violet-500/10 border-violet-500/30",
          },
          {
            label: "Earnings",
            value: "$" + (stats.totalDonations / 100).toFixed(2),
            icon: "💰",
            color: "bg-amber-500/10 border-amber-500/30",
          },
        ].map((stat, idx) => (
          <div
            key={idx}
            className={`rounded-lg border p-4 ${stat.color}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-zinc-400">{stat.label}</p>
                <p className="mt-2 text-2xl font-bold text-white">{stat.value}</p>
              </div>
              <span className="text-2xl">{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Top Song */}
      {topSong && (
        <div className="rounded-lg border border-violet-500/20 bg-white/5 p-6">
          <h2 className="text-lg font-semibold text-white">Your Top Track</h2>
          <div className="mt-4 flex items-center gap-4">
            {topSong.cover_url && (
              <Image
                src={topSong.cover_url}
                alt={topSong.title}
                width={64}
                height={64}
                className="h-16 w-16 rounded-lg object-cover"
              />
            )}
            <div>
              <p className="font-medium text-white">{topSong.title}</p>
              <p className="text-sm text-zinc-400">
                {topSong.stream_count?.toLocaleString()} streams
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Songs Table */}
      {songs.length > 0 && (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-300">Song</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-300">Genre</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-300">Streams</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-300">Likes</th>
              </tr>
            </thead>
            <tbody>
              {songs.map((song) => (
                <tr key={song.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <a
                      href={`/song/${song.id}`}
                      className="text-white hover:text-violet-300"
                    >
                      {song.title}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{song.genre}</td>
                  <td className="px-4 py-3 text-right text-white">
                    {(song.stream_count || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-white">
                    {(song.likes_count || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {songs.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-700 p-8 text-center">
          <p className="text-sm text-zinc-400">
            No songs uploaded yet.{" "}
            <a href="/upload" className="text-violet-400 hover:underline">
              Upload your first track
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
