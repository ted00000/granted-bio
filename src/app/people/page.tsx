'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Users, Trash2, Building2, User } from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'

interface SavedPerson {
  id: string
  name: string
  type: 'researcher' | 'organization'
  saved_at: string
  stats: {
    projectCount: number
    totalFunding: number
    organizations?: string[]
  }
}

function formatCurrency(amount: number): string {
  if (!amount) return ''
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(1)}B`
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`
  return `$${amount}`
}

export default function MyPeoplePage() {
  const [people, setPeople] = useState<SavedPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    fetchPeople()
  }, [])

  const fetchPeople = async () => {
    try {
      const response = await fetch('/api/saved-people')
      const data = await response.json()
      if (data.people) {
        setPeople(data.people)
      }
    } catch (e) {
      console.error('Error fetching saved people:', e)
    } finally {
      setLoading(false)
    }
  }

  const removePerson = async (person: SavedPerson) => {
    setRemovingId(person.id)
    try {
      await fetch(`/api/saved-people?person_name=${encodeURIComponent(person.name)}&person_type=${person.type}`, {
        method: 'DELETE'
      })
      setPeople(prev => prev.filter(p => p.id !== person.id))
    } catch (e) {
      console.error('Error removing person:', e)
    } finally {
      setRemovingId(null)
    }
  }

  const researchers = people.filter(p => p.type === 'researcher')
  const organizations = people.filter(p => p.type === 'organization')

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 pt-[calc(1rem+env(safe-area-inset-top))] lg:pt-8">
          <div className="flex items-center gap-3 mb-8">
            <Users className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
            <h1 className="text-2xl font-semibold text-gray-900">My People</h1>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            </div>
          ) : people.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-3">No saved people yet</p>
              <Link
                href="/chat?lens=bd"
                className="text-sm text-[#E07A5F] hover:text-[#C96A4F]"
              >
                Search People →
              </Link>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Researchers Section */}
              {researchers.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <User className="w-4 h-4 text-gray-400" strokeWidth={1.5} />
                    <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                      Researchers ({researchers.length})
                    </h2>
                  </div>
                  <div className="space-y-3">
                    {researchers.map((person) => (
                      <div
                        key={person.id}
                        className="bg-white rounded-lg shadow-sm p-4 flex items-start gap-4 group"
                      >
                        <Link
                          href={`/researcher/${encodeURIComponent(person.name)}`}
                          className="flex-1 min-w-0"
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <h3 className="text-sm font-medium text-gray-900 leading-snug group-hover:text-[#E07A5F] transition-colors">
                              {person.name}
                            </h3>
                            {person.stats.totalFunding > 0 && (
                              <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap flex-shrink-0">
                                {formatCurrency(person.stats.totalFunding)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>{person.stats.projectCount} project{person.stats.projectCount !== 1 ? 's' : ''}</span>
                            {person.stats.organizations && person.stats.organizations.length > 0 && (
                              <>
                                <span>•</span>
                                <span className="truncate">{person.stats.organizations.join(', ')}</span>
                              </>
                            )}
                          </div>
                        </Link>
                        <button
                          onClick={() => removePerson(person)}
                          disabled={removingId === person.id}
                          className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors flex-shrink-0"
                          title="Remove from saved"
                        >
                          {removingId === person.id ? (
                            <div className="w-4 h-4 border-2 border-gray-200 border-t-rose-500 rounded-full animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Organizations Section */}
              {organizations.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Building2 className="w-4 h-4 text-gray-400" strokeWidth={1.5} />
                    <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                      Organizations ({organizations.length})
                    </h2>
                  </div>
                  <div className="space-y-3">
                    {organizations.map((person) => (
                      <div
                        key={person.id}
                        className="bg-white rounded-lg shadow-sm p-4 flex items-start gap-4 group"
                      >
                        <Link
                          href={`/org/${encodeURIComponent(person.name)}`}
                          className="flex-1 min-w-0"
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <h3 className="text-sm font-medium text-gray-900 leading-snug group-hover:text-[#E07A5F] transition-colors">
                              {person.name}
                            </h3>
                            {person.stats.totalFunding > 0 && (
                              <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap flex-shrink-0">
                                {formatCurrency(person.stats.totalFunding)}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400">
                            {person.stats.projectCount} project{person.stats.projectCount !== 1 ? 's' : ''}
                          </div>
                        </Link>
                        <button
                          onClick={() => removePerson(person)}
                          disabled={removingId === person.id}
                          className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors flex-shrink-0"
                          title="Remove from saved"
                        >
                          {removingId === person.id ? (
                            <div className="w-4 h-4 border-2 border-gray-200 border-t-rose-500 rounded-full animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
