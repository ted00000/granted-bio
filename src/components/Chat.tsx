'use client'

import { useState, useRef, useEffect } from 'react'
import type { PersonaType } from '@/lib/chat/types'
import { PERSONA_METADATA } from '@/lib/chat/prompts'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  isToolCall?: boolean
}

interface ChatProps {
  persona: PersonaType
  onBack: () => void
}

export function Chat({ persona, onBack }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim()
    }

    setMessages(prev => [...prev, userMessage])
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
          messages: [...messages, userMessage].map(m => ({
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
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleExampleClick = (query: string) => {
    setInput(query)
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
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
              <h1 className="font-semibold text-gray-900">{metadata.title} Assistant</h1>
            </div>
            <p className="text-sm text-gray-500">{metadata.description}</p>
          </div>
        </div>
        <div className="text-sm text-gray-400">
          powered by granted.bio
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Welcome message */}
          {messages.length === 0 && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">{metadata.icon}</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {metadata.subtitle}
              </h2>
              <p className="text-gray-600 mb-6">
                {metadata.description}
              </p>
              <div className="space-y-2">
                <p className="text-sm text-gray-500 mb-3">Try an example:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {metadata.exampleQueries.map((query, index) => (
                    <button
                      key={index}
                      onClick={() => handleExampleClick(query)}
                      className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 text-gray-700 transition-colors"
                    >
                      {query}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map(message => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-900'
                }`}
              >
                {message.isToolCall && (
                  <div className="flex items-center space-x-2 text-sm text-gray-500 mb-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Searching database...</span>
                  </div>
                )}
                <div className="whitespace-pre-wrap">
                  {message.content}
                  {message.isStreaming && !message.content && (
                    <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse" />
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="flex items-end space-x-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about NIH grants, companies, or research areas..."
                rows={1}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                style={{ maxHeight: '150px' }}
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Data from NIH RePORTER FY2024-2025 | 128K projects, 46K patents, 203K publications
          </p>
        </form>
      </div>
    </div>
  )
}
