import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SearchParams {
  query?: string
  categories?: string[]
  minConfidence?: number
  maxConfidence?: number
  years?: number[]
  orgTypes?: string[]
  fundingMechanisms?: string[]
  supplements?: 'all' | 'base' | 'supplements'
  page?: number
  limit?: number
  useVector?: boolean
}

interface SearchResult {
  id: string
  application_id: string
  project_number: string
  title: string
  phr: string | null
  org_name: string | null
  org_type: string | null
  org_city: string | null
  org_state: string | null
  total_cost: number | null
  fiscal_year: number | null
  funding_mechanism: string | null
  primary_category: string | null
  biotools_confidence: number | null
  biotools_reasoning: string | null
  pi_names: string | null
  is_supplement: boolean | null
  supplement_number: string | null
  similarity?: number
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const params: SearchParams = {
      query: searchParams.get('q') || searchParams.get('query') || undefined,
      categories: searchParams.get('categories')?.split(',').filter(Boolean) || undefined,
      minConfidence: searchParams.get('minConfidence')
        ? parseInt(searchParams.get('minConfidence')!)
        : undefined,
      maxConfidence: searchParams.get('maxConfidence')
        ? parseInt(searchParams.get('maxConfidence')!)
        : undefined,
      years: searchParams.get('years')?.split(',').map(y => parseInt(y)).filter(Boolean) || undefined,
      orgTypes: searchParams.get('orgTypes')?.split(',').filter(Boolean) || undefined,
      fundingMechanisms: searchParams.get('fundingMechanisms')?.split(',').filter(Boolean) || undefined,
      supplements: (searchParams.get('supplements') as 'all' | 'base' | 'supplements') || undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: Math.min(parseInt(searchParams.get('limit') || '20'), 100),
      useVector: searchParams.get('useVector') === 'true',
    }

    const offset = ((params.page || 1) - 1) * (params.limit || 20)

    // If query provided and vector search enabled, use vector similarity
    if (params.query && params.useVector) {
      return await vectorSearch(params)
    }

    // Otherwise use standard search with filters
    return await standardSearch(params, offset)
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    )
  }
}

async function standardSearch(params: SearchParams, offset: number) {
  let query = supabaseAdmin
    .from('projects')
    .select(
      `
      id,
      application_id,
      project_number,
      title,
      phr,
      org_name,
      org_type,
      org_city,
      org_state,
      total_cost,
      fiscal_year,
      funding_mechanism,
      primary_category,
      biotools_confidence,
      biotools_reasoning,
      pi_names,
      is_supplement,
      supplement_number
    `,
      { count: 'exact' }
    )
    .eq('is_bio_related', true)

  // Text search on title
  if (params.query) {
    // Use ilike for simple text matching
    query = query.or(
      `title.ilike.%${params.query}%,org_name.ilike.%${params.query}%,terms.ilike.%${params.query}%`
    )
  }

  // Apply filters
  if (params.categories && params.categories.length > 0) {
    query = query.in('primary_category', params.categories)
  }

  if (params.minConfidence !== undefined) {
    query = query.gte('biotools_confidence', params.minConfidence)
  }

  if (params.maxConfidence !== undefined) {
    query = query.lte('biotools_confidence', params.maxConfidence)
  }

  if (params.years && params.years.length > 0) {
    query = query.in('fiscal_year', params.years)
  }

  if (params.orgTypes && params.orgTypes.length > 0) {
    query = query.in('org_type', params.orgTypes)
  }

  if (params.fundingMechanisms && params.fundingMechanisms.length > 0) {
    // For funding mechanisms, we need to check if any of them are in the funding_mechanism field
    const orConditions = params.fundingMechanisms.map(fm => `funding_mechanism.ilike.%${fm}%`).join(',')
    query = query.or(orConditions)
  }

  if (params.supplements) {
    if (params.supplements === 'base') {
      query = query.eq('is_supplement', false)
    } else if (params.supplements === 'supplements') {
      query = query.eq('is_supplement', true)
    }
    // 'all' means no filter
  }

  // Order by confidence descending
  query = query
    .order('biotools_confidence', { ascending: false, nullsFirst: false })
    .range(offset, offset + (params.limit || 20) - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('Supabase error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    results: data as SearchResult[],
    total: count || 0,
    page: params.page || 1,
    limit: params.limit || 20,
    totalPages: Math.ceil((count || 0) / (params.limit || 20)),
  })
}

async function vectorSearch(params: SearchParams) {
  if (!params.query) {
    return NextResponse.json({ error: 'Query required for vector search' }, { status: 400 })
  }

  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(params.query)

    // Call the search_projects function defined in the database
    const { data, error } = await supabaseAdmin.rpc('search_projects', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: params.limit || 50,
      min_biotools_confidence: params.minConfidence || 0,
    })

    if (error) {
      console.error('Vector search error:', error)
      // Fall back to standard search
      return await standardSearch(params, 0)
    }

    return NextResponse.json({
      results: data,
      total: data?.length || 0,
      page: 1,
      limit: params.limit || 50,
      totalPages: 1,
      searchType: 'vector',
    })
  } catch (error) {
    console.error('Embedding generation error:', error)
    // Fall back to standard search
    return await standardSearch(params, 0)
  }
}

// POST endpoint for advanced search with body
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const params: SearchParams = {
      query: body.query,
      categories: body.categories,
      minConfidence: body.minConfidence,
      maxConfidence: body.maxConfidence,
      years: body.years,
      orgTypes: body.orgTypes,
      fundingMechanisms: body.fundingMechanisms,
      supplements: body.supplements,
      page: body.page || 1,
      limit: Math.min(body.limit || 20, 100),
      useVector: body.useVector || false,
    }

    const offset = ((params.page || 1) - 1) * (params.limit || 20)

    if (params.query && params.useVector) {
      return await vectorSearch(params)
    }

    return await standardSearch(params, offset)
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    )
  }
}
