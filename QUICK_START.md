# SONARA Music Platform - Quick Start Guide

## 🎯 What's New in This Build

This version includes a **complete music upload and streaming system** with artist monetization features.

## 🚀 Getting Started

### 1. Setup & Installation

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env.local

# Required env variables:
# - NEXT_PUBLIC_SUPABASE_URL
# - NEXT_PUBLIC_SUPABASE_ANON_KEY
# - NEXT_PUBLIC_PAYPAL_CLIENT_ID (for donations)

# Start development server
npm run dev
```

Visit: http://localhost:3000

### 2. Create Artist Account

1. Go to `/register` → Create account
2. Go to `/profile` → Switch to "Artist" role
3. You can now upload songs!

### 3. Upload Your First Song

1. Navigate to `/upload`
2. Fill in:
   - **Song Title** (required)
   - **Genre** (Indie, Pop, Rock, etc.)
   - **Description** (optional)
   - **Audio File** (required) - .mp3, .wav, .m4a
   - **Cover Image** (optional) - .jpg, .png
3. Click "Publish Track"
4. Song appears immediately in your library and catalog

### 4. Play & Stream Tracking

**How Streams Are Counted:**

1. User plays your song
2. Waits **30+ seconds** ✓ → Stream counts
3. **10 streams maximum per day** per user (resets daily)
4. Backend logs stream in database
5. Artist profile updated with play count

**Try it:**
- Go to any song page
- Click play
- Keep playing for 30+ seconds
- Check the player for "✓ Stream wird gezählt!" message

### 5. Support Artist Feature

1. While listening to a song
2. Click **"❤️ Support Artist"** button
3. Select or enter donation amount
4. Payment processes via PayPal
5. Artist receives funds directly

**Test amounts:** $2, $5, $10, $20 (or custom)

### 6. View Artist Dashboard

1. Login as artist
2. Go to `/dashboard`
3. See:
   - Total streams
   - Top tracks
   - Earnings
   - Listener count
   - All uploaded songs with stats

## 📁 Key Features

### Upload Page (`/app/upload`)
- ✅ Audio file validation
- ✅ Cover image preview
- ✅ Real-time file size display
- ✅ Genre selection
- ✅ Supabase Storage integration

### Music Player
- ✅ Play/Pause controls
- ✅ Progress bar with seek
- ✅ Queue management
- ✅ Full-screen player
- ✅ Stream tracking

### Streaming Logic (`/lib/streaming/stream-tracker.ts`)
- ✅ 30-second minimum rule
- ✅ 10 streams/day limit (per-user, per-song)
- ✅ Unique user ID (localStorage)
- ✅ Real-time feedback in UI

### Monetization
- ✅ Direct donations to artists
- ✅ PayPal integration (ready)
- ✅ Multiple payment amounts
- ✅ Artist earnings dashboard

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14, React, TypeScript, Tailwind CSS |
| **Backend** | Next.js API Routes, Supabase |
| **Database** | PostgreSQL (Supabase) |
| **Storage** | Supabase Storage (S3-compatible) |
| **Audio** | HTML5 Audio API |
| **Payments** | PayPal (integrated) |

## 📊 Database Tables

### songs
```
id (UUID, PK)
artist_id (UUID, FK)
title (VARCHAR)
genre (VARCHAR)
file_url (VARCHAR) - Supabase URL
cover_url (VARCHAR) - Supabase URL
stream_count (INT) - Updated by /api/streams
likes_count (INT)
shares_count (INT)
created_at (TIMESTAMP)
```

### streams
```
id (UUID, PK)
song_id (UUID, FK)
user_id (VARCHAR) - From localStorage
duration_ms (INT)
created_at (TIMESTAMP)
```

### donations
```
id (UUID, PK)
artist_id (UUID, FK)
song_id (UUID, FK)
amount (NUMERIC)
currency (VARCHAR)
payment_id (VARCHAR) - PayPal ID
created_at (TIMESTAMP)
```

## 🎵 Example Workflow

```
ARTIST JOURNEY:
Register → Artist Role → Upload Song → Share Link
                           ↓
                       Published ✓

LISTENER JOURNEY:
Browse → Find Song → Click Play → Listen 30s+ → Stream ✓
                                  → Like ❤️
                                  → Share 🔗
                                  → Support Artist 💰
```

## ⚡ API Endpoints

### `POST /api/streams`
Record a stream completion
```json
{
  "song_id": "uuid",
  "seconds_played": 31
}
```

### `POST /api/donations`
Process donation (requires auth)
```json
{
  "artist_id": "uuid",
  "amount": 10
}
```

### `GET /api/songs`
Get song catalog (paginated)

### `GET /api/artists/[id]`
Get artist profile

## 🛠️ Customization

### Change Stream Duration
Edit: `/lib/streaming/stream-tracker.ts`
```typescript
const STREAM_MIN_DURATION = 30 * 1000; // 30 seconds
```

### Change Daily Limit
```typescript
const MAX_STREAMS_PER_SONG_PER_DAY = 10;
```

### Customize UI Colors
Edit: Tailwind classes in components
```tsx
// Example: Change button color
className="bg-violet-600 hover:bg-violet-700"
```

### Storage Paths
Edit: `/app/upload/page.tsx`
```typescript
const audioPath = `${user.id}/tracks/${Date.now()}-...`;
const coverPath = `${user.id}/covers/${Date.now()}-...`;
```

## 🔐 Security Features

- ✅ User authentication required
- ✅ Artist role verification
- ✅ Supabase RLS (Row Level Security)
- ✅ File type validation
- ✅ Storage access control
- ✅ User ID isolation

## 🧪 Testing Checklist

- [ ] Upload song with audio + cover
- [ ] Play song and verify stream count after 30s
- [ ] Try playing same song 10+ times (verify limit)
- [ ] Test daily reset (next day should allow 10 again)
- [ ] Test "Support Artist" donation flow
- [ ] Check artist dashboard updates
- [ ] Try sharing song
- [ ] Test on mobile (responsive)

## 📱 Mobile Compatibility

- ✅ Responsive design
- ✅ Touch-friendly controls
- ✅ Mobile player optimized
- ✅ Progress bar swipe seek

## 🚨 Common Issues

### "File upload failed"
- Check file size (keep under 100MB for audio)
- Verify audio format (.mp3, .wav, .m4a)
- Check Supabase Storage permissions

### "Stream not counting"
- Verify you listened for 30+ seconds
- Check browser console for errors
- Verify user_id is in localStorage

### "Donation failed"
- Check PayPal credentials in env
- Verify artist_id is valid
- Check network in DevTools

## 🎓 Learning Resources

- [Stream Tracking System Docs](./STREAMING_SYSTEM.md)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Supabase Docs](https://supabase.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)

## 📞 Support

For bugs or questions:
1. Check existing issues
2. Review error logs in browser console
3. Verify environment variables
4. Check Supabase dashboard for data

## 🎉 What's Next?

Upcoming features:
- [ ] Playlists creation
- [ ] Social features (follow, comments)
- [ ] Advanced analytics
- [ ] Artist collaboration
- [ ] Premium subscription tiers
- [ ] Mobile app version
- [ ] Algorithmic recommendations

---

**Happy uploading! 🎵**
