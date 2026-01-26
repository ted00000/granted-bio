# Deployment Guide for granted.bio

## Overview

This guide covers deploying granted.bio to production with:
- **Vercel** - Frontend hosting
- **Supabase** - Database, Auth, and Storage
- **Resend** - Transactional emails
- **Digital Ocean** - ETL job processing (optional)

---

## 1. Supabase Configuration

### Auth Settings

1. Go to Supabase Dashboard > Authentication > URL Configuration
2. Set the following:
   - **Site URL**: `https://granted.bio`
   - **Redirect URLs**: Add these:
     - `https://granted.bio/auth/callback`
     - `https://granted.bio/login`
     - `http://localhost:3000/auth/callback` (for local dev)

### Email Templates (Supabase + Resend)

1. Go to Supabase Dashboard > Authentication > Email Templates
2. Update the templates to use your branding:

**Confirm signup email:**
```html
<h2>Welcome to granted.bio</h2>
<p>Click the link below to confirm your email:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm your email</a></p>
```

**Reset password email:**
```html
<h2>Reset your password</h2>
<p>Click the link below to reset your password:</p>
<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>
```

### Configure Resend SMTP

1. Create a Resend account at https://resend.com
2. Add and verify your domain (granted.bio)
3. Get your SMTP credentials from Resend dashboard
4. In Supabase Dashboard > Project Settings > Auth:
   - Enable "Custom SMTP"
   - SMTP Host: `smtp.resend.com`
   - SMTP Port: `465`
   - SMTP User: `resend`
   - SMTP Password: Your Resend API key
   - Sender email: `noreply@granted.bio`
   - Sender name: `granted.bio`

### Storage Bucket

1. Go to Supabase Dashboard > Storage
2. Create a new bucket called `etl-uploads`
3. Set bucket to private (not public)
4. Add a policy for authenticated users with admin role to upload

### Make First User Admin

After signing up, run this SQL to make yourself admin:

```sql
UPDATE user_profiles
SET role = 'admin'
WHERE email = 'your-email@example.com';
```

---

## 2. Vercel Deployment

### Connect Repository

1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Select the `granted-bio` project

### Environment Variables

Add these environment variables in Vercel:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://oysfqbrqtzcnmxwvxpvd.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `NEXT_PUBLIC_APP_URL` | `https://granted.bio` |

### Domain Configuration

1. Go to Vercel project settings > Domains
2. Add `granted.bio`
3. Configure DNS at your registrar:
   - A record: `@` → `76.76.21.21`
   - CNAME record: `www` → `cname.vercel-dns.com`

### Deploy

Click "Deploy" or push to your main branch to trigger a deployment.

---

## 3. Digital Ocean (ETL Processing)

For running the Python ETL scripts, you can use a Digital Ocean Droplet or App Platform.

### Option A: Droplet (Manual)

1. Create a Droplet (Ubuntu 22.04, Basic, $6/mo)
2. SSH into the droplet
3. Install dependencies:

```bash
sudo apt update
sudo apt install python3-pip python3-venv postgresql-client
```

4. Clone the repo and set up the ETL environment:

```bash
git clone https://github.com/yourusername/granted-bio.git
cd granted-bio/etl
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

5. Create a `.env` file with database credentials:

```bash
DATABASE_URL=postgresql://postgres.oysfqbrqtzcnmxwvxpvd:PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres
OPENAI_API_KEY=your-key
```

6. Run ETL manually:

```bash
python load_to_supabase.py
```

### Option B: App Platform (Automated)

1. Create an App in Digital Ocean App Platform
2. Use the `etl/` directory as the source
3. Configure as a "Job" component
4. Set environment variables
5. Schedule with cron or trigger via webhook

### Webhook Integration (Future)

The admin upload interface creates ETL jobs in the database. To process them automatically:

1. Set up a webhook endpoint on your Digital Ocean service
2. Update `/api/admin/etl/process` to call the webhook
3. The webhook triggers the Python ETL scripts

---

## 4. Post-Deployment Checklist

- [ ] Sign up for an account on production
- [ ] Make your account admin via SQL
- [ ] Test login/logout flow
- [ ] Test password reset email (via Resend)
- [ ] Verify admin dashboard loads
- [ ] Test search functionality
- [ ] Upload test data via admin interface

---

## Environment Variables Reference

### Required

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (server-side only) |
| `OPENAI_API_KEY` | OpenAI API key for embeddings |

### Optional

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | Production URL (defaults to localhost) |
| `DATABASE_URL` | Direct database connection (for ETL scripts) |

---

## Troubleshooting

### Auth emails not sending

1. Check Resend dashboard for delivery status
2. Verify domain is verified in Resend
3. Check spam folder
4. Verify SMTP settings in Supabase

### Admin access denied

1. Check user_profiles table for your user
2. Verify role is set to 'admin'
3. Clear cookies and log in again

### Build errors

1. Run `npm run build` locally first
2. Check for TypeScript errors
3. Verify all environment variables are set
