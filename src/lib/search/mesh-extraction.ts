// MeSH descriptor extraction from a free-text topic.
//
// Given a topic like "liquid biopsy for lung cancer", returns a small
// bag of MeSH descriptor terms the topic implies — split into
// condition-side and intervention-side buckets. Callers use these to
// augment semantic search (rank / boost / rescue-add trials whose
// condition_mesh or intervention_mesh overlap).
//
// Storage: topic_mesh_cache (see migration 20260918_topic_mesh_cache.sql).
// Extraction: Claude Haiku, structured tool_use output. Cost is
// ~$0.0001 per uncached call.
//
// Failure mode: on any error (Anthropic API, cache read/write,
// validation), returns empty arrays. Callers must treat the extraction
// as best-effort — reports and search should still work fine without
// MeSH augmentation.

import Anthropic from '@anthropic-ai/sdk'
import { SupabaseClient } from '@supabase/supabase-js'
import { generateStructured } from '@/lib/reports/llm-json'

const CURRENT_EXTRACTOR_VERSION = 1

export interface TopicMesh {
  condition_mesh: string[]
  intervention_mesh: string[]
}

const EMPTY: TopicMesh = { condition_mesh: [], intervention_mesh: [] }

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Read the cache. Returns null on miss or if the cached row was
 * populated by an older extractor version (forces re-extraction).
 */
async function readCache(
  supabase: SupabaseClient,
  topicNormalized: string,
): Promise<TopicMesh | null> {
  try {
    const { data } = await supabase
      .from('topic_mesh_cache')
      .select('condition_mesh, intervention_mesh, extractor_version')
      .eq('topic_normalized', topicNormalized)
      .maybeSingle()
    if (!data) return null
    // Type assertion — Supabase generated types haven't been regenerated
    // to include this table yet; the SELECT above is authoritative.
    const row = data as unknown as {
      condition_mesh: string[]
      intervention_mesh: string[]
      extractor_version: number
    }
    if (row.extractor_version < CURRENT_EXTRACTOR_VERSION) return null
    return {
      condition_mesh: row.condition_mesh ?? [],
      intervention_mesh: row.intervention_mesh ?? [],
    }
  } catch {
    return null
  }
}

async function writeCache(
  supabase: SupabaseClient,
  topicNormalized: string,
  topicRaw: string,
  mesh: TopicMesh,
): Promise<void> {
  try {
    await supabase
      .from('topic_mesh_cache')
      .upsert(
        {
          topic_normalized: topicNormalized,
          topic_raw: topicRaw,
          condition_mesh: mesh.condition_mesh,
          intervention_mesh: mesh.intervention_mesh,
          extractor_version: CURRENT_EXTRACTOR_VERSION,
        },
        { onConflict: 'topic_normalized' },
      )
  } catch {
    // Cache write failure is not fatal — the caller still has the
    // extracted data. Log and swallow.
    console.warn('[mesh-extraction] cache write failed for topic:', topicRaw)
  }
}

/**
 * Extract MeSH descriptors from a topic. Cache-through by design.
 * Callers only see the mesh — cache lifecycle is internal.
 */
export async function extractTopicMesh(
  topic: string,
  supabase: SupabaseClient,
  anthropic: Anthropic,
): Promise<TopicMesh> {
  if (!topic || !topic.trim()) return EMPTY
  const normalized = normalizeTopic(topic)

  // 1. Cache hit → return immediately.
  const cached = await readCache(supabase, normalized)
  if (cached) return cached

  // 2. Miss → extract via Haiku. Constrained schema means the model
  // has to return the arrays it saw as most relevant, not a paragraph
  // to parse.
  const schema = {
    type: 'object' as const,
    properties: {
      condition_mesh: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Up to 6 MeSH descriptor terms for the CONDITIONS this topic is about. Use canonical MeSH descriptor names (e.g. "Lung Neoplasms", "Diabetes Mellitus, Type 2"). Prefer specific-then-broader ordering. Return an empty array if the topic is not condition-oriented.',
        maxItems: 6,
      },
      intervention_mesh: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Up to 6 MeSH descriptor terms for the INTERVENTIONS or methodological approaches this topic implies. Canonical MeSH names (e.g. "Pembrolizumab", "Immunotherapy", "Positron-Emission Tomography"). Return an empty array if the topic doesn\'t imply a specific intervention.',
        maxItems: 6,
      },
    },
    required: ['condition_mesh', 'intervention_mesh'],
  }

  const result = await generateStructured<TopicMesh>({
    client: anthropic,
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 400,
    toolName: 'return_mesh_terms',
    toolDescription:
      'Return the MeSH descriptor terms implied by a research topic. Used to augment semantic search on ClinicalTrials.gov MeSH-tagged trials and PubMed MeSH-tagged publications.',
    schema,
    prompt: `Given the research topic below, return the most relevant MeSH (Medical Subject Headings) descriptor terms.

Rules:
- Use CANONICAL MeSH descriptor names as they appear in the NIH controlled vocabulary. Examples: "Neoplasms" (not "cancer"), "Diabetes Mellitus, Type 2" (not "T2D"), "Coronavirus Infections" (not "COVID").
- Return at most 6 terms per category.
- Prefer specific-then-broader ordering (specific first, more general last).
- If the topic is not condition-oriented (e.g. "gene editing methodology"), return an empty condition_mesh array.
- If the topic doesn't imply a specific intervention (e.g. "aging biology"), return an empty intervention_mesh array.
- Do NOT include obvious non-MeSH terms.

Topic: ${topic}`,
  })

  const mesh: TopicMesh = {
    condition_mesh: (result?.condition_mesh ?? []).filter(
      (t) => typeof t === 'string' && t.trim().length > 0,
    ),
    intervention_mesh: (result?.intervention_mesh ?? []).filter(
      (t) => typeof t === 'string' && t.trim().length > 0,
    ),
  }

  // 3. Cache the result — fire-and-forget for the caller.
  void writeCache(supabase, normalized, topic, mesh)

  return mesh
}
