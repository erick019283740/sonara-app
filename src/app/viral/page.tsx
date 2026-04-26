import { ViraltrendingFeed } from "@/components/discovery/viral-trending-feed";

export const metadata = {
  title: "Viral Discovery - SONARA",
  description: "Discover trending and new songs from indie artists",
};

export default function ViralDiscoveryPage() {
  return (
    <div className="h-screen bg-black">
      <ViraltrendingFeed />
    </div>
  );
}
