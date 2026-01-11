# Google OAuth Setup Guide

## Issue Identified

The Google sign-up is failing with `OAuthSignin` error because:

1. **Missing NEXTAUTH_SECRET** - Required for NextAuth JWT encryption
2. **Missing NEXTAUTH_URL** - Required for OAuth callback URLs  
3. **Missing Google OAuth Credentials** - Google Client ID and Secret are not configured

## Fixes Applied

✅ **Added NEXTAUTH_SECRET** - Defaults to `dev-secret-change-in-production` in development
✅ **Added NEXTAUTH_URL** - Automatically constructs URL (defaults to `http://localhost:3000` in dev)
✅ **Conditional Google Provider** - Google OAuth provider only loads if credentials are configured

## Setup Instructions

### 1. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure:
   - **Application type**: Web application
   - **Name**: LearnHouse (or your app name)
   - **Authorized JavaScript origins**: 
     - `http://localhost:3000` (for development)
     - Your production domain (for production)
   - **Authorized redirect URIs**:
     - `http://localhost:3000/api/auth/callback/google` (for development)
     - `https://yourdomain.com/api/auth/callback/google` (for production)
6. Copy the **Client ID** and **Client Secret**

### 2. Configure Environment Variables

Add to `apps/web/.env.local`:

```env
# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-random-secret-key-here-generate-with-openssl-rand-base64-32

# Google OAuth Credentials
LEARNHOUSE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
LEARNHOUSE_GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### 3. Generate NEXTAUTH_SECRET

Generate a secure random secret:

```bash
openssl rand -base64 32
```

Or use an online generator: https://generate-secret.vercel.app/32

### 4. Restart Development Server

After adding the environment variables, restart your Next.js dev server:

```bash
cd apps/web
pnpm dev
```

## Testing

1. Navigate to `http://localhost:3000/signup?orgslug=default`
2. Click "Sign in with Google"
3. You should be redirected to Google's OAuth consent screen
4. After authorizing, you'll be redirected back and signed in

## Troubleshooting

### Error: OAuthSignin
- **Cause**: Missing or incorrect Google OAuth credentials
- **Fix**: Verify `LEARNHOUSE_GOOGLE_CLIENT_ID` and `LEARNHOUSE_GOOGLE_CLIENT_SECRET` are set correctly

### Error: Invalid redirect URI
- **Cause**: Redirect URI not added to Google Cloud Console
- **Fix**: Add `http://localhost:3000/api/auth/callback/google` to Authorized redirect URIs

### Button doesn't appear
- **Cause**: Google OAuth credentials not configured
- **Fix**: This is expected behavior - the button only shows when credentials are configured

## Production Deployment

For production, update:
- `NEXTAUTH_URL` to your production domain
- `NEXTAUTH_SECRET` to a secure random value (never commit this!)
- Add production redirect URI to Google Cloud Console
- Use environment variables in your hosting platform (Vercel, etc.)

