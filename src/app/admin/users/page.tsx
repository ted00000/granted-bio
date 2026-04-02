'use client'

import { useEffect, useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: string
  created_at: string
  updated_at: string
}

interface UserUsage {
  userId: string
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
  callCount: number
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [usage, setUsage] = useState<Record<string, UserUsage>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)

  const supabase = createBrowserSupabaseClient()

  useEffect(() => {
    loadUsers()
    loadUsage()
  }, [])

  const loadUsers = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setUsers(data || [])
    }
    setLoading(false)
  }

  const loadUsage = async () => {
    try {
      const response = await fetch('/api/admin/usage?period=month')
      if (response.ok) {
        const data = await response.json()
        const usageMap: Record<string, UserUsage> = {}
        for (const total of data.totals) {
          usageMap[total.userId] = total
        }
        setUsage(usageMap)
      }
    } catch (err) {
      console.error('Failed to load usage:', err)
    }
  }

  const updateRole = async (userId: string, newRole: string) => {
    setUpdating(userId)
    setError(null)

    const { error } = await supabase
      .from('user_profiles')
      .update({ role: newRole })
      .eq('id', userId)

    if (error) {
      setError(error.message)
    } else {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      )
    }
    setUpdating(null)
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-100 text-purple-800'
      case 'associate':
        return 'bg-emerald-100 text-emerald-800'
      case 'user':
        return 'bg-blue-100 text-blue-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatCost = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }

  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`
    }
    return tokens.toString()
  }

  // Separate associates for the top section
  const associates = users.filter(u => u.role === 'associate')

  // Calculate total monthly cost for associates
  const totalMonthlyCost = associates.reduce((sum, user) => {
    const userUsage = usage[user.id]
    return sum + (userUsage?.totalCostCents || 0)
  }, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage user accounts, roles, and track associate usage
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/admin/usage?period=month&format=csv"
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 border border-emerald-600 rounded-md hover:bg-emerald-700"
          >
            Export CSV
          </a>
          <button
            onClick={() => { loadUsers(); loadUsage(); }}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading users...</p>
        </div>
      ) : (
        <>
          {/* Associates Section */}
          {associates.length > 0 && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-emerald-50 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-medium text-emerald-800">
                    Associates ({associates.length})
                  </h2>
                  <p className="text-sm text-emerald-600">
                    Unlimited access with usage-based billing
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold text-emerald-800">
                    {formatCost(totalMonthlyCost)}
                  </div>
                  <div className="text-sm text-emerald-600">This month</div>
                </div>
              </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      This Month
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tokens
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Joined
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {associates.map((user) => {
                    const userUsage = usage[user.id]
                    return (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {user.full_name || user.email}
                          </div>
                          <div className="text-sm text-gray-500">
                            {user.email}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-900">
                            {userUsage ? formatCost(userUsage.totalCostCents) : '$0.00'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {userUsage ? `${userUsage.callCount} calls` : '0 calls'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {userUsage ? (
                            <span>
                              {formatTokens(userUsage.totalInputTokens)} in / {formatTokens(userUsage.totalOutputTokens)} out
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <select
                            value={user.role}
                            onChange={(e) => updateRole(user.id, e.target.value)}
                            disabled={updating === user.id}
                            className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                          >
                            <option value="user">User</option>
                            <option value="associate">Associate</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* All Users Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">
                All Users ({users.length})
              </h2>
            </div>
            {users.length === 0 ? (
              <div className="p-8 text-center">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                <p className="mt-4 text-gray-500">No users found</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      API Cost (Month)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Joined
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map((user) => {
                    const userUsage = usage[user.id]
                    return (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {user.full_name || user.email}
                          </div>
                          <div className="text-sm text-gray-500">
                            {user.id.slice(0, 8)}...
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleColor(
                              user.role
                            )}`}
                          >
                            {user.role || 'user'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {userUsage ? formatCost(userUsage.totalCostCents) : '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <select
                            value={user.role || 'user'}
                            onChange={(e) => updateRole(user.id, e.target.value)}
                            disabled={updating === user.id}
                            className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                          >
                            <option value="user">User</option>
                            <option value="associate">Associate</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <svg
            className="w-5 h-5 text-blue-400 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Role Permissions</h3>
            <div className="mt-2 text-sm text-blue-700">
              <ul className="list-disc list-inside space-y-1">
                <li>
                  <strong>Admin:</strong> Full access to admin dashboard, unlimited API usage
                </li>
                <li>
                  <strong>Associate:</strong> Unlimited search and reports, usage tracked for billing
                </li>
                <li>
                  <strong>User:</strong> Standard user (Free: 10 searches/mo, Pro: 500 searches/mo)
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
