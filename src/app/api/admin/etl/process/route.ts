import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { jobId } = await request.json()

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 })
    }

    // Get job details
    const { data: job, error: jobError } = await supabaseAdmin
      .from('etl_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Update job to running
    await supabaseAdmin
      .from('etl_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', jobId)

    // For now, this just marks the job as started
    // In production, this would trigger a background worker (e.g., on Digital Ocean)
    // The actual ETL processing is handled by the Python scripts in /etl

    // For demonstration, we'll just mark it as pending for external processing
    // In a real setup, you would:
    // 1. Send a webhook to Digital Ocean to start the ETL
    // 2. Or use a queue system like Redis/BullMQ
    // 3. Or call a serverless function

    return NextResponse.json({
      success: true,
      message: 'ETL job started',
      jobId: job.id,
      status: 'running',
      note: 'In production, this would trigger the Python ETL scripts on Digital Ocean',
    })
  } catch (error) {
    console.error('ETL process error:', error)
    return NextResponse.json(
      { error: 'Failed to start ETL process', details: String(error) },
      { status: 500 }
    )
  }
}

// GET endpoint to check job status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 })
    }

    const { data: job, error } = await supabaseAdmin
      .from('etl_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ job })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get job status', details: String(error) },
      { status: 500 }
    )
  }
}
