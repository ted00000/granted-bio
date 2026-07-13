/**
 * Canonical ban catalog — single source of truth for token/phrase patterns
 * the linter will flag. Injected into generator prompts so the LLM knows
 * what the linter checks; the linter can then run mostly as a safety net
 * rather than the primary correction mechanism.
 *
 * Design principle: EVERY string in this file is either:
 *   (a) referenced by a specific linter rule, or
 *   (b) injected into a generator prompt.
 * Adding a new rule should mean adding entries here, not sprinkling
 * strings across prompt bodies. r49 audit showed drift between rule
 * patterns and prompt ban lists as the primary source of surviving
 * critical violations.
 *
 * The exports are chunks of markdown that get concatenated into prompt
 * bodies. Keep them concise — every prompt has a max_tokens ceiling.
 */

// ---------------------------------------------------------------------------
// Universal bans — apply to ALL narrative fields regardless of section.
// ---------------------------------------------------------------------------

export const UNIVERSAL_BAN_BLOCK = `**UNIVERSAL BANS** (linter enforces; violations fail the report):

- **AI-tell phrases**: "inflection point", "step-change", "poised to", "underscores"/"underscoring", "landscape reveals", "perhaps most critically", "genuine [noun]" (any construction where "genuine" modifies a claim-noun — "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation"). Say what the thing IS, not that it's "genuine".
- **Em dashes (—)**: Use hyphens (-) or rewrite the sentence.
- **"structural [noun]" applied to the field**: "structural competitive risks", "structural risk", "structural shift", "structural change", "structurally invisible", "structurally underfunded". Rewrite without "structural" — the modifier implies a permanent systemic property a sample can't support.
- **Sample-share-to-structural inference**: A low sample percentage cannot claim "limited investigation", "underfunded", "structural [gap]", or "the field is X". Rewrite as observation-in-sample: "within the analyzed sample, X is sparse" or "represents a low share of sample projects".
- **Sample-gap-may-constrain**: A sample-observed gap cannot cause field-level limitations. "That mechanistic gap may constrain sensitivity improvements" — banned. The "may" hedge doesn't fix this.
- **Forward-tense absolutes**: "will pressure/force/drive/require/shift/increase/accelerate" as bare future statements. Hedge or drop.
- **Field-level "clear gap"**: "clear gap", "clear methodological gap", "clear point-of-care gap", "a clear gap exists" — banned as field-level absolutes.`

// ---------------------------------------------------------------------------
// Two-point trend hedge — required when citing two FY dollar figures.
// ---------------------------------------------------------------------------

export const TWO_POINT_TREND_HEDGE_BLOCK = `**TWO-POINT TREND HEDGE — REQUIRED, not optional.** If you cite two consecutive FY dollar figures side-by-side (e.g. "FY2024 $X and FY2025 $Y", "rose from $Xm to $Ym"), you MUST append the hedge "though two data points do not establish a trend" (or equivalent — "two-point trend", "two consecutive years") in the SAME sentence or immediately after. Do NOT write "suggests growing NIH commitment", "signals sustained growth", "reflects momentum", "accelerating investment", "sustained and growing" — those are trend verbs and 2 data points cannot support them. This is a linter-enforced factual constraint, not narrative flourish. Applies to every narrative field: Exec Summary, Field Maturity, NIH Funding Landscape, Signals, Next Steps.`

// ---------------------------------------------------------------------------
// Category attribution — required when citing sample-total figures near a
// category name.
// ---------------------------------------------------------------------------

export function categoryAttributionBlock(totalProjects: number, totalFundingM: number): string {
  return `**CATEGORY ATTRIBUTION — REQUIRED FORM.** When you cite a funding category (diagnostics, biotools, therapeutics, basic_research, etc.) in the SAME sentence as a sample-total figure ($${totalFundingM.toFixed(1)}M or ${totalProjects} projects), you MUST attach the category's own count in "(N of ${totalProjects})" or "N%" form directly to the category. WRONG: "$${totalFundingM.toFixed(1)}M across ${totalProjects} projects, concentrated in diagnostics" — banned. "concentration of NIH funding in diagnostics ($${totalFundingM.toFixed(1)}M across ${totalProjects} projects)" — banned. RIGHT: "diagnostics account for 60.2% of projects (74 of ${totalProjects})" or "the diagnostics funding category (74 of ${totalProjects}, 60.2%) dominates the sample". The linter enforces this — sentences that cite sample totals alongside a category name without subset attribution trigger critical no-sample-total-as-category violations.`
}

// ---------------------------------------------------------------------------
// IP shape/breadth ban — active when patents < 10.
// ---------------------------------------------------------------------------

export function ipShapeBanBlock(totalPatents: number): string {
  if (totalPatents >= 10) return ''
  return `**IP SHAPE/BREADTH BAN — ${totalPatents} linked patents (< 10 threshold).** When patents are below 10, ALL of these are forbidden anywhere in narrative, freedomToOperate, strategicImplications, and any IP-context sentence in Next Steps or Research Positioning:

- **Shape/concentration words**: "fragmented", "concentrated", "moderately concentrated", "highly concentrated", "consolidated", "consolidat" (as any variant), "converged", "converging", "cluster around", "clustered", "clustering", "distributed across", "spread across", "held across ... rather than", "diverse landscape", "wide range of".
- **Breadth/convergence claims**: "rather than converging", "converge around", "wide range of", "diverse methods", "breadth of approaches", "multiple independent approaches rather than", "pursued across multiple", "diverse but institutionally".
- **Phrasal verbs**: "concentrate on" / "concentrates on" / "concentrating on" (use "cover", "focus on", "center on", "address" instead).
- **Percentages on the ${totalPatents}-patent base**: "63% academic", "25% held by top assignee" — a percentage on N=${totalPatents} is not a meaningful distribution claim. Cite raw counts ("6 of ${totalPatents} are academic"), never percentages.

Sonnet's failure mode when correcting: swapping one banned word for another from the same family. The rules above ban the entire family, not just the specific tokens the linter caught.

Replacements: describe the sample as a factual enumeration ("the ${totalPatents} linked patents span N assignees across the following technical areas: [list]") or use neutral verbs ("cover", "address", "span"). NO breadth interpretation, NO distribution shape, NO clustering claim.`
}

