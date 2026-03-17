/**
 * Classify a project using Claude Haiku API
 *
 * Analyzes project data and returns:
 * - primary_category (life science area)
 * - category_confidence (0-100)
 * - org_type (organization type)
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface ProjectData {
  title: string
  org_name?: string
  abstract?: string
  phr?: string
  terms?: string
  activity_code?: string
}

export interface ClassificationResult {
  primary_category: 'training' | 'infrastructure' | 'basic_research' | 'biotools' | 'therapeutics' | 'diagnostics' | 'medical_device' | 'digital_health' | 'other'
  category_confidence: number
  org_type: 'company' | 'university' | 'hospital' | 'research_institute' | 'other'
}

/**
 * Deterministic org type classification based on keyword patterns.
 * Returns the org_type if a clear match is found, or null to let LLM decide.
 *
 * Priority order:
 * 1. University keywords (highest - "University of X, Inc" is still a university)
 * 2. Hospital keywords
 * 3. Research institute keywords
 * 4. Company indicators (lowest - only if no institution keywords)
 */
export function classifyOrgType(orgName: string | undefined, activityCode: string | undefined): ClassificationResult['org_type'] | null {
  if (!orgName) return null

  const org = orgName.toUpperCase()
  const code = (activityCode || '').toUpperCase()

  // University patterns (highest priority)
  // Match "UNIVERSITY", "UNIV", "COLLEGE" - these are always academic
  if (
    org.includes('UNIVERSITY') ||
    org.includes(' UNIV ') ||
    org.includes(' UNIV,') ||
    org.startsWith('UNIV ') ||
    org.endsWith(' UNIV') ||
    org.includes('COLLEGE')
  ) {
    return 'university'
  }

  // Hospital/Medical Center patterns
  // Match various hospital and medical center terms
  if (
    org.includes('HOSPITAL') ||
    org.includes('MEDICAL CENTER') ||
    org.includes('MEDICAL CTR') ||
    org.includes('MED CTR') ||
    org.includes('HEALTH SYSTEM') ||
    org.includes('CHILDREN\'S HOSPITAL') ||
    org.includes('CHILDRENS HOSPITAL')
  ) {
    return 'hospital'
  }

  // Research Institute patterns
  // Match "INSTITUTE" or "INST" but not when part of university name
  if (
    org.includes('INSTITUTE') ||
    org.includes(' INST ') ||
    org.includes(' INST,') ||
    org.endsWith(' INST')
  ) {
    return 'research_institute'
  }

  // Company indicators (lowest priority - only apply if no institution keywords matched)
  // SBIR/STTR activity codes are always commercial
  if (code.startsWith('R41') || code.startsWith('R42') || code.startsWith('R43') || code.startsWith('R44') ||
      code.startsWith('SB1') || code.startsWith('U43') || code.startsWith('U44')) {
    return 'company'
  }

  // Corporate suffixes typically indicate companies
  // But only if no institution keywords were matched above
  if (
    org.endsWith(' INC') ||
    org.endsWith(' INC.') ||
    org.endsWith(', INC') ||
    org.endsWith(', INC.') ||
    org.endsWith(' LLC') ||
    org.endsWith(', LLC') ||
    org.endsWith(' CORP') ||
    org.endsWith(' CORP.') ||
    org.endsWith(', CORP') ||
    org.endsWith(' LTD') ||
    org.endsWith(' LTD.')
  ) {
    return 'company'
  }

  // No clear pattern - let LLM decide
  return null
}

