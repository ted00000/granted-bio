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
            const response = await anthropic.messages.create({
              model: 'claude-3-5-haiku-20241022',
              max_tokens: 8192,
              system: systemPrompt,
              tools: AGENT_TOOLS,
              messages: conversationMessages
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
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = await Promise.all(
              toolUseBlocks.map(async (block) => {
                try {
                  const result = await executeTool(block.name, block.input, userAccess)
                  return {
                    type: 'tool_result' as const,
                    tool_use_id: block.id,
                    content: JSON.stringify(result, null, 2)
                  }
                } catch (error) {
                  console.error(`Tool ${block.name} error:`, error)
                  return {
                    type: 'tool_result' as const,
                    tool_use_id: block.id,
                    content: `Error executing ${block.name}: ${String(error)}`,
                    is_error: true
                  }
                }
              })
            )

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
