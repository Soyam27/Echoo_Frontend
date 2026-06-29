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

export interface ConnectedAccount {
  id: string
  platform: 'instagram' | 'youtube'
  instagram_id: string | null
  instagram_username: string | null
  youtube_channel_id: string | null
  youtube_channel_name: string | null
}

export interface AuthUser {
  id: string
  email: string
  connected_accounts: ConnectedAccount[]
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

const REVALIDATE_AFTER_MS = 5 * 60 * 1000

// ─── localStorage helpers ─────────────────────────────────────────────────────

function readUserCache(): { user: AuthUser; ts: number } | null {
  try {
    const raw = localStorage.getItem('echoo_user')
    if (!raw) return null
    const data = JSON.parse(raw)
    // Invalidate old cache format (before connected_accounts was added)
    if (!Array.isArray(data.connected_accounts)) return null
    return { user: data as AuthUser, ts: Number(localStorage.getItem('echoo_user_ts') || '0') }
  } catch {
    return null
  }
}

function writeUserCache(u: AuthUser) {
  localStorage.setItem('echoo_session', '1')  // restore if localStorage was cleared
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
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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
    const cached = readUserCache()

    if (cached && localStorage.getItem('echoo_session')) {
      // Fast path: serve from cache immediately, revalidate in background if stale
      setUser(cached.user)
      setIsLoading(false)
      if (Date.now() - cached.ts > REVALIDATE_AFTER_MS) {
        fetchUser()
      }
    } else {
      // Cache missing or localStorage was cleared — verify with the cookie.
      // fetchUser() succeeds  → repopulates localStorage, user stays logged in.
      // fetchUser() fails 401 → clearAuth() runs, user is logged out.
      fetchUser().finally(() => setIsLoading(false))
    }
  }, [fetchUser])

  const login = async (email: string, password: string) => {
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
    clearAuth()
    await api.post('/auth/logout', {}).catch(() => {})
  }

  const refreshUser = useCallback(async () => {
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
