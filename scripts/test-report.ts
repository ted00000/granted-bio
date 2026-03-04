// Test full report generation
// Run with: npx tsx scripts/test-report.ts

// Load env BEFORE any other imports
import { config } from 'dotenv'
config({ path: '.env.local' })

async function testReport() {
  // Dynamic import after env is loaded
  const { generateTopicReport } = await import('../src/lib/reports/generate')
  const { supabaseAdmin } = await import('../src/lib/supabase')

  const topic = 'CAR-T cell therapy'
  // Use existing user from database
  const testUserId = '743d66f6-7251-4815-afe6-b8f764426943'

  console.log(`\n=== Testing Full Report Generation ===`)
  console.log(`Topic: ${topic}`)
  console.log(`User ID: ${testUserId}`)
  console.log('')

  const startTime = Date.now()

  try {
    const reportId = await generateTopicReport(testUserId, topic, false)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`\n=== Report Generated Successfully ===`)
    console.log(`Report ID: ${reportId}`)
    console.log(`Time: ${elapsed}s`)

    // Fetch and display the report
    const { data: report } = await supabaseAdmin
      .from('user_reports')
      .select('*')
      .eq('id', reportId)
      .single()

    if (report) {
      console.log(`\nStatus: ${report.status}`)
      console.log(`Project Count: ${report.project_count}`)
      console.log(`\n--- Executive Summary ---\n`)
      console.log(report.executive_summary?.substring(0, 500) + '...')
      console.log(`\n--- Markdown (first 2000 chars) ---\n`)
      console.log(report.markdown_content?.substring(0, 2000) + '...')
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error(`\n=== Report Failed (${elapsed}s) ===`)
    console.error(error)
    process.exit(1)
  }
}

testReport()
