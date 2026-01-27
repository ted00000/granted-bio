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
}

export interface ClassificationResult {
  primary_category: 'biotools' | 'therapeutics' | 'diagnostics' | 'medical_device' | 'digital_health' | 'other'
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

Return JSON in this exact format:
{
  "primary_category": "biotools|therapeutics|diagnostics|medical_device|digital_health|other",
  "category_confidence": 0-100,
  "org_type": "company|university|hospital|research_institute|other"
}

Category Definitions:
- biotools: Research tools, instruments, platforms, assays, reagents, enabling technologies for research
- therapeutics: Drug development, treatments, immunotherapy, gene therapy, therapeutic compounds
- diagnostics: Disease detection, screening tests, diagnostic assays, biomarker discovery
- medical_device: Implantable devices, surgical tools, prosthetics, therapeutic devices for patients
- digital_health: Health apps, telemedicine, AI diagnostics, wearables, digital therapeutics
- other: Basic research, epidemiology, health services, policy, education

Organization Type Definitions:
- company: Commercial entities, small businesses, biotech/pharma companies
- university: Academic institutions, colleges, universities
- hospital: Medical centers, clinical institutions, healthcare providers
- research_institute: Independent research organizations, national labs
- other: Government agencies, non-profits, foundations, unaffiliated`

export async function classifyProject(project: ProjectData): Promise<ClassificationResult> {
  // Build prompt with project data
  const prompt = CLASSIFICATION_PROMPT
    .replace('{title}', project.title || 'N/A')
    .replace('{org_name}', project.org_name || 'N/A')
    .replace('{abstract}', project.abstract || 'N/A')
    .replace('{phr}', project.phr || 'N/A')
    .replace('{terms}', project.terms || 'N/A')

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
    const validCategories = ['biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']
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
