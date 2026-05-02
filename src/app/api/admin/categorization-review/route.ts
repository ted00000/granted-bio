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
] as const

const VALID_REASON_CODES = [
  'activity_code_misleading',
  'abstract_describes_development',
  'narrow_scope',
  'other'
] as const

// Boundary presets: each defines a SQL filter for surfacing likely borderline cases
const BOUNDARIES = {
  biotools_infrastructure: {
    label: 'Biotools ↔ Infrastructure',
    category: 'infrastructure',
    activity_codes: ['P41', 'P30', 'P50']
  },
  diagnostics_digital_health: {
    label: 'Diagnostics ↔ Digital Health',
    category: 'digital_health',
    activity_codes: null
  },
  basic_research_biotools: {
    label: 'Basic Research ↔ Biotools',
    category: 'biotools',
    activity_codes: null
  }
} as const

type BoundaryKey = keyof typeof BOUNDARIES

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401, userId: null }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { error: 'Admin access required', status: 403, userId: null }
  }
  return { error: null, status: 200, userId: user.id }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const boundary = (searchParams.get('boundary') || 'biotools_infrastructure') as BoundaryKey
  const confidenceMax = Number(searchParams.get('confidence_max') || '80')
  const limit = Math.min(Number(searchParams.get('limit') || '20'), 100)
  const offset = Number(searchParams.get('offset') || '0')

  const preset = BOUNDARIES[boundary]
  if (!preset) {
    return NextResponse.json(
      { error: 'Invalid boundary', validBoundaries: Object.keys(BOUNDARIES) },
      { status: 400 }
    )
  }

  // Get list of already-reviewed application_ids to exclude
  const { data: reviewed } = await supabaseAdmin
    .from('category_corrections')
    .select('application_id')

  const reviewedIds = new Set((reviewed || []).map(r => r.application_id))

  // Build base query — projects matching the borderline criteria
  let query = supabaseAdmin
    .from('projects')
    .select(
      'application_id, project_number, activity_code, title, org_name, primary_category, primary_category_confidence, fy',
      { count: 'exact' }
    )
    .eq('primary_category', preset.category)

  if (preset.activity_codes) {
    query = query.in('activity_code', preset.activity_codes)
  }

  // Confidence filter — null confidence is treated as "uncertain enough" too
  query = query.or(`primary_category_confidence.lt.${confidenceMax},primary_category_confidence.is.null`)

  // Order by lowest confidence first (most uncertain first)
  query = query.order('primary_category_confidence', { ascending: true, nullsFirst: false })

  // Page through with extra slack to allow filtering out reviewed items client-side
  const { data: projects, error, count } = await query.range(offset, offset + limit * 3 - 1)

  if (error) {
    console.error('Review queue query error:', error)
    return NextResponse.json({ error: 'Failed to fetch queue', details: error.message }, { status: 500 })
  }

  // Filter out already-reviewed in-memory (cleaner than a NOT IN with potentially large list)
  const unreviewed = (projects || []).filter(p => !reviewedIds.has(p.application_id)).slice(0, limit)

  // Fetch abstracts for the visible page only (avoids pulling abstracts for reviewed items)
  const appIds = unreviewed.map(p => p.application_id)
  const { data: abstracts } = appIds.length > 0
    ? await supabaseAdmin
        .from('abstracts')
        .select('application_id, abstract_text')
        .in('application_id', appIds)
    : { data: [] }

  const abstractMap = new Map((abstracts || []).map(a => [a.application_id, a.abstract_text]))

  const enriched = unreviewed.map(p => ({
    ...p,
    abstract: abstractMap.get(p.application_id) || null
  }))

  return NextResponse.json({
    boundary,
    boundary_label: preset.label,
    confidence_max: confidenceMax,
    total_matching: count || 0,
    reviewed_count: reviewedIds.size,
    items: enriched,
    boundaries: Object.entries(BOUNDARIES).map(([key, val]) => ({ key, label: val.label }))
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error || !auth.userId) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  const { application_id, corrected_category, reason_code, notes } = body

  if (!application_id || typeof application_id !== 'string') {
    return NextResponse.json({ error: 'application_id required' }, { status: 400 })
  }

  if (!corrected_category || !VALID_CATEGORIES.includes(corrected_category)) {
    return NextResponse.json(
      { error: 'Invalid corrected_category', validCategories: VALID_CATEGORIES },
      { status: 400 }
    )
  }

  if (reason_code && !VALID_REASON_CODES.includes(reason_code)) {
    return NextResponse.json(
      { error: 'Invalid reason_code', validReasonCodes: VALID_REASON_CODES },
      { status: 400 }
    )
  }

  // Get the original prediction to snapshot
  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('application_id, primary_category, primary_category_confidence')
    .eq('application_id', application_id)
    .single()

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Upsert correction (one correction per project — latest wins)
  const { error: correctionError } = await supabaseAdmin
    .from('category_corrections')
    .upsert(
      {
        application_id,
        original_category: project.primary_category,
        original_confidence: project.primary_category_confidence,
        corrected_category,
        reason_code: reason_code || null,
        notes: notes || null,
        reviewed_by: auth.userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      { onConflict: 'application_id' }
    )

  if (correctionError) {
    console.error('Correction insert error:', correctionError)
    return NextResponse.json(
      { error: 'Failed to record correction', details: correctionError.message },
      { status: 500 }
    )
  }

  // Update the project's category if it changed
  if (corrected_category !== project.primary_category) {
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        primary_category: corrected_category,
        primary_category_confidence: 100  // human-verified = max confidence
      })
      .eq('application_id', application_id)

    if (updateError) {
      console.error('Project category update error:', updateError)
      return NextResponse.json(
        { error: 'Correction saved but project update failed', details: updateError.message },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ success: true })
}
