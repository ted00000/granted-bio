import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SearchParams {
  query?: string
  category?: string
  minConfidence?: number
  maxConfidence?: number
  year?: number
  orgType?: string
  fundingMechanism?: string
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
  similarity?: number
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const params: SearchParams = {
      query: searchParams.get('q') || searchParams.get('query') || undefined,
      category: searchParams.get('category') || undefined,
      minConfidence: searchParams.get('minConfidence')
        ? parseInt(searchParams.get('minConfidence')!)
        : undefined,
      maxConfidence: searchParams.get('maxConfidence')
        ? parseInt(searchParams.get('maxConfidence')!)
        : undefined,
      year: searchParams.get('year')
        ? parseInt(searchParams.get('year')!)
        : undefined,
      orgType: searchParams.get('orgType') || undefined,
      fundingMechanism: searchParams.get('fundingMechanism') || undefined,
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
      pi_names
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
  if (params.category) {
    query = query.eq('primary_category', params.category)
  }

  if (params.minConfidence !== undefined) {
    query = query.gte('biotools_confidence', params.minConfidence)
  }

  if (params.maxConfidence !== undefined) {
    query = query.lte('biotools_confidence', params.maxConfidence)
  }

  if (params.year) {
    query = query.eq('fiscal_year', params.year)
  }

  if (params.orgType) {
    query = query.eq('org_type', params.orgType)
  }

  if (params.fundingMechanism) {
    query = query.ilike('funding_mechanism', `%${params.fundingMechanism}%`)
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
      category: body.category,
      minConfidence: body.minConfidence,
      maxConfidence: body.maxConfidence,
      year: body.year,
      orgType: body.orgType,
      fundingMechanism: body.fundingMechanism,
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
