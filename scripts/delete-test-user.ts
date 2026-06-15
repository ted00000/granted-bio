// Deletes a Supabase user + every cascading row in the public schema
// keyed by their user_id. For sandbox testing only — DO NOT run
// against live data. The cascade exists because user_profiles, etc.
// have ON DELETE CASCADE from auth.users(id), so deleting the auth
// user takes everything with it. This script just makes that delete
// easy to do by email instead of poking at the dashboard.
//
// Usage:
//   npx tsx scripts/delete-test-user.ts <email>
//
// Will refuse to run unless the email contains "test" or the
// CONFIRM_DELETE_LIVE=1 env var is set, so a misfire on a real email
// fails loudly.

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx scripts/delete-test-user.ts <email>')
    process.exit(1)
  }

  const looksLikeTest = /test|sandbox|\+stripe|\+dev/i.test(email)
  if (!looksLikeTest && process.env.CONFIRM_DELETE_LIVE !== '1') {
    console.error(
      `Refusing to delete "${email}" — email doesn't look like a test address.\n` +
        'Re-run with CONFIRM_DELETE_LIVE=1 if you really mean it.'
    )
    process.exit(1)
  }

  const { supabaseAdmin } = await import('../src/lib/supabase')

  // Find the user by email via the admin API.
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers()
  if (listError) {
    console.error('Failed to list users:', listError.message)
    process.exit(1)
  }

  const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) {
    console.error(`No user found with email ${email}`)
    process.exit(1)
  }

  console.log(`Found user ${user.id} (${user.email})`)
  console.log('Deleting...')

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('Delete failed:', deleteError.message)
    process.exit(1)
  }

  console.log(`Deleted ${email} and all cascading rows.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
