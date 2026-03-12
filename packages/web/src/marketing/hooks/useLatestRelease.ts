import { useState, useEffect } from 'react'

interface LatestRelease {
  version: string
  dmgUrl: string
  releasedAt: string
  sha512: string
  size: number
}

const LATEST_JSON_URL = import.meta.env.VITE_LATEST_JSON_URL

// Module-level cache — only one fetch even if multiple components mount
let cached: Promise<LatestRelease | null> | null = null

function fetchLatestRelease(): Promise<LatestRelease | null> {
  if (!cached && LATEST_JSON_URL) {
    cached = fetch(LATEST_JSON_URL)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return cached ?? Promise.resolve(null)
}

export function useLatestRelease() {
  const [release, setRelease] = useState<LatestRelease | null>(null)

  useEffect(() => {
    fetchLatestRelease().then(setRelease)
  }, [])

  return { release }
}
