# SONARA Authentication System

## Übersicht

Das SONARA Authentication System basiert auf **Supabase Auth** und bietet:

- ✅ Email-basierte Authentifizierung
- ✅ User Profile Management
- ✅ Session Management mit Server-Side Rendering
- ✅ Protected Routes (Middleware-basiert)
- ✅ Automatic Token Refresh
- ✅ Email Verification

## Architektur

### Komponenten

#### 1. **Supabase Clients**
- **`/src/lib/supabase/client.ts`** - Browser-Client für CSR
- **`/src/lib/supabase/server.ts`** - Server-Client für SSR
- **`/src/lib/supabase/middleware.ts`** - Session Management & Route Protection

#### 2. **Auth Utilities**
- **`/src/lib/auth/utils.ts`** - Error Handling, Validierung
  - `parseAuthError()` - Parse Supabase Errors
  - `isValidEmail()`, `isValidPassword()`, `isValidUsername()` - Validierung
  - `getAuthErrorMessage()` - User-freundliche Error Messages

#### 3. **Auth Hooks** (`/src/lib/auth/hooks.ts`)
- `useSignIn()` - Email + Password Login
- `useSignUp()` - Neue Accounts erstellen
- `useSignOut()` - Logout

#### 4. **Context**
- **`/src/contexts/user-context.tsx`** - Global User State
  - `user` - Supabase Auth User
  - `profile` - Custom User Profile (username, role, etc.)
  - `loading` - Loading State
  - `refreshProfile()` - Profile neu laden
  - `signOut()` - Logout

#### 5. **Pages**
- **`/src/app/login/page.tsx`** - Login Form
- **`/src/app/register/page.tsx`** - Signup Form
- **`/src/app/auth/callback/page.tsx`** - Email Verification Handler

#### 6. **Components**
- **`/src/components/auth/callback-handler.tsx`** - Email Callback Processor

## Datenfluss

### Signup Flow

```
User trägt Daten ein
       ↓
Validierung (Email, Password, Username)
       ↓
`useSignUp()` Aufruf
       ↓
Supabase Auth
  - User erstellen
  - Verification Email senden
       ↓
Redirect zu `/auth/callback`
       ↓
CallbackHandler
  - Code aus URL extrahieren
  - Session via `exchangeCodeForSession()`
       ↓
Redirect zu `/`
       ↓
UserProvider lädt Profile
```

### Login Flow

```
User trägt Email + Password ein
       ↓
Validierung
       ↓
`useSignIn()` Aufruf
       ↓
Supabase signInWithPassword()
       ↓
Session wird in Cookies gespeichert
       ↓
Redirect zu `/`
       ↓
UserProvider lädt Profile
```

### Protected Route Flow

```
User fordert /upload an
       ↓
Middleware (updateSession)
  - Session aus Cookies prüfen
  - Ist Route geschützt?
  - Ist User authentifiziert?
       ↓
Wenn NICHT authentifiziert → Redirect zu /login
Wenn authentifiziert → Seite laden
```

## Geschützte Routes

Die folgenden Routes sind geschützt und erfordern Authentication:

- `/upload` - Song Upload
- `/dashboard` - Artist Dashboard
- `/artist/[id]/edit` - Artist Bearbeitung
- `/profile` - User Profile

## Öffentliche Routes

Diese Routes sind öffentlich zugänglich:

- `/` - Home
- `/login` - Login Seite
- `/register` - Signup Seite
- `/auth/callback` - Email Callback
- `/explore` - Explore Feed
- `/song/[id]` - Song Details

## Verwendung

### Sign Up

```typescript
import { useSignUp } from "@/lib/auth/hooks";

function RegisterForm() {
  const { signUp, loading, error } = useSignUp();

  const handleSubmit = async (email, password, username) => {
    const success = await signUp(email, password, username, {
      role: "artist",
      stageName: "My Band",
    });
    
    if (success) {
      // Redirect happens automatically
    }
  };
}
```

### Sign In