const CLASSIFICATION_PROMPT = `Analyze this NIH grant and classify it. Return only valid JSON, no other text.

Project Data:
Title: {title}
Organization: {org_name}
Abstract: {abstract}
Public Health Relevance: {phr}
Keywords: {terms}
Activity Code: {activity_code}

Return JSON in this exact format:
{
  "primary_category": "training|infrastructure|basic_research|biotools|therapeutics|diagnostics|medical_device|digital_health|other",
  "category_confidence": 0-100,
  "org_type": "company|university|hospital|research_institute|other"
}

## ACTIVITY CODE PRE-FILTER (Check FIRST!)

Always → training: T32, T34, T35, T90, TL1, TL4, F30-F33, F99, K01-K99 series, D43, D71, R25, R90
Always → infrastructure: P30, P50, P51, S10, G20, U13, R13, U24, U2C

## THE 9 CATEGORIES

1. training - Programs for training/education/career development of researchers
2. infrastructure - Core facilities, centers, equipment, coordination grants, reference atlases, databases, biobanks, consortium data resources (HuBMAP, Human Cell Atlas, ENCODE)
3. basic_research - Understanding biology/mechanisms WITHOUT a tool/drug/diagnostic. OUTPUT = knowledge. Includes tissue mapping, cell atlas creation, characterization studies
4. biotools - DEVELOPING research tools, assays, platforms, methods. OUTPUT = tool for researchers
5. therapeutics - DEVELOPING drugs/treatments for patients. OUTPUT = therapy. NOT behavioral interventions
6. diagnostics - DEVELOPING clinical tests for disease detection. OUTPUT = diagnostic test
7. medical_device - DEVELOPING physical devices for patient treatment. Must be MEDICAL
8. digital_health - CLINICAL software for PATIENT care only. Telemedicine, EHR tools, patient-facing apps. NOT research data visualization or scientific databases
9. other - Health services, behavioral interventions, epidemiology, non-biomedical research

## CRITICAL DISTINCTIONS

Tool development vs Tool application:
- "Developing a CRISPR screening platform" → biotools
- "Using CRISPR to study gene function" → basic_research
- "Using CRISPR to treat sickle cell" → therapeutics

Research tools vs Clinical software:
- "Data visualization for researchers" → biotools (research use)
- "Cell analysis platform for labs" → biotools (research use)
- "Telemedicine app for patients" → digital_health (clinical use)
- "EHR integration tool for doctors" → digital_health (clinical use)

SBIR/STTR (R41-R44, SB1) commercialization projects:
- Usually biotools (research instruments/platforms) or therapeutics (drugs/treatments)
- Rarely digital_health unless explicitly clinical/patient-facing

Organization Type Definitions:
- company: Commercial entities (Inc., LLC, SBIR/STTR)
- university: Academic institutions
- hospital: Medical centers, health systems
- research_institute: Independent research organizations (Broad, Scripps)
- other: Government agencies, non-profits`

export async function classifyProject(project: ProjectData): Promise<ClassificationResult> {
  // Pre-classify org type deterministically based on keywords
  // This catches obvious cases like "UNIVERSITY OF X" that the LLM sometimes misses
  const deterministicOrgType = classifyOrgType(project.org_name, project.activity_code)

  // Build prompt with project data
  const prompt = CLASSIFICATION_PROMPT
    .replace('{title}', project.title || 'N/A')
    .replace('{org_name}', project.org_name || 'N/A')
    .replace('{abstract}', project.abstract || 'N/A')
    .replace('{phr}', project.phr || 'N/A')
    .replace('{terms}', project.terms || 'N/A')
    .replace('{activity_code}', project.activity_code || 'N/A')

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    // Extract text content from response
    const textContent = message.content.find((block) => block.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response')
    }

    // Parse JSON response
    const text = textContent.text.trim()

    // Handle potential markdown code blocks
    let jsonText = text
    if (text.startsWith('```json')) {
      jsonText = text.replace(/```json\n?/, '').replace(/\n?```$/, '')
    } else if (text.startsWith('```')) {
      jsonText = text.replace(/```\n?/, '').replace(/\n?```$/, '')
    }

    const result = JSON.parse(jsonText) as ClassificationResult

    // Validate the result
    const validCategories = ['training', 'infrastructure', 'basic_research', 'biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']
    const validOrgTypes = ['company', 'university', 'hospital', 'research_institute', 'other']

    if (!validCategories.includes(result.primary_category)) {
      console.warn(`Invalid category: ${result.primary_category}, defaulting to 'other'`)
      result.primary_category = 'other'
    }

    if (!validOrgTypes.includes(result.org_type)) {
      console.warn(`Invalid org_type: ${result.org_type}, defaulting to 'other'`)
      result.org_type = 'other'
    }

    // Override LLM org_type with deterministic classification if we found a clear match
    // This ensures obvious cases like "UNIVERSITY OF MICHIGAN" are never misclassified
    if (deterministicOrgType) {
      result.org_type = deterministicOrgType
    }

    // Ensure confidence is in range
    result.category_confidence = Math.max(0, Math.min(100, result.category_confidence))

    return result
  } catch (error) {
    console.error('Classification error:', error)

    // Return default classification on error
    return {
      primary_category: 'other',
      category_confidence: 0,
      org_type: deterministicOrgType || 'other',
    }
  }
}
