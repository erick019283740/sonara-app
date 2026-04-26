export type UserRole = "listener" | "artist";
export type SubscriptionStatus = "free" | "premium";

export type Profile = {
  id: string;
  username: string;
  avatar_url: string | null;
  role: UserRole;
  subscription_status: SubscriptionStatus;
  created_at?: string;
};

export type Artist = {
  id: string;
  user_id: string;
  stage_name: string;
  bio: string | null;
  follower_count: number;
  total_earnings: number;
  created_at?: string;
};

export type Song = {
  id: string;
  artist_id: string;
  title: string;
  genre: string;
  duration: number;
  file_url: string;
  cover_url: string | null;
  created_at: string;
  stream_count: number;
  likes_count: number;
  shares_count?: number;
  external_click_count?: number;
  artist?: Pick<Artist, "id" | "stage_name" | "user_id"> | Pick<Artist, "id" | "stage_name" | "user_id">[];
};

export type Playlist = {
  id: string;
  user_id: string;
  name: string;
};
