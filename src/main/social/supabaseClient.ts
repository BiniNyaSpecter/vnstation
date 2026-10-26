import type { Fetcher } from '../metadata/http'

export interface SupabaseAuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: {
    id: string
    email: string
    emailConfirmedAt: string | null
  }
}

/**
 * Inspects a Supabase JWT key to ensure a privileged `service_role` key is never
 * accepted or used by the desktop client.
 */
export function assertNotServiceRoleKey(key: string): void {
  const parts = key.trim().split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string }
      if (payload.role === 'service_role') {
        throw new Error(
          'Refusing to use a Supabase service_role key in the desktop client. Use the public anon key with Row-Level Security enabled.'
        )
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('service_role')) throw error
    }
  }
}

/**
 * Lightweight Supabase Auth (GoTrue) + PostgREST client running in the Electron main process.
 * Always passes the authenticated user's JWT so PostgreSQL Row-Level Security (RLS) policies
 * enforce `auth.uid()` on every query.
 */
export class SupabaseRestClient {
  private readonly baseUrl: string
  private readonly anonKey: string

  constructor(
    url: string,
    anonKey: string,
    private readonly fetcher: Fetcher
  ) {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error('Supabase URL must use https:// (or localhost for local development).')
    }
    assertNotServiceRoleKey(anonKey)
    this.baseUrl = parsed.origin
    this.anonKey = anonKey.trim()
  }

  private headers(accessToken?: string, extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${accessToken ?? this.anonKey}`,
      'Content-Type': 'application/json',
      ...extra
    }
  }

  async signUp(email: string, password: string): Promise<{ session: SupabaseAuthSession | null; userId: string; emailVerified: boolean }> {
    const res = await this.fetcher(`${this.baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email, password })
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const msg = (data.msg as string) || (data.error_description as string) || (data.message as string) || 'Registration failed.'
      throw new Error(msg)
    }
    const session = this.parseSession(data)
    const userObj = (data.user as Record<string, unknown>) ?? data
    const userId = String(userObj.id ?? session?.user.id ?? '')
    const confirmed = Boolean(userObj.email_confirmed_at ?? session?.user.emailConfirmedAt)
    return { session, userId, emailVerified: confirmed }
  }

  async signInWithPassword(email: string, password: string): Promise<SupabaseAuthSession> {
    const res = await this.fetcher(`${this.baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email, password })
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const msg = (data.error_description as string) || (data.msg as string) || (data.message as string) || 'Invalid email or password.'
      throw new Error(msg)
    }
    const session = this.parseSession(data)
    if (!session) throw new Error('Supabase did not return an active session.')
    return session
  }

  async refreshSession(refreshToken: string): Promise<SupabaseAuthSession> {
    const res = await this.fetcher(`${this.baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ refresh_token: refreshToken })
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error('Session expired. Please sign in again.')
    const session = this.parseSession(data)
    if (!session) throw new Error('Could not renew session.')
    return session
  }

  async recoverPassword(email: string): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/auth/v1/recover`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email })
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      throw new Error((data.msg as string) || (data.message as string) || 'Could not send password reset email.')
    }
  }

  async signOut(accessToken: string): Promise<void> {
    await this.fetcher(`${this.baseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: this.headers(accessToken)
    }).catch(() => undefined)
  }

  async rest<T>(
    tableAndQuery: string,
    accessToken: string,
    init?: { method?: string; body?: unknown; prefer?: string }
  ): Promise<T> {
    const res = await this.fetcher(`${this.baseUrl}/rest/v1/${tableAndQuery}`, {
      method: init?.method ?? 'GET',
      headers: this.headers(accessToken, init?.prefer ? { Prefer: init.prefer } : undefined),
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    })
    if (res.status === 204) return undefined as T
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const msg = (data.message as string) || (data.details as string) || `Database request failed (${res.status}).`
      throw new Error(msg)
    }
    return data as T
  }

  private parseSession(data: Record<string, unknown>): SupabaseAuthSession | null {
    const accessToken = typeof data.access_token === 'string' ? data.access_token : null
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : null
    const user = data.user as Record<string, unknown> | undefined
    if (!accessToken || !refreshToken || !user || typeof user.id !== 'string') return null
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      user: {
        id: user.id,
        email: typeof user.email === 'string' ? user.email : '',
        emailConfirmedAt: typeof user.email_confirmed_at === 'string' ? user.email_confirmed_at : null
      }
    }
  }
}
