"use client";

import { useUser } from "@/contexts/user-context";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useMemo, useState, useRef } from "react";
import Image from "next/image";

export default function UploadPage() {
  const { user, profile, loading } = useUser();
  const supabase = useMemo(() => createClient(), []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState("Indie");
  const [audio, setAudio] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;

  if (!user || !profile) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <Link href="/login" className="text-violet-300 hover:underline">
          Log in to upload
        </Link>
      </div>
    );
  }

  if (profile.role !== "artist") {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-8">
        <p className="text-sm text-zinc-200">
          Only artist accounts can upload. Switch from your profile.
        </p>
        <Link href="/profile" className="mt-4 inline-block text-violet-300 hover:underline">
          Go to profile
        </Link>
      </div>
    );
  }

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCover(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setCoverPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!audio) {
      setStatus("Choose an audio file.");
      return;
    }
    if (!title.trim()) {
      setStatus("Please enter a song title.");
      return;
    }
    setBusy(true);
    setStatus(null);

    const { data: artist, error: aErr } = await supabase
      .from("artists")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (aErr || !artist) {
      setStatus("Could not find your artist profile.");
      setBusy(false);
      return;
    }

    const audioPath = `${user.id}/tracks/${Date.now()}-${audio.name.replace(/[^\w.-]+/g, "_")}`;
    const { error: upAudio } = await supabase.storage.from("songs").upload(audioPath, audio, {
      cacheControl: "3600",
      upsert: false,
    });
    if (upAudio) {
      setStatus(upAudio.message);
      setBusy(false);
      return;
    }

    const { data: pubAudio } = supabase.storage.from("songs").getPublicUrl(audioPath);
    const fileUrl = pubAudio.publicUrl;

    let coverUrl: string | null = null;
    if (cover) {
      const coverPath = `${user.id}/covers/${Date.now()}-${cover.name.replace(/[^\w.-]+/g, "_")}`;
      const { error: upCover } = await supabase.storage.from("songs").upload(coverPath, cover, {
        cacheControl: "3600",
        upsert: false,
      });
      if (!upCover) {
        const { data: pubCover } = supabase.storage.from("songs").getPublicUrl(coverPath);
        coverUrl = pubCover.publicUrl;
      }
    }

    const { error: ins } = await supabase.from("songs").insert({
      artist_id: artist.id,
      title: title.trim(),
      description: description || null,
      genre,
      duration: 0,
      file_url: fileUrl,
      cover_url: coverUrl,
    });

    setBusy(false);
    if (ins) {
      setStatus(ins.message);
      return;
    }

    setStatus("✓ Song uploaded successfully! It's now available in your catalog.");
    setTitle("");
    setDescription("");
    setAudio(null);
    setCover(null);
    setCoverPreview(null);
    
    // Reset form
    if (audioInputRef.current) audioInputRef.current.value = "";
    if (coverInputRef.current) coverInputRef.current.value = "";
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Upload Your Track</h1>
        <p className="mt-2 text-zinc-400">
          Share your music with the SONARA community. Every stream directly supports independent artists.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-6 rounded-2xl border border-violet-500/20 bg-white/5 p-8">
        {/* Track Info Section */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Track Information</h2>
          
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-zinc-300">
              Song Title *
            </label>
            <input
              id="title"
              type="text"
              placeholder="Enter song title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="genre" className="block text-sm font-medium text-zinc-300">
                Genre
              </label>
              <select
                id="genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-white focus:border-violet-500 focus:outline-none"
              >
                <option>Indie</option>
                <option>Pop</option>
                <option>Rock</option>
                <option>Electronic</option>
                <option>Hip-Hop</option>
                <option>R&B</option>
                <option>Jazz</option>
                <option>Classical</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-zinc-300">
                Description
              </label>
              <input
                id="description"
                type="text"
                placeholder="Add a description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Media Upload Section */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Upload Media</h2>

          {/* Audio Upload */}
          <div>
            <label htmlFor="audio" className="block text-sm font-medium text-zinc-300">
              Audio File * <span className="text-xs text-zinc-500">(.mp3, .wav, .m4a)</span>
            </label>
            <input
              ref={audioInputRef}
              id="audio"
              type="file"
              accept="audio/mpeg,audio/wav,audio/m4a"
              onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full cursor-pointer rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-zinc-300 file:mr-4 file:rounded file:border-0 file:bg-violet-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-violet-700"
            />
            {audio && (
              <p className="mt-2 text-xs text-green-400">
                ✓ {audio.name} ({(audio.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>

          {/* Cover Upload */}
          <div>
            <label htmlFor="cover" className="block text-sm font-medium text-zinc-300">
              Cover Image <span className="text-xs text-zinc-500">(.jpg, .png)</span>
            </label>
            <div className="mt-1 flex gap-4">
              <div className="flex-1">
                <input
                  ref={coverInputRef}
                  id="cover"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleCoverChange}
                  className="block w-full cursor-pointer rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-zinc-300 file:mr-4 file:rounded file:border-0 file:bg-violet-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-violet-700"
                />
                {cover && (
                  <p className="mt-2 text-xs text-green-400">
                    ✓ {cover.name}
                  </p>
                )}
              </div>
              {coverPreview && (
                <div className="h-20 w-20 overflow-hidden rounded-lg border border-white/10">
                  <Image
                    src={coverPreview}
                    alt="Cover preview"
                    width={80}
                    height={80}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Message */}
        {status && (
          <div
            className={`rounded-lg p-4 text-sm ${
              status.includes("successfully") || status.includes("✓")
                ? "border border-green-500/30 bg-green-500/10 text-green-400"
                : status.includes("error") || status.includes("Could not")
                  ? "border border-red-500/30 bg-red-500/10 text-red-400"
                  : "border border-amber-500/30 bg-amber-500/10 text-amber-400"
            }`}
          >
            {status}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={busy || !audio}
          className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-violet-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Publishing your track..." : "Publish Track"}
        </button>

        {/* Info Box */}
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
          <p className="text-xs text-blue-300">
            💡 <strong>SONARA Streaming:</strong> Your song will be available immediately. Each stream counts after 30 seconds of listening, with a maximum of 10 streams per user per day per song.
          </p>
        </div>
      </form>
    </div>
  );
}
