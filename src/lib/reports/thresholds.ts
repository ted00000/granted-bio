/**
 * Report inclusion + attribution thresholds.
 *
 * All thresholds are expressed as cosine similarity values (0.0 - 1.0)
 * against the topic embedding. Higher = stricter relevance.
 *
 * These are defined in one place so the audit doc can reference a single
 * source of truth for the numeric values, and so future tuning happens in
 * one location rather than scattered constants.
 */

/** Initial fetch ceiling — any candidate below this isn't even pulled from the index. */
export const SEMANTIC_FLOOR = 0.15

/** Broadest tier — used for "broadly related but not core" classification. */
export const THRESHOLD_BROAD = 0.20

/**
 * Population inclusion threshold for reports.
 *
 * Projects below this similarity are not shown in the Key Projects section,
 * not counted in project totals, and not credited in funding/category/org
 * aggregations. This is the report's de facto "topically relevant" line.
 */
export const THRESHOLD_BALANCED = 0.35

/** Highest-precision tier — projects above this are tagged "Precise" and weighted heavily. */
export const THRESHOLD_PRECISE = 0.50

/**
 * Threshold above which a project's funding is rolled into the report's
 * Total Committed Funding figure. Currently equal to THRESHOLD_BALANCED
 * (the report inclusion threshold) so funding attribution stays consistent
 * with project inclusion.
 *
 * Kept as a separate constant so it can be tuned independently in the
 * future — e.g., raised to THRESHOLD_PRECISE if a more conservative
 * attribution rule is preferred — without touching project-inclusion logic.
 *
 * Important: trials and patents discovered through cross-source lookup may
 * be linked to projects below this threshold (e.g., umbrella P30 cancer
 * center support grants). The connections appear in their respective
 * sections, but the umbrella grants' funding is not attributed to the topic.
 */
export const FUNDING_ATTRIBUTION_THRESHOLD = THRESHOLD_BALANCED

/**
 * Threshold for surfacing a clinical trial via direct semantic match against
 * its title (the trials-agent Path 2 lookup). Higher than the project
 * threshold because trial titles are short (10–15 tokens) — short-text
 * embeddings score higher on lexical overlap since there's less surrounding
 * context to dilute the signal, so the same nominal cosine value represents
 * a tighter conceptual match than it would on a 300-token abstract.
 *
 * This is a separate axis from FUNDING_ATTRIBUTION_THRESHOLD: clearing it
 * surfaces the trial in the Clinical Validation section, but the trial's
 * linked project still has to clear the project-abstract threshold for its
 * funding to roll into Total Committed Funding. Umbrella-grant exclusion
 * remains intact.
 */
export const TRIAL_INCLUSION_THRESHOLD = 0.45
