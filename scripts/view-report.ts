import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const reportId = process.argv[2] || 'e6b24176-d931-40a0-8af9-bcdd01fe27bf'

  const { data } = await supabaseAdmin
    .from('user_reports')
    .select('markdown_content')
    .eq('id', reportId)
    .single()

  console.log(data?.markdown_content)
}

main()
