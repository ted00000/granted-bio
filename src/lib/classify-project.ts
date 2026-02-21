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
2. infrastructure - Core facilities, centers, equipment, coordination grants
3. basic_research - Understanding biology/mechanisms WITHOUT a tool/drug/diagnostic. OUTPUT = knowledge
4. biotools - DEVELOPING research tools, assays, platforms, methods. OUTPUT = tool for researchers
5. therapeutics - DEVELOPING drugs/treatments for patients. OUTPUT = therapy. NOT behavioral interventions
6. diagnostics - DEVELOPING clinical tests for disease detection. OUTPUT = diagnostic test
7. medical_device - DEVELOPING physical devices for patient treatment. Must be MEDICAL
8. digital_health - DEPLOYING software/apps for patient care. Telemedicine, clinical decision support
9. other - Health services, behavioral interventions, epidemiology, non-biomedical research

## CRITICAL DISTINCTIONS

Tool development vs Tool application:
- "Developing a CRISPR screening platform" → biotools
- "Using CRISPR to study gene function" → basic_research
- "Using CRISPR to treat sickle cell" → therapeutics

Organization Type Definitions:
- company: Commercial entities (Inc., LLC, SBIR/STTR)
- university: Academic institutions
- hospital: Medical centers, health systems
- research_institute: Independent research organizations (Broad, Scripps)
- other: Government agencies, non-profits`

export async function classifyProject(project: ProjectData): Promise<ClassificationResult> {
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

    // Ensure confidence is in range
    result.category_confidence = Math.max(0, Math.min(100, result.category_confidence))

    return result
  } catch (error) {
    console.error('Classification error:', error)

    // Return default classification on error
    return {
      primary_category: 'other',
      category_confidence: 0,
      org_type: 'other',
    }
  }
}
