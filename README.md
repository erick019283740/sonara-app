# SONARA Web

SONARA is a Next.js 16 music platform with:
- personalized feed and streaming
- artist earnings and payouts
- admin analytics (fraud, trending, live streams)
- Supabase-backed auth/data and optional Redis queue workers

## Tech Stack
- Next.js 16 (App Router), React 19, TypeScript
- Supabase (`@supabase/ssr`, `@supabase/supabase-js`)
- Zustand state management
- ESLint + TypeScript strict checks

## Local Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template and fill values:
   ```bash
   cp .env.example .env.local
   ```
3. Start development server:
   ```bash
   npm run dev
   ```

## Quality Checks
```bash
npm run typecheck
npm run lint
npm run build
```

## Environment Variables
Use `.env.example` as the source of truth. Required in production:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAILS`

Optional:
- `REDIS_URL`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

## Production Notes
- Keep service role keys server-side only.
- Ensure Supabase RLS is enabled for user-facing tables.
- Restrict admin endpoints by profile role and/or `ADMIN_EMAILS`.
- Run `npm run build` in CI before deploy.
