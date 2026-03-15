import { useContext } from 'react'
import { CodrContext } from '../CodrContext'

export function useCodr(): CodrAPI {
  const ctx = useContext(CodrContext)
  if (!ctx) throw new Error('useCodr must be used within a CodrProvider')
  return ctx
}
