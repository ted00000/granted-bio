import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { PERSONA_PROMPTS } from '@/lib/chat/prompts'
import { AGENT_TOOLS, executeTool } from '@/lib/chat/tools'
import type { PersonaType, UserAccess, Message } from '@/lib/chat/types'
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
      searchesRemaining: 10
    }
  }

  // TODO: Look up user tier from database
  // For now, return pro access for authenticated users
  return {
    tier: 'pro',
    resultsLimit: 100,
    canExport: true,
    canSeeEmails: true,
    canSeeAbstracts: true,
    searchesRemaining: null
  }
}

interface ChatRequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  persona: PersonaType
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

    // Convert messages to Anthropic format
    const anthropicMessages = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))

    // Create streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let response = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 4096,
            system: systemPrompt,
            tools: AGENT_TOOLS,
            messages: anthropicMessages,
            stream: true
          })

          let currentText = ''
          let toolUseBlocks: Array<{
            id: string
            name: string
            input: Record<string, unknown>
          }> = []

          for await (const event of response) {
            if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                currentText += event.delta.text
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`
                  )
                )
              } else if (event.delta.type === 'input_json_delta') {
                // Accumulating tool input
              }
            } else if (event.type === 'content_block_start') {
              if (event.content_block.type === 'tool_use') {
                toolUseBlocks.push({
                  id: event.content_block.id,
                  name: event.content_block.name,
                  input: {}
                })
              }
            } else if (event.type === 'content_block_stop') {
              // Block finished
            } else if (event.type === 'message_delta') {
              if (event.delta.stop_reason === 'tool_use') {
                // Need to execute tools and continue
              }
            } else if (event.type === 'message_stop') {
              // Message complete
            }
          }

          // Check if we need to execute tools
          // Re-fetch the full response to check for tool use
          const fullResponse = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 4096,
            system: systemPrompt,
            tools: AGENT_TOOLS,
            messages: anthropicMessages
          })

          // Handle tool use in a loop
          let currentResponse = fullResponse
          let continueLoop = true
          const maxIterations = 5
          let iterations = 0

          while (continueLoop && iterations < maxIterations) {
            iterations++
            const toolUseContent = currentResponse.content.filter(
              block => block.type === 'tool_use'
            )

            if (toolUseContent.length === 0 || currentResponse.stop_reason !== 'tool_use') {
              continueLoop = false
              break
            }

            // Send tool use notification
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_start', tools: toolUseContent.map(t => (t as any).name) })}\n\n`
              )
            )

            // Execute all tool calls
            const toolResults = await Promise.all(
              toolUseContent.map(async (toolBlock) => {
                const block = toolBlock as {
                  type: 'tool_use'
                  id: string
                  name: string
                  input: Record<string, unknown>
                }
                try {
                  const result = await executeTool(block.name, block.input, userAccess)
                  return {
                    type: 'tool_result' as const,
                    tool_use_id: block.id,
                    content: JSON.stringify(result)
                  }
                } catch (error) {
                  return {
                    type: 'tool_result' as const,
                    tool_use_id: block.id,
                    content: JSON.stringify({ error: String(error) }),
                    is_error: true
                  }
                }
              })
            )

            // Send tool results notification
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_complete' })}\n\n`
              )
            )

            // Continue conversation with tool results
            const newMessages = [
              ...anthropicMessages,
              { role: 'assistant' as const, content: currentResponse.content },
              { role: 'user' as const, content: toolResults }
            ]

            // Stream the follow-up response
            const followUpStream = await anthropic.messages.create({
              model: 'claude-3-5-haiku-20241022',
              max_tokens: 4096,
              system: systemPrompt,
              tools: AGENT_TOOLS,
              messages: newMessages,
              stream: true
            })

            for await (const event of followUpStream) {
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`
                  )
                )
              }
            }

            // Get full response to check for more tool use
            currentResponse = await anthropic.messages.create({
              model: 'claude-3-5-haiku-20241022',
              max_tokens: 4096,
              system: systemPrompt,
              tools: AGENT_TOOLS,
              messages: newMessages
            })
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          console.error('Streaming error:', error)
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
