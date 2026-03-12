import { useState, useEffect, useCallback, useRef } from 'react'

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://coder-ai.fly.dev'
const HTTP_URL = RELAY_URL.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')

/**
 * Hook for interacting with the docs API on the relay server.
 * Works for both Electron and Web since both call relay HTTP endpoints directly.
 */
export function useDocsAPI(getToken: () => Promise<string | null>) {
  const [sources, setSources] = useState<DocSource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchWithAuth = useCallback(async (path: string, options: RequestInit = {}) => {
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`${HTTP_URL}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
    }
    return res.json()
  }, [getToken])

  const hasLoaded = useRef(false)

  const refresh = useCallback(async () => {
    // Only show loading spinner on initial fetch, not background polls
    if (!hasLoaded.current) setLoading(true)
    setError(null)
    try {
      const data = await fetchWithAuth('/api/docs')
      setSources(data as DocSource[])
      hasLoaded.current = true
    } catch (err) {
      // Not authenticated yet — silently ignore
      if (err instanceof Error && err.message === 'Not authenticated') return
      setError(err instanceof Error ? err.message : 'Failed to load docs')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth])

  // Load sources on mount
  useEffect(() => {
    refresh()
  }, [refresh])

  const deleteSource = useCallback(async (sourceId: number) => {
    await fetchWithAuth(`/api/docs/${sourceId}`, { method: 'DELETE' })
    setSources(prev => prev.filter(s => s.id !== sourceId))
  }, [fetchWithAuth])

  const searchDocs = useCallback(async (query: string, sourceIds?: number[], limit?: number) => {
    return fetchWithAuth('/api/docs/search', {
      method: 'POST',
      body: JSON.stringify({ query, sourceIds, limit }),
    })
  }, [fetchWithAuth])

  const fetchPages = useCallback(async (sourceId: number): Promise<Array<{ id: number; url: string; title: string | null; crawledAt: string }>> => {
    return fetchWithAuth(`/api/docs/${sourceId}/pages`) as Promise<Array<{ id: number; url: string; title: string | null; crawledAt: string }>>
  }, [fetchWithAuth])

  return {
    sources,
    loading,
    error,
    refresh,
    deleteSource,
    searchDocs,
    fetchPages,
  }
}