// ---------------------------------------------------------------------------
// Hub/entry-point ban — inst names + "hub"/"entry point"/"on-ramp".
// ---------------------------------------------------------------------------

export const HUB_ENTRY_POINT_BAN_BLOCK = `**HUB/ENTRY-POINT FRAMING BAN.** Do NOT pair an institution name (MGH, Broad Institute, Johns Hopkins, Cornell, MIT, UCLA, UCSF, Stanford, Yale, Duke, Penn, Columbia, Fred Hutch, Dana-Farber, MSKCC, Sloan Kettering, City of Hope, Baylor, Vanderbilt, Weill, Beckman, Pittsburgh) with framing words ("hub", "entry point", "access node", "resource node", "gateway", "on-ramp", "portal") within 60 chars. This applies to describing institutions AND to describing grant mechanisms adjacent to institutions. WRONG: "MGH functions as a methodologically diverse hub". WRONG: "the R21 exploratory mechanism may be the appropriate on-ramp at [institution]". Rewrite as factual concentration: "MGH has the largest cluster of methodologically diverse projects in the sample". Exception: the term "CTSA hub" is factual (NIH's Clinical and Translational Science Awards program uses this label officially).`

// ---------------------------------------------------------------------------
// Named-product two-sided requirement.
// ---------------------------------------------------------------------------

export const NAMED_PRODUCT_SYMMETRY_BLOCK = `**NAMED-PRODUCT SYMMETRY.** If you mention any named clinical product (DELFI, Galleri, NHS-Galleri, PATHFINDER, PATHFINDER 2, Shield, Guardant Shield, Signatera, MRDetect, Cologuard, EFIRM, Vanguard, Freenome, GRAIL, GRAIL Galleri), you MUST either:
(a) restrict the mention to a purely factual description (what the product IS, what analyte it uses) with NO positive framing — no "approved", "breakthrough", "leading", "validated", "state-of-the-art", "first-in-class", "well-timed"; OR
(b) cite BOTH a positive fact AND a specificity/PPV/coverage/reimbursement/endpoint-miss concern within the same clause or sentence.
WRONG: "aligning with the evidentiary bar informed by PATHFINDER 2" — positive without counter-balance.
WRONG: "the FDA approved Shield as the first blood-based CRC screen" (no acknowledgment).
RIGHT: "the FDA approved Shield in 2024, though its label notes limited Stage I CRC sensitivity and low precancerous lesion detection".
RIGHT: "Shield uses methylation analysis to detect colorectal cancer" (factual only, no positive framing).`

// ---------------------------------------------------------------------------
// Trial status enumeration — compact form strongly preferred.
// ---------------------------------------------------------------------------

export function trialStatusEnumerationBlock(totalTrials: number): string {
  if (totalTrials < 5) return ''
  return `**TRIAL STATUS ENUMERATION — USE COMPACT FORM.** When citing trial statuses across the sample, STRONGLY PREFER the compact form: "N in progress, planned, or completed vs M terminated/suspended/withdrawn (${totalTrials} total)". This form always sums correctly and is unambiguous. WRONG: "10 terminated and 2 suspended trials in the sample are a substantive signal" — leaves ${totalTrials - 12} of ${totalTrials} unattributed and trips the linter. If you MUST itemize, include EVERY non-zero status (Recruiting, Active-not-recruiting, Enrolling-by-invitation, Completed, Not-yet-recruiting, Terminated, Suspended, Withdrawn) with counts summing exactly to ${totalTrials}. Alternative: describe the terminated/suspended signal qualitatively WITHOUT numeric enumeration.`
}

// ---------------------------------------------------------------------------
// PI callout ban — no PI names/possessives in narrative fields.
// ---------------------------------------------------------------------------

export const PI_CALLOUT_BAN_BLOCK = `**NO PI NAMES OR POSSESSIVES IN NARRATIVE.** Do NOT write "PI Smith at UCLA", "Dr. Chen's group", "Velculescu's DELFI work", "the Zhou lab", or any construction that names an individual researcher. PIs appear in structured tables (Key Researchers, project cards); narrative fields stay at pattern level so no individual is singled out.`

// ---------------------------------------------------------------------------
// Prescriptive-toward-named-orgs ban.
// ---------------------------------------------------------------------------

export const PRESCRIPTIVE_ORG_BAN_BLOCK = `**NO PRESCRIPTIVE ACTION ANCHORED TO NAMED INSTITUTIONS.** Naming institutions in factual descriptions is fine ("2 patents at Johns Hopkins"). Naming institutions as action anchors is NOT fine ("engage Johns Hopkins for licensing", "align with the UConn node", "a practical first step is engaging the JHU and UConn patents"). Rewrite as method-anchored: "a practical first step is claim-level prior-art review of the specific technical methods present" — name the methods, not the assignees. Same rule applies to "starting point", "first step", "diligence anchor", "prior-art starting point" paired with institution names.`
