import { verifyToken } from '@clerk/backend'

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY

export interface AuthResult {
  userId: string
}

export async function verifyClerkToken(token: string): Promise<AuthResult | null> {
  if (!CLERK_SECRET_KEY) {
    console.error('CLERK_SECRET_KEY not set')
    return null
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: CLERK_SECRET_KEY,
      authorizedParties: undefined,
    })
    if (!payload.sub) return null
    return { userId: payload.sub }
  } catch (err) {
    console.error('Token verification failed:', err)
    return null
  }
}
