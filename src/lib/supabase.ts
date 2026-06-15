import { createClient } from '@supabase/supabase-js'

// Accept either SUPABASE_SERVICE_KEY (the historical name in this
// repo + .env.example) or SUPABASE_SERVICE_ROLE_KEY (the name Vercel
// auto-provisions when you connect a Supabase project, and the name
// Supabase docs use). Without this fallback, deploying to a fresh
// Vercel project with the auto-provisioned env var name silently
// breaks every supabaseAdmin call.
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
  // Surface this loudly in logs at module init rather than letting
  // every supabaseAdmin call fail mysteriously.
  console.error(
    '[supabase] Neither SUPABASE_SERVICE_KEY nor SUPABASE_SERVICE_ROLE_KEY is set — supabaseAdmin will fail.'
  )
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  SERVICE_KEY!
)
