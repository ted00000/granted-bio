import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { PERSONA_PROMPTS } from '@/lib/chat/prompts'
import { AGENT_TOOLS, executeTool } from '@/lib/chat/tools'
import type { PersonaType, UserAccess } from '@/lib/chat/types'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const maxDuration = 60

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

// Get user access level from database or session
async function getUserAccess(userId: string | null): Promise<UserAccess> {
  if (!userId) {
    return {
      tier: 'free',
      resultsLimit: 25,
      canExport: false,
      canSeeEmails: false,
      canSeeAbstracts: false,
      searchesPerMonth: 10
    }
  }

  return {
    tier: 'unlimited',
    resultsLimit: 100,
    canExport: true,
    canSeeEmails: true,
    canSeeAbstracts: true,
    searchesPerMonth: null
  }
}

interface ChatRequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  persona: PersonaType
}

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | Anthropic.Messages.ContentBlockParam[]
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequestBody = await request.json()
    const { messages, persona } = body

    if (!messages || !persona) {
      return new Response(
        JSON.stringify({ error: 'Missing messages or persona' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get user from session
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    const userAccess = await getUserAccess(user?.id || null)

    // Get system prompt for this persona
    const systemPrompt = PERSONA_PROMPTS[persona]
    if (!systemPrompt) {
      return new Response(
        JSON.stringify({ error: 'Invalid persona' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Build conversation history
    const conversationMessages: AnthropicMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content
    }))

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const maxToolIterations = 5
          let iteration = 0

          while (iteration < maxToolIterations) {
            iteration++

            // Make the API call
            console.log('[Chat API] Iteration', iteration, '- Making API call')
            console.log('[Chat API] First message:', JSON.stringify(conversationMessages[0]).slice(0, 200))

            // Enable prompt caching for system prompt and tools (90% cost savings on cached tokens)
            // Cache TTL is 5 minutes - subsequent requests within window pay only 10%
            const cachedTools = AGENT_TOOLS.map((tool, i) =>
              i === AGENT_TOOLS.length - 1
                ? { ...tool, cache_control: { type: 'ephemeral' as const } }
                : tool
            )

            const response = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              system: [
                {
                  type: 'text',
                  text: systemPrompt,
                  cache_control: { type: 'ephemeral' }
                }
              ],
              tools: cachedTools,
              messages: conversationMessages
            })

            console.log('[Chat API] Response stop_reason:', response.stop_reason)
            console.log('[Chat API] Response content types:', response.content.map(b => b.type).join(', '))

            // Log token usage with cache stats
            const usage = response.usage as {
              input_tokens: number
              output_tokens: number
              cache_creation_input_tokens?: number
              cache_read_input_tokens?: number
            }
            const cacheRead = usage.cache_read_input_tokens || 0
            const cacheWrite = usage.cache_creation_input_tokens || 0
            const uncachedInput = usage.input_tokens - cacheRead

            // Cost calculation: cached reads are 0.1x, cache writes are 1.25x, uncached is 1x
            const inputCost = (uncachedInput * 3 + cacheRead * 0.3 + cacheWrite * 3.75) / 1000000
            const outputCost = (usage.output_tokens * 15) / 1000000

            console.log('[Chat API] Token usage:', {
              input: usage.input_tokens,
              output: usage.output_tokens,
              cache_read: cacheRead,
              cache_write: cacheWrite,
              cost_estimate: `$${(inputCost + outputCost).toFixed(4)}`,
              cache_savings: cacheRead > 0 ? `${Math.round((cacheRead * 2.7 / 1000000) * 10000) / 100}¢ saved` : 'no cache hit'
            })

            // Extract text and tool use from response
            let responseText = ''
            const toolUseBlocks: Array<{
              type: 'tool_use'
              id: string
              name: string
              input: Record<string, unknown>
            }> = []

            for (const block of response.content) {
              if (block.type === 'text') {
                responseText += block.text
              } else if (block.type === 'tool_use') {
                toolUseBlocks.push({
                  type: 'tool_use',
                  id: block.id,
                  name: block.name,
                  input: block.input as Record<string, unknown>
                })
              }
            }

            console.log('[Chat API] Tool use blocks found:', toolUseBlocks.length)
            if (toolUseBlocks.length > 0) {
              console.log('[Chat API] Tools:', toolUseBlocks.map(t => t.name).join(', '))
            }
            if (responseText && toolUseBlocks.length === 0) {
              console.log('[Chat API] Final text response (first 200 chars):', responseText.slice(0, 200))
            }

            // Only stream text if there are no tool calls (final response)
            // This prevents intermediate "I'll search for..." text from showing
            if (toolUseBlocks.length === 0 && responseText) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'text', content: responseText })}\n\n`
                )
              )
            }

            // If no tool use, we're done
            if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
              // Warn if response was truncated
              if (response.stop_reason === 'max_tokens') {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'text', content: '\n\n[Response truncated due to length. Ask a more specific question for detailed results.]' })}\n\n`
                  )
                )
              }
              break
            }

            // Notify client about tool execution
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'tool_start',
                  tools: toolUseBlocks.map(t => t.name)
                })}\n\n`
              )
            )

            // Execute all tools
            const toolResultsRaw = await Promise.all(
              toolUseBlocks.map(async (block) => {
                try {
                  const result = await executeTool(block.name, block.input, userAccess)
                  return { block, result, error: null }
                } catch (error) {
                  console.error(`Tool ${block.name} error:`, error)
                  return { block, result: null, error }
                }
              })
            )

            // Build tool results for Claude - strip all_results to save tokens (UI gets it directly)
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = toolResultsRaw.map(({ block, result, error }) => {
              if (error) {
                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: `Error executing ${block.name}: ${String(error)}`,
                  is_error: true
                }
              }
              // Strip all_results and sample_results - Claude only needs total_count and search_query
              // The UI receives the full results via the streamed tool_result event
              let resultForClaude = result
              if (result && typeof result === 'object' && 'all_results' in result) {
                const { all_results, sample_results, ...rest } = result as Record<string, unknown>
                resultForClaude = rest
              }
              return {
                type: 'tool_result' as const,
                tool_use_id: block.id,
                content: JSON.stringify(resultForClaude)
              }
            })

            // Send full tool results to client for display in side panel (includes all_results)
            for (const { block, result, error } of toolResultsRaw) {
              if (!error && result) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'tool_result',
                      name: block.name,
                      data: result
                    })}\n\n`
                  )
                )
              }
            }

            // Notify client that tools completed
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_complete' })}\n\n`
              )
            )

            // Add assistant response and tool results to conversation
            conversationMessages.push({
              role: 'assistant',
              content: response.content
            })
            conversationMessages.push({
              role: 'user',
              content: toolResults
            })
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          console.error('Chat error:', error)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`
            )
          )
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      }
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return new Response(
      JSON.stringify({ error: 'Chat failed', details: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
