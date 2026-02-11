'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, TrendingUp, Users, Activity } from 'lucide-react'
import type { PersonaType } from '@/lib/chat/types'
import { PERSONA_METADATA } from '@/lib/chat/prompts'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

const ICONS = {
  search: Search,
  trending: TrendingUp,
  users: Users,
  activity: Activity,
} as const

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

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    // Only match • for choices - dashes and asterisks are used for other lists
    if (line.startsWith('•')) {
      const choice = line.replace(/^•\s*/, '').trim()
      if (choice) {
        choices.unshift(choice)
        lastNonChoiceIndex = i - 1
      }
    } else if (line === '') {
      continue
    } else {
      break
    }
  }

  const text = lines.slice(0, lastNonChoiceIndex + 1).join('\n').trim()
  return { text, choices }
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`
  return `$${amount}`
}

// Results Panel Component
function ResultsPanel({ results }: { results: ToolResult[] }) {
  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-gray-400">Results will appear here</p>
        </div>
      </div>
    )
  }

  const latestResult = results[results.length - 1]

  if (latestResult.name === 'keyword_search') {
    const data = latestResult.data as {
      total_count: number
      by_category: Record<string, number>
      by_org_type: Record<string, number>
      sample_results: Array<{
        application_id: string
        title: string
        org_name: string | null
        org_state: string | null
        org_type: string | null
        total_cost: number | null
        fiscal_year: number | null
        pi_names: string | null
        primary_category: string | null
        is_sbir: boolean
        is_sttr: boolean
        patent_count: number
        publication_count: number
        clinical_trial_count: number
      }>
    }

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-4xl font-semibold tracking-tight text-gray-900">{data.total_count.toLocaleString()}</div>
          <div className="text-sm text-gray-400 mt-1">projects found</div>
        </div>

        {(Object.keys(data.by_category || {}).length > 0 || Object.keys(data.by_org_type || {}).length > 0) && (
          <div className="p-6 border-b border-gray-100">
            <div className="grid grid-cols-2 gap-4">
              {Object.keys(data.by_category || {}).length > 0 && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider mb-3">Category</h3>
                  <table className="w-full">
                    <tbody>
                      {Object.entries(data.by_category)
                        .sort(([, a], [, b]) => b - a)
                        .map(([cat, count]) => (
                          <tr key={cat}>
                            <td className="py-1.5 text-sm text-gray-700 capitalize">{cat.replace(/_/g, ' ')}</td>
                            <td className="py-1.5 text-sm font-semibold text-gray-900 text-right tabular-nums">{count.toLocaleString()}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {Object.keys(data.by_org_type || {}).length > 0 && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider mb-3">Organization</h3>
                  <table className="w-full">
                    <tbody>
                      {Object.entries(data.by_org_type)
                        .sort(([, a], [, b]) => b - a)
                        .map(([org, count]) => (
                          <tr key={org}>
                            <td className="py-1.5 text-sm text-gray-700 capitalize">{org.replace(/_/g, ' ')}</td>
                            <td className="py-1.5 text-sm font-semibold text-gray-900 text-right tabular-nums">{count.toLocaleString()}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {data.sample_results?.length > 0 && (
          <div className="p-6">
            <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider mb-4">Top Funded</h3>
            <div className="space-y-5">
              {data.sample_results.map((project) => (
                <div key={project.application_id} className="pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm text-gray-900 leading-snug flex-1">{project.title}</p>
                    {project.total_cost && (
                      <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap">
                        {formatCurrency(project.total_cost)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{project.org_name}</span>
                    {project.org_state && <span>• {project.org_state}</span>}
                    {project.fiscal_year && <span>• FY{project.fiscal_year}</span>}
                  </div>
                  {project.pi_names && (
                    <p className="text-xs text-gray-500 mt-1">PI: {project.pi_names.split(';')[0]?.trim()}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">ID: {project.application_id}</p>
                  <div className="flex items-center flex-wrap gap-2 mt-2">
                    {project.primary_category && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded capitalize">
                        {project.primary_category.replace(/_/g, ' ')}
                      </span>
                    )}
                    {project.org_type && (
                      <span className="px-2 py-0.5 text-xs bg-gray-50 text-gray-500 rounded capitalize">
                        {project.org_type.replace(/_/g, ' ')}
                      </span>
                    )}
                    {project.patent_count > 0 && (
                      <span className="px-2 py-0.5 text-xs bg-amber-50 text-amber-700 rounded">
                        {project.patent_count} Patent{project.patent_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {project.clinical_trial_count > 0 && (
                      <span className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded">
                        {project.clinical_trial_count} Trial{project.clinical_trial_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {project.publication_count > 0 && (
                      <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                        {project.publication_count} Pub{project.publication_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {project.is_sbir && (
                      <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-600 rounded">SBIR</span>
                    )}
                    {project.is_sttr && (
                      <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-600 rounded">STTR</span>
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

  if (latestResult.name === 'search_projects') {
    const data = latestResult.data as {
      results: Array<{
        application_id: string
        title: string
        org_name: string | null
        org_state: string | null
        org_type: string | null
        total_cost: number | null
        fiscal_year: number | null
        pi_names: string | null
        primary_category: string | null
        is_sbir: boolean
        is_sttr: boolean
        patent_count: number
        publication_count: number
        clinical_trial_count: number
      }>
      total: number
    }

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-4xl font-semibold tracking-tight text-gray-900">{data.total.toLocaleString()}</div>
          <div className="text-sm text-gray-400 mt-1">projects found</div>
        </div>

        {data.results?.length > 0 && (
          <div className="p-6">
            <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider mb-4">Top Results</h3>
            <div className="space-y-5">
              {data.results.map((project) => (
                <div key={project.application_id} className="pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm text-gray-900 leading-snug flex-1">{project.title}</p>
                    {project.total_cost && (
                      <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap">
                        {formatCurrency(project.total_cost)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{project.org_name}</span>
                    {project.org_state && <span>• {project.org_state}</span>}
                    {project.fiscal_year && <span>• FY{project.fiscal_year}</span>}
                  </div>
                  {project.pi_names && (
                    <p className="text-xs text-gray-500 mt-1">PI: {project.pi_names.split(';')[0]?.trim()}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">ID: {project.application_id}</p>
                  <div className="flex items-center flex-wrap gap-2 mt-2">
                    {project.primary_category && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded capitalize">
                        {project.primary_category.replace(/_/g, ' ')}
                      </span>
                    )}
                    {project.org_type && (
                      <span className="px-2 py-0.5 text-xs bg-gray-50 text-gray-500 rounded capitalize">
                        {project.org_type.replace(/_/g, ' ')}
                      </span>
                    )}
                    {project.patent_count > 0 && (
                      <span className="px-2 py-0.5 text-xs bg-amber-50 text-amber-700 rounded">
                        {project.patent_count} Patent{project.patent_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {project.clinical_trial_count > 0 && (
                      <span className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded">
                        {project.clinical_trial_count} Trial{project.clinical_trial_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {project.publication_count > 0 && (
                      <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                        {project.publication_count} Pub{project.publication_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {project.is_sbir && (
                      <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-600 rounded">SBIR</span>
                    )}
                    {project.is_sttr && (
                      <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-600 rounded">STTR</span>
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

  if (latestResult.name === 'search_patents') {
    const data = latestResult.data as Array<{
      patent_id: string
      patent_title: string
      project_number: string | null
      similarity?: number
    }>

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-4xl font-semibold tracking-tight text-gray-900">{data.length}</div>
          <div className="text-sm text-gray-400 mt-1">patents found</div>
        </div>

        <div className="p-6">
          <div className="space-y-4">
            {data.map((patent) => (
              <div key={patent.patent_id} className="pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className="text-sm text-gray-900 leading-snug flex-1">{patent.patent_title}</p>
                  {patent.similarity && (
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {Math.round(patent.similarity * 100)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>US{patent.patent_id}</span>
                  {patent.project_number && <span>• NIH {patent.project_number}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
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
      top_projects: Array<{ title: string; total_cost: number | null; fiscal_year: number | null }>
    }

    if (!data) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Not found</div>

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-lg font-semibold text-gray-900">{data.org_name}</div>
          <div className="text-3xl font-semibold tracking-tight text-[#E07A5F] mt-2">{formatCurrency(data.total_funding)}</div>
          <div className="text-sm text-gray-400 mt-1">total funding</div>
        </div>

        <div className="grid grid-cols-2 gap-6 p-6 border-b border-gray-100">
          {[
            { label: 'Projects', value: data.project_count },
            { label: 'Patents', value: data.patent_count },
            { label: 'Publications', value: data.publication_count },
            { label: 'Trials', value: data.clinical_trial_count },
          ].map(stat => (
            <div key={stat.label}>
              <div className="text-2xl font-semibold text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-400">{stat.label}</div>
            </div>
          ))}
        </div>

        {data.top_projects?.length > 0 && (
          <div className="p-6">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-4">Recent Projects</h3>
            <div className="space-y-4">
              {data.top_projects.map((project, idx) => (
                <div key={idx}>
                  <p className="text-sm text-gray-900">{project.title}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-400">FY{project.fiscal_year}</span>
                    {project.total_cost && (
                      <span className="text-sm font-medium text-[#E07A5F]">{formatCurrency(project.total_cost)}</span>
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

    if (!data) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Not found</div>

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-xs text-gray-400 mb-2">US{data.patent_id}</div>
          <div className="text-lg font-semibold text-gray-900 leading-snug">{data.patent_title}</div>
          {data.patent_date && <div className="text-sm text-gray-400 mt-2">Filed {data.patent_date}</div>}
        </div>

        {data.patent_abstract && (
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Abstract</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{data.patent_abstract}</p>
          </div>
        )}

        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Cited by</span>
            <span className="text-xl font-semibold text-gray-900">{data.cited_by_count}</span>
          </div>
        </div>

        {data.assignees?.length > 0 && (
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Assignees</h3>
            {data.assignees.map((a, i) => <p key={i} className="text-sm text-gray-600">{a}</p>)}
          </div>
        )}

        {data.inventors?.length > 0 && (
          <div className="p-6">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Inventors</h3>
            <div className="flex flex-wrap gap-2">
              {data.inventors.map((inv, i) => (
                <span key={i} className="px-3 py-1.5 bg-gray-50 rounded-full text-sm text-gray-600">{inv}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <pre className="text-xs text-gray-500 whitespace-pre-wrap">{JSON.stringify(latestResult.data, null, 2)}</pre>
    </div>
  )
}

export function Chat({ persona, onBack }: ChatProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toolResults, setToolResults] = useState<ToolResult[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const supabase = useMemo(() => createBrowserSupabaseClient(), [])

  const metadata = PERSONA_METADATA[persona]
  const IconComponent = ICONS[metadata.icon]

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const sendMessage = useCallback(async (text: string, currentMessages: Message[]) => {
    if (!text.trim() || isLoading) return

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: text.trim() }
    const updatedMessages = [...currentMessages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setIsLoading(true)

    const assistantId = crypto.randomUUID()
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages.map(m => ({ role: m.role, content: m.content })), persona })
      })

      if (!response.ok) throw new Error('Chat request failed')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No response body')

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
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
              continue
            }

            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'text') {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + parsed.content } : m))
              } else if (parsed.type === 'tool_start') {
                // Clear previous results when starting a new tool call
                setToolResults([])
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isToolCall: true } : m))
              } else if (parsed.type === 'tool_result') {
                setToolResults(prev => [...prev, { name: parsed.name, data: parsed.data, timestamp: Date.now() }])
              } else if (parsed.type === 'tool_complete') {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isToolCall: false } : m))
              } else if (parsed.type === 'error') {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${parsed.error}`, isStreaming: false } : m))
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: 'Sorry, an error occurred.', isStreaming: false } : m))
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, persona])

  const handleSubmit = (e: React.FormEvent) => {
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

  const handleChoiceClick = (choice: string) => {
    if (!isLoading) sendMessage(choice, messages)
  }

  const isLastAssistantMessage = (messageId: string) => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    return lastAssistant?.id === messageId
  }

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 px-6 py-4">
        <nav className="max-w-5xl mx-auto flex items-center justify-between">
          <button onClick={onBack} className="text-2xl font-semibold tracking-tight text-gray-900">
            granted<span className="text-[#E07A5F]">.bio</span>
          </button>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 flex min-h-0">
        {/* Left Panel - Chat */}
        <div className="flex flex-col w-full lg:w-[480px] xl:w-[520px] lg:border-r lg:border-gray-100 min-h-0">

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-8 min-h-0">
          <div className="space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-12">
                <div className="flex justify-center mb-6">
                  <IconComponent className="w-12 h-12 text-gray-300" strokeWidth={1.5} />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900 mb-2">
                  {metadata.title}
                </h2>
                <p className="text-sm text-[#E07A5F] mb-2">
                  &ldquo;{metadata.subtitle}&rdquo;
                </p>
                <p className="text-gray-400 mb-8 max-w-sm mx-auto text-sm">
                  {metadata.description}
                </p>
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">Try an example</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {metadata.exampleQueries.slice(0, 3).map((query, index) => (
                      <button
                        key={index}
                        onClick={() => handleExampleClick(query)}
                        className="px-4 py-2 text-sm bg-white border border-gray-100 rounded-full hover:border-[#E07A5F] hover:shadow-md text-gray-600 transition-all"
                      >
                        {query}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map(message => {
              const showChoices = message.role === 'assistant' && !message.isStreaming && !isLoading && isLastAssistantMessage(message.id)
              const { text, choices } = showChoices ? parseMessageWithChoices(message.content) : { text: message.content, choices: [] }

              return (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${message.role === 'user' ? 'text-right' : ''}`}>
                    {message.role === 'user' ? (
                      <div className="inline-block px-4 py-2.5 bg-gray-100 rounded-2xl rounded-br-md">
                        <p className="text-sm text-gray-900">{message.content}</p>
                      </div>
                    ) : (
                      <div>
                        {message.isToolCall && (
                          <div className="flex items-center space-x-2 text-sm text-gray-400 mb-3">
                            <div className="w-4 h-4 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
                            <span>Searching...</span>
                          </div>
                        )}
                        <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                          {showChoices ? text : message.content}
                          {message.isStreaming && !message.content && (
                            <span className="inline-block w-1.5 h-4 bg-gray-300 animate-pulse ml-0.5" />
                          )}
                        </div>
                        {showChoices && choices.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {choices.map((choice, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleChoiceClick(choice)}
                                className="px-3 py-1.5 text-xs bg-white border border-gray-100 rounded-full hover:border-[#E07A5F] hover:shadow-sm text-gray-600 transition-all"
                              >
                                {choice}
                              </button>
                            ))}
                          </div>
                        )}
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
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100">
          <form onSubmit={handleSubmit}>
            <div className="flex items-end space-x-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                rows={1}
                className="flex-1 px-4 py-3 bg-gray-50 border-0 rounded-xl resize-none text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 text-sm"
                style={{ maxHeight: '120px' }}
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-3 bg-[#E07A5F] text-white rounded-xl hover:bg-[#C96A4F] disabled:opacity-40 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>

        {/* Right Panel - Results */}
        <div className="hidden lg:flex flex-col flex-1">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold tracking-tight text-gray-900">Results</h2>
            <p className="text-xs text-gray-400 mt-0.5">NIH RePORTER & USPTO PatentsView</p>
          </div>
          <div className="flex-1 overflow-hidden">
            <ResultsPanel results={toolResults} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 px-6 py-4 border-t border-gray-100">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-gray-400">
            Data from NIH RePORTER & USPTO PatentsView
          </p>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <a href="mailto:hello@granted.bio" className="hover:text-gray-600 transition-colors">
              Contact
            </a>
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
