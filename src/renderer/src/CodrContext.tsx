import { createContext, type ReactNode } from 'react'

// eslint-disable-next-line react-refresh/only-export-components
export const CodrContext = createContext<CodrAPI | null>(null)

export function CodrProvider({ api, children }: { api: CodrAPI; children: ReactNode }) {
  return <CodrContext.Provider value={api}>{children}</CodrContext.Provider>
}
