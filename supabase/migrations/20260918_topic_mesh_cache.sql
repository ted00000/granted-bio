-- Cache for query-time MeSH descriptor extraction. Keyed on the
-- normalized topic string. Populated by src/lib/search/mesh-extraction.ts
-- on first request; served from cache on subsequent requests.
--
-- Motivation: MeSH extraction requires an LLM call (Haiku, ~$0.0001
-- per call). Report generation and Chat both benefit from the same
-- topic-to-MeSH mapping, so caching amortizes the cost.
--
-- Expiry: none in v0. MeSH descriptor stability is very high (NIH
-- adds ~50 new descriptors per year; existing descriptors almost
-- never move). Can add a TTL if we ever want to force refreshes.
--
-- Key is normalized to lowercase-collapsed-whitespace so casing
-- variance doesn't fragment the cache.

CREATE TABLE IF NOT EXISTS topic_mesh_cache (
  topic_normalized TEXT PRIMARY KEY,
  topic_raw TEXT NOT NULL,
  condition_mesh TEXT[] NOT NULL DEFAULT '{}',
  intervention_mesh TEXT[] NOT NULL DEFAULT '{}',
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Extractor version — bump when the prompt or model changes so a
  -- cache refresh becomes discoverable via `WHERE extractor_version < N`.
  extractor_version INT NOT NULL DEFAULT 1
);

COMMENT ON TABLE topic_mesh_cache IS
  'Cache for LLM-extracted MeSH descriptors keyed by topic string. Populated by src/lib/search/mesh-extraction.ts on first miss. Extraction cost is ~$0.0001 per uncached topic; cache amortizes across all callers (report generation, chat, search).';