```typescript
import { useSignIn } from "@/lib/auth/hooks";

function LoginForm() {
  const { signIn, loading, error } = useSignIn();

  const handleSubmit = async (email, password) => {
    const success = await signIn(email, password);
    
    if (success) {
      // Redirect happens automatically
    }
  };
}
```

### Get Current User

```typescript
import { useUser } from "@/contexts/user-context";

function MyComponent() {
  const { user, profile, loading } = useUser();

  if (loading) return <p>Loading...</p>;
  
  if (!user) return <p>Not signed in</p>;
  
  return (
    <div>
      <p>Email: {user.email}</p>
      <p>Username: {profile?.username}</p>
      <p>Role: {profile?.role}</p>
    </div>
  );
}
```

### Sign Out

```typescript
import { useSignOut } from "@/lib/auth/hooks";

function LogoutButton() {
  const { signOut, loading } = useSignOut();

  return (
    <button onClick={() => signOut()} disabled={loading}>
      {loading ? "Logging out..." : "Logout"}
    </button>
  );
}
```

## Error Handling

Alle Auth Hooks returnen `error` mit strukturierter Information:

```typescript
const { signIn, error } = useSignIn();

if (error) {
  console.log(error.code); // "invalid_credentials", "invalid_email", etc.
  console.log(error.message); // User-freundliche Nachricht
  console.log(error.original); // Original Supabase Error
}
```

Mögliche Error Codes:
- `invalid_credentials` - Email/Password stimmt nicht
- `invalid_email` - Email Format ungültig
- `invalid_password` - Password zu kurz
- `user_already_exists` - Email bereits registriert
- `email_not_confirmed` - Email noch nicht verifiziert
- `auth_error` - Generischer Auth Error
- `unknown_error` - Unbekannter Error

## Validierung

Folgende Validierungen sind integriert:

### Username
- 3-20 Zeichen
- Alphanumeric + Underscore + Hyphen
- Regex: `/^[a-zA-Z0-9_-]{3,20}$/`

### Email
- Standard Email Format
- Regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`

### Password
- Minimum 6 Zeichen
- Keine speziellen Anforderungen (per Supabase)

## Supabase Konfiguration

### Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Auth Settings (Dashboard)

1. **Email Confirmation**
   - Optional (kann disable sein)
   - Wenn enabled: Verification Email wird gesendet

2. **Password Requirements**
   - Minimum: 6 Zeichen
   - Anpassbar in Supabase Dashboard

3. **Redirect URLs**
   - Login: `http://localhost:3000` (local)
   - Confirmation: `http://localhost:3000/auth/callback` (local)

## Database Schema

### Profiles Table

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'listener',  -- 'listener' or 'artist'
  stage_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Artists Table

```sql
CREATE TABLE artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users (id) ON DELETE CASCADE,
  stage_name TEXT UNIQUE NOT NULL,
  bio TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Troubleshooting

### Issue: "Auth not working"
**Solution:** 
1. Überprüfe Environment Variables
2. Starte dev Server neu
3. Prüfe Supabase Project Settings

### Issue: "Email verification link expired"
**Solution:**
1. Signup erneut durchführen
2. Link ist 24h gültig
3. Prüfe Spam Folder

### Issue: "Protected route redirects to login"
**Solution:**
1. Überprüfe Middleware Route Patterns
2. Prüfe Browser Cookies
3. Überprüfe Supabase Session

### Issue: "User profile not loading"
**Solution:**
1. Prüfe Profiles Table hat entsprechende Row
2. Überprüfe user.id Matcht
3. Prüfe RLS (Row Level Security) Policies

## Next Steps

1. **Custom Fields hinzufügen** - Neue Felder zu Profiles Table
2. **OAuth integrieren** - Google, GitHub Login
3. **Password Reset** - Forgot Password Flow
4. **2FA** - Two-Factor Authentication
5. **Profile Completion** - Erzwinge Profil-Completion nach Signup

## Weitere Ressourcen

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side-rendering)
- [Next.js Auth Pattern](https://nextjs.org/docs/app/building-your-application/data-fetching/patterns)
