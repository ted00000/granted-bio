'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { PersonaType } from '@/lib/chat/types'
import { PERSONA_METADATA } from '@/lib/chat/prompts'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  isToolCall?: boolean
}

interface ToolResult {
  name: string
  data: unknown
  timestamp: number
}

interface ChatProps {
  persona: PersonaType
  onBack: () => void
}

// Parse message content to extract choices (bullet points at the end)
function parseMessageWithChoices(content: string): { text: string; choices: string[] } {
  const lines = content.split('\n')
  const choices: string[] = []
  let lastNonChoiceIndex = lines.length - 1

  // Find consecutive bullet points at the end
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
      const choice = line.replace(/^[•\-*]\s*/, '').trim()
      if (choice) {
        choices.unshift(choice)
        lastNonChoiceIndex = i - 1
      }
    } else if (line === '') {
      // Allow empty lines between choices
      continue
    } else {
      break
    }
  }

  const text = lines.slice(0, lastNonChoiceIndex + 1).join('\n').trim()
  return { text, choices }
}

// Format currency
function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`
  }
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(0)}K`
  }
  return `$${amount}`
}

// Results Panel Component
function ResultsPanel({ results }: { results: ToolResult[] }) {
  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">Search results will appear here</p>
        </div>
      </div>
    )
  }

  const latestResult = results[results.length - 1]

  // Render based on tool type
  if (latestResult.name === 'keyword_search') {
    const data = latestResult.data as {
      total_count: number
      by_category: Record<string, number>
      by_org_type: Record<string, number>
      sample_results: Array<{
        application_id: string
        title: string
        org_name: string | null
        org_type: string | null
        total_cost: number | null
        pi_names: string | null
      }>
    }

    return (
      <div className="h-full overflow-y-auto">
        {/* Summary stats */}
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="text-2xl font-semibold text-gray-900">{data.total_count.toLocaleString()}</div>
          <div className="text-sm text-gray-500">projects found</div>
        </div>

        {/* Category breakdown */}
        {Object.keys(data.by_category).length > 0 && (
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">By Category</h3>
            <div className="space-y-2">
              {Object.entries(data.by_category)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => (
                  <div key={cat} className="flex justify-between items-center">
                    <span className="text-sm text-gray-700 capitalize">{cat.replace('_', ' ')}</span>
                    <span className="text-sm font-medium text-gray-900">{count.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Org type breakdown */}
        {Object.keys(data.by_org_type).length > 0 && (
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">By Organization</h3>
            <div className="space-y-2">
              {Object.entries(data.by_org_type)
                .sort(([, a], [, b]) => b - a)
                .map(([org, count]) => (
                  <div key={org} className="flex justify-between items-center">
                    <span className="text-sm text-gray-700 capitalize">{org.replace('_', ' ')}</span>
                    <span className="text-sm font-medium text-gray-900">{count.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Sample results */}
        {data.sample_results.length > 0 && (
          <div className="p-4">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Top Funded</h3>
            <div className="space-y-3">
              {data.sample_results.map((project, idx) => (
                <div key={project.application_id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{project.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{project.org_name}</p>
                    </div>
                    {project.total_cost && (
                      <span className="text-sm font-medium text-green-700 whitespace-nowrap">
                        {formatCurrency(project.total_cost)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (latestResult.name === 'get_company_profile') {
    const data = latestResult.data as {
      org_name: string
      total_funding: number
      project_count: number
      patent_count: number
      publication_count: number
      clinical_trial_count: number
      top_projects: Array<{
        title: string
        total_cost: number | null
        fiscal_year: number | null
      }>
    }

    if (!data) {
      return (
        <div className="flex items-center justify-center h-full text-gray-400">
          <p className="text-sm">Company not found</p>
        </div>
      )
    }

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="text-lg font-semibold text-gray-900">{data.org_name}</div>
          <div className="text-2xl font-semibold text-green-700 mt-1">{formatCurrency(data.total_funding)}</div>
          <div className="text-sm text-gray-500">total funding</div>
        </div>

        <div className="grid grid-cols-2 gap-4 p-4 border-b border-gray-200">
          <div>
            <div className="text-xl font-semibold text-gray-900">{data.project_count}</div>
            <div className="text-xs text-gray-500">Projects</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-gray-900">{data.patent_count}</div>
            <div className="text-xs text-gray-500">Patents</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-gray-900">{data.publication_count}</div>
            <div className="text-xs text-gray-500">Publications</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-gray-900">{data.clinical_trial_count}</div>
            <div className="text-xs text-gray-500">Trials</div>
          </div>
        </div>

        {data.top_projects?.length > 0 && (
          <div className="p-4">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Recent Projects</h3>
            <div className="space-y-3">
              {data.top_projects.map((project, idx) => (
                <div key={idx} className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm font-medium text-gray-900">{project.title}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">FY{project.fiscal_year}</span>
                    {project.total_cost && (
                      <span className="text-sm font-medium text-green-700">
                        {formatCurrency(project.total_cost)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (latestResult.name === 'get_patent_details') {
    const data = latestResult.data as {
      patent_id: string
      patent_title: string
      patent_abstract: string | null
      patent_date: string | null
      assignees: string[]
      inventors: string[]
      cited_by_count: number
    }

    if (!data) {
      return (
        <div className="flex items-center justify-center h-full text-gray-400">
          <p className="text-sm">Patent not found</p>
        </div>
      )
    }

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-500 mb-1">US{data.patent_id}</div>
          <div className="text-lg font-semibold text-gray-900">{data.patent_title}</div>
          {data.patent_date && (
            <div className="text-sm text-gray-500 mt-1">Filed {data.patent_date}</div>
          )}
        </div>

        {data.patent_abstract && (
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Abstract</h3>
            <p className="text-sm text-gray-700 leading-relaxed">{data.patent_abstract}</p>
          </div>
        )}

        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Cited by</span>
            <span className="text-lg font-semibold text-gray-900">{data.cited_by_count} patents</span>
          </div>
        </div>

        {data.assignees?.length > 0 && (
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Assignees</h3>
            <div className="space-y-1">
              {data.assignees.map((a, i) => (
                <p key={i} className="text-sm text-gray-700">{a}</p>
              ))}
            </div>
          </div>
        )}

        {data.inventors?.length > 0 && (
          <div className="p-4">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Inventors</h3>
            <div className="flex flex-wrap gap-2">
              {data.inventors.map((inv, i) => (
                <span key={i} className="px-2 py-1 bg-gray-100 rounded text-sm text-gray-700">{inv}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Generic fallback for other tool results
  return (
    <div className="h-full overflow-y-auto p-4">
      <pre className="text-xs text-gray-600 whitespace-pre-wrap">
        {JSON.stringify(latestResult.data, null, 2)}
      </pre>
    </div>
  )
}

export function Chat({ persona, onBack }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toolResults, setToolResults] = useState<ToolResult[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const metadata = PERSONA_METADATA[persona]

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Core function to send a message
  const sendMessage = useCallback(async (text: string, currentMessages: Message[]) => {
    if (!text.trim() || isLoading) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim()
    }

    const updatedMessages = [...currentMessages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setIsLoading(true)

    // Create assistant message placeholder for streaming
    const assistantId = crypto.randomUUID()
    setMessages(prev => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', isStreaming: true }
    ])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({
            role: m.role,
            content: m.content
          })),
          persona
        })
      })

      if (!response.ok) {
        throw new Error('Chat request failed')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response body')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, isStreaming: false } : m
                )
              )
              continue
            }

            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'text') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, content: m.content + parsed.content }
                      : m
                  )
                )
              } else if (parsed.type === 'tool_start') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, isToolCall: true }
                      : m
                  )
                )
              } else if (parsed.type === 'tool_result') {
                // Add tool result to side panel
                setToolResults(prev => [
                  ...prev,
                  {
                    name: parsed.name,
                    data: parsed.data,
                    timestamp: Date.now()
                  }
                ])
              } else if (parsed.type === 'tool_complete') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, isToolCall: false }
                      : m
                  )
                )
              } else if (parsed.type === 'error') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, content: `Error: ${parsed.error}`, isStreaming: false }
                      : m
                  )
                )
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: 'Sorry, an error occurred. Please try again.', isStreaming: false }
            : m
        )
      )
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, persona])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input, messages)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input, messages)
    }
  }

  const handleExampleClick = (query: string) => {
    setInput(query)
    inputRef.current?.focus()
  }

  // Handle clicking a choice button - send it as user message directly
  const handleChoiceClick = (choice: string) => {
    if (isLoading) return
    sendMessage(choice, messages)
  }

  // Check if this is the last assistant message (for showing clickable choices)
  const isLastAssistantMessage = (messageId: string) => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    return lastAssistant?.id === messageId
  }

  return (
    <div className="flex h-screen bg-white">
      {/* Left Panel - Chat */}
      <div className="flex flex-col w-full lg:w-1/2 xl:w-2/5 border-r border-gray-200">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBack}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl">{metadata.icon}</span>
                <h1 className="font-semibold text-gray-900">{metadata.title}</h1>
              </div>
              <p className="text-sm text-gray-500">{metadata.subtitle}</p>
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 bg-gray-50">
          <div className="space-y-4">
            {/* Welcome message */}
            {messages.length === 0 && (
              <div className="text-center py-8">
                <div className="text-4xl mb-4">{metadata.icon}</div>
                <h2 className="text-lg font-semibold text-gray-900 mb-2">
                  {metadata.subtitle}
                </h2>
                <p className="text-sm text-gray-600 mb-6 max-w-sm mx-auto">
                  {metadata.description}
                </p>
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-3">Try an example:</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {metadata.exampleQueries.slice(0, 3).map((query, index) => (
                      <button
                        key={index}
                        onClick={() => handleExampleClick(query)}
                        className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 text-gray-700 transition-colors"
                      >
                        {query}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Message list */}
            {messages.map(message => {
              // Parse choices for assistant messages
              const showChoices = message.role === 'assistant' &&
                                 !message.isStreaming &&
                                 !isLoading &&
                                 isLastAssistantMessage(message.id)
              const { text, choices } = showChoices
                ? parseMessageWithChoices(message.content)
                : { text: message.content, choices: [] }

              return (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-2.5 ${
                      message.role === 'user'
                        ? 'bg-[#E07A5F] text-white'
                        : 'bg-white border border-gray-200 text-gray-900'
                    }`}
                  >
                    {message.isToolCall && (
                      <div className="flex items-center space-x-2 text-sm text-gray-500 mb-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Searching...</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {showChoices ? text : message.content}
                      {message.isStreaming && !message.content && (
                        <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse" />
                      )}
                    </div>
                    {/* Clickable choice buttons */}
                    {showChoices && choices.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {choices.map((choice, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleChoiceClick(choice)}
                            className="px-3 py-1.5 text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded-full hover:bg-gray-100 hover:border-gray-300 transition-colors"
                          >
                            {choice}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <form onSubmit={handleSubmit}>
            <div className="flex items-end space-x-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question..."
                  rows={1}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl resize-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent text-sm"
                  style={{ maxHeight: '120px' }}
                  disabled={isLoading}
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-2.5 bg-[#E07A5F] text-white rounded-xl hover:bg-[#C96A4F] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Right Panel - Results */}
      <div className="hidden lg:flex flex-col flex-1 bg-white">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium text-gray-900">Results</h2>
          <p className="text-xs text-gray-500">NIH RePORTER & USPTO PatentsView</p>
        </div>
        <div className="flex-1 overflow-hidden">
          <ResultsPanel results={toolResults} />
        </div>
      </div>
    </div>
  )
}
