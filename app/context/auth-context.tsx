'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { api } from '../lib/api'

export interface AuthUser {
  id: string
  email: string
  instagram_username: string | null
  instagram_id: string | null
  created_at: string
}

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

// Revalidate cached user data in background after this interval
const REVALIDATE_AFTER_MS = 5 * 60 * 1000 // 5 minutes

// ─── localStorage helpers (user data only — token lives in HttpOnly cookie) ───

function readUserCache(): { user: AuthUser; ts: number } | null {
  try {
    const raw = localStorage.getItem('echoo_user')
    if (!raw) return null
    return { user: JSON.parse(raw), ts: Number(localStorage.getItem('echoo_user_ts') || '0') }
  } catch {
    return null
  }
}

function writeUserCache(u: AuthUser) {
  localStorage.setItem('echoo_user', JSON.stringify(u))
  localStorage.setItem('echoo_user_ts', Date.now().toString())
}

function clearUserCache() {
  localStorage.removeItem('echoo_user')
  localStorage.removeItem('echoo_user_ts')
  localStorage.removeItem('echoo_session')
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === 'undefined') return null
    return readUserCache()?.user ?? null
  })
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window === 'undefined') return true
    const hasSession = !!localStorage.getItem('echoo_session')
    if (!hasSession) return false
    return !readUserCache() // only loading if session exists but no cached user
  })

  const clearAuth = useCallback(() => {
    clearUserCache()
    setUser(null)
  }, [])

  const fetchUser = useCallback(async () => {
    try {
      const u = await api.get<AuthUser>('/auth/me')
      writeUserCache(u)
      setUser(u)
    } catch {
      clearAuth()
    }
  }, [clearAuth])

  useEffect(() => {
    // echoo_session is a non-sensitive flag — it just tells us whether to
    // bother hitting the server. The real auth token is in an HttpOnly cookie.
    const hasSession = !!localStorage.getItem('echoo_session')
    if (!hasSession) {
      setIsLoading(false)
      return
    }

    const cached = readUserCache()
    if (cached) {
      // Serve cache immediately — no network delay, no loading flash
      setUser(cached.user)
      setIsLoading(false)

      const isStale = Date.now() - cached.ts > REVALIDATE_AFTER_MS
      if (isStale) {
        // Stamp BEFORE the async call so React StrictMode's double-invoke
        // sees a fresh timestamp on its second run and skips a duplicate fetch
        localStorage.setItem('echoo_user_ts', Date.now().toString())
        fetchUser() // background revalidation — non-blocking
      }
    } else {
      // Session flag exists but no cached user — must fetch
      fetchUser().finally(() => setIsLoading(false))
    }
  }, [fetchUser])

  const login = async (email: string, password: string) => {
    // Backend sets HttpOnly echoo_token cookie; we just need the user data
    await api.post('/auth/login', { email, password })
    localStorage.setItem('echoo_session', '1')
    await fetchUser()
  }

  const register = async (email: string, password: string) => {
    await api.post('/auth/register', { email, password })
    localStorage.setItem('echoo_session', '1')
    await fetchUser()
  }

  const logout = async () => {
    clearAuth() // clear frontend state immediately
    await api.post('/auth/logout', {}).catch(() => {
      // best-effort — cookie will expire naturally if this fails
    })
  }

  const refreshUser = useCallback(async () => {
    // Stamp first to prevent the background-revalidation branch from
    // firing a duplicate call if this runs within the stale window
    localStorage.setItem('echoo_user_ts', Date.now().toString())
    await fetchUser()
  }, [fetchUser])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
