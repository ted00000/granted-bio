import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = [
  'training',
  'infrastructure',
  'basic_research',
  'biotools',
  'therapeutics',
  'diagnostics',
  'medical_device',
  'digital_health',
  'other'
]

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

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

    const body = await request.json()
    const { category, confidence } = body

    // Validate category
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: 'Invalid category', validCategories: VALID_CATEGORIES },
        { status: 400 }
      )
    }

    // Validate confidence
    const confidenceNum = Number(confidence)
    if (isNaN(confidenceNum) || confidenceNum < 0 || confidenceNum > 100) {
      return NextResponse.json(
        { error: 'Confidence must be a number between 0 and 100' },
        { status: 400 }
      )
    }

    // Update project - id could be UUID, project_number, or application_id
    let updateResult

    // Try as application_id first (most common for this use case)
    const appId = parseInt(id)
    if (!isNaN(appId)) {
      updateResult = await supabaseAdmin
        .from('projects')
        .update({
          primary_category: category,
          primary_category_confidence: confidenceNum
        })
        .eq('application_id', appId)
        .select('application_id, project_number, primary_category, primary_category_confidence')
        .single()
    } else {
      // Try as UUID
      updateResult = await supabaseAdmin
        .from('projects')
        .update({
          primary_category: category,
          primary_category_confidence: confidenceNum
        })
        .eq('id', id)
        .select('application_id, project_number, primary_category, primary_category_confidence')
        .single()
    }

    if (updateResult.error) {
      console.error('Update error:', updateResult.error)
      return NextResponse.json(
        { error: 'Failed to update project', details: updateResult.error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      project: updateResult.data
    })
  } catch (error) {
    console.error('Category update error:', error)
    return NextResponse.json(
      { error: 'Failed to update category', details: String(error) },
      { status: 500 }
    )
  }
}
