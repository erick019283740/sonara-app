# SONARA Streaming & Monetization System

## Overview

SONARA is a modern music streaming platform focused on independent artists with built-in monetization features.

## Features

### 1. **Upload System** ✅
- Song uploads with metadata (title, genre, description)
- Cover image uploads with preview
- Automatic file validation
- Location: `/app/upload`

### 2. **Music Player** ✅
- HTML5 Audio playback
- Play/Pause controls
- Progress bar with seek functionality
- Queue management
- Full-screen and mini player modes

### 3. **Stream Tracking** ✅
**Rules:**
- Stream counts only after **30 seconds** of listening
- Maximum **10 streams per user per song per day**
- User ID generated and stored in `localStorage`

**Implementation:**
```typescript
// Located in: /lib/streaming/stream-tracker.ts
- startStreamSession(songId)
- checkStreamThreshold() // 30 seconds
- checkDailyLimit(songId) // 10/day
- recordStream(songId) // Backend sync
- endStreamSession()
```

### 4. **Monetization: Support Artist** ✅
- Direct donations to artists
- Preset amounts: $2, $5, $10, $20
- Custom amount input
- Modal dialog with payment flow
- Location: `/components/paypal/support-artist-button.tsx`

### 5. **Artist Dashboard** (Upcoming)
- Upload history
- Stream statistics
- Revenue tracking
- Audience insights

## Technical Stack

- **Frontend:** Next.js 14+ (App Router), React, TypeScript, Tailwind CSS
- **Backend:** Next.js API Routes, Supabase
- **Storage:** Supabase Storage (songs bucket)
- **Database:** PostgreSQL via Supabase
- **Audio:** HTML5 Audio API

## File Structure

```
src/
├── app/
│   ├── upload/          # Song upload page
│   ├── song/[id]/       # Song detail page
│   ├── artist/[id]/     # Artist profile
│   └── api/
│       ├── streams/     # Stream tracking endpoint
│       ├── donations/   # Donation processing
│       └── ...
├── components/
│   ├── player/
│   │   ├── full-player.tsx
│   │   ├── mini-player.tsx
│   │   └── stream-info.tsx
│   ├── paypal/
│   │   └── support-artist-button.tsx
│   └── song/
│       └── song-card.tsx
├── contexts/
│   └── player-context.tsx # Global player state
├── lib/
│   ├── streaming/
│   │   └── stream-tracker.ts # Stream logic
│   ├── supabase/
│   ├── paypal/
│   └── analytics/
└── types/
    └── database.ts
```

## Stream Counting Example

```typescript
// User plays a song
User opens player → startStreamSession(songId)
                   ↓
        User listens for 30+ seconds
                   ↓
        checkStreamThreshold() → true
        checkDailyLimit() → true
                   ↓
        recordStream() → POST /api/streams
                   ↓
        Backend: Increment song.stream_count
        Backend: Record in streams table
                   ↓
        Response: { success: true, streamCount: 42 }
```

## Database Schema (Key Tables)

### songs
```sql
id UUID
title VARCHAR
artist_id UUID
file_url VARCHAR
cover_url VARCHAR
stream_count INT
likes_count INT
shares_count INT
created_at TIMESTAMP
```

### streams
```sql
id UUID
song_id UUID
user_id VARCHAR
duration_ms INT
created_at TIMESTAMP
```

### donations
```sql
id UUID
song_id UUID
artist_id UUID
amount NUMERIC
currency VARCHAR
created_at TIMESTAMP
```

## Endpoints

### POST /api/streams
Record a stream completion

**Request:**
```json
{
  "song_id": "uuid",
  "seconds_played": 31
}
```

**Response:**
```json
{
  "ok": true
}
```

### POST /api/donations
Process a donation (requires auth)

**Request:**
```json
{
  "artist_id": "uuid",
  "amount": 5
}
```

**Response:**
```json
{
  "ok": true,
  "payment_id": "pay_xxx"
}
```

### GET /api/streams?songId=uuid
Get stream history for a song

## User Flow

### 1. Artist Uploads Song
```
Artist → Login → /upload page
       → Select audio + cover
       → Fill metadata
       → Click "Publish Track"
       → File uploaded to Supabase Storage
       → Song created in database
       → Song live immediately
```

### 2. Listener Plays Song
```
Listener → Discovers song
        → Clicks play
        → Player loads HTML5 audio
        → Stream session starts (0 seconds)
        → At 30 seconds → Stream counted
        → At 10 streams/day → No more counts
```

### 3. Fan Supports Artist
```
Fan → Listening to song
   → Click "❤️ Support Artist"
   → Modal opens
   → Select or enter amount
   → Click "Send $X"
   → Payment processed
   → Artist receives funds
```

## Configuration

### Stream Tracking (in `/lib/streaming/stream-tracker.ts`)
```typescript
const STREAM_MIN_DURATION = 30 * 1000; // 30 seconds
const MAX_STREAMS_PER_SONG_PER_DAY = 10;
```

### Storage Paths
- Songs: `{userId}/tracks/{timestamp}-{filename}`
- Covers: `{userId}/covers/{timestamp}-{filename}`

## UI Components

### SupportArtistButton
```tsx
<SupportArtistButton artistId="uuid" artistName="Artist Name" />
```

### StreamInfo
```tsx
<StreamInfo song={song} isPlaying={true} currentTime={35} />
```

### MiniPlayer / FullPlayer
Auto-managed by `PlayerProvider`

## Security

- ✅ User authentication required for uploads
- ✅ Artist role verification
- ✅ File type validation
- ✅ Supabase RLS policies protect data
- ✅ Donations require authentication

## Performance Optimizations

- ✅ Image lazy loading
- ✅ Audio streaming (not full download)
- ✅ Supabase caching headers (3600s)
- ✅ Optimistic UI updates
- ✅ LocalStorage for user ID persistence

## Future Enhancements

- [ ] Playlist creation
- [ ] Social features (comments, follows)
- [ ] Advanced analytics dashboard
- [ ] Revenue payouts
- [ ] Premium subscriptions
- [ ] Collaborative playlists
- [ ] Advanced search & discovery
- [ ] Mobile app

## Testing

### Manual Test Flow

1. **Upload Song**
   - Go to `/upload`
   - Select MP3 file
   - Add cover image
   - Publish

2. **Play Song**
   - Navigate to song
   - Click play
   - Check that stream is counted after 30 seconds
   - Try supporting artist with donation

3. **Stream Limits**
   - Play same song 10 times
   - Verify 11th play doesn't count
   - Next day should reset counter

## Support & Contributing

For issues or contributions, refer to the main project repository.
