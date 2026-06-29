'use client'

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "../../context/auth-context"
import { api } from "../../lib/api"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function ConnectPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  const [connectingIg, setConnectingIg] = useState(false)
  const [connectingYt, setConnectingYt] = useState(false)
  const [error, setError] = useState("")
  const [hasMounted, setHasMounted] = useState(false)

  useEffect(() => { setHasMounted(true) }, [])

  useEffect(() => {
    if (isLoading || !hasMounted) return
    if (!user) router.replace("/login")
  }, [user, isLoading, hasMounted, router])

  const igAccounts = user?.connected_accounts?.filter(a => a.platform === 'instagram') ?? []
  const ytAccounts = user?.connected_accounts?.filter(a => a.platform === 'youtube') ?? []
  const hasAny = (user?.connected_accounts?.length ?? 0) > 0

  async function handleConnectInstagram() {
    if (!user) return
    setError("")
    setConnectingIg(true)
    try {
      const res = await api.get<{ url: string }>('/instagram/connect')
      window.location.href = res.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Instagram connection")
      setConnectingIg(false)
    }
  }

  async function handleConnectYouTube() {
    if (!user) return
    setError("")
    setConnectingYt(true)
    try {
      const res = await fetch(`${API_BASE}/youtube/connect`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Failed to start YouTube connection")
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start YouTube connection")
      setConnectingYt(false)
    }
  }

  if (!hasMounted || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "#0a0a0a" }}>
        <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a" }}>
      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/echoo.png" alt="Echoo" className="w-36 h-36 rounded-2xl object-contain mx-auto absolute top-40 right-175" />
          <h1
            className="text-white font-semibold mb-2"
            style={{ fontSize: "22px", letterSpacing: "-0.025em" }}
          >
            {hasAny ? "Manage your channels" : "Connect a channel"}
          </h1>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.36)" }}>
            Connect your social accounts to analyze comments with AI
          </p>
        </div>

        {error && (
          <div
            className="w-full max-w-xs px-4 py-3 rounded-xl text-sm mb-5"
            style={{
              background: "rgba(220,50,50,0.10)",
              border: "1px solid rgba(220,50,50,0.25)",
              color: "rgba(255,120,120,0.9)",
            }}
          >
            {error}
          </div>
        )}

        {/* Platform grid */}
        <div className="grid grid-cols-2 gap-3" style={{ width: "100%", maxWidth: "400px" }}>

          {/* Instagram card */}
          <button
            onClick={handleConnectInstagram}
            disabled={connectingIg}
            className="flex flex-col items-center text-center rounded-2xl p-5 transition-all"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              cursor: connectingIg ? "default" : "pointer",
            }}
            onMouseEnter={e => { if (!connectingIg) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)" }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shrink-0"
              style={{ background: "linear-gradient(135deg, #833ab4 0%, #fd1d1d 52%, #fcb045 100%)" }}
            >
              {connectingIg ? (
                <svg className="animate-spin" width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="11" r="8" stroke="white" strokeWidth="2" strokeDasharray="12 12" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="2" width="20" height="20" rx="5" stroke="white" strokeWidth="1.8" />
                  <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" />
                  <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
                </svg>
              )}
            </div>

            <p className="text-sm font-semibold text-white mb-0.5">Instagram</p>
            <p className="text-xs leading-snug" style={{ color: "rgba(255,255,255,0.38)" }}>
              {igAccounts.length > 0
                ? `${igAccounts.length} account${igAccounts.length > 1 ? 's' : ''} connected`
                : "Business, Creator,\nor Personal"}
            </p>

            {igAccounts.length > 0 && (
              <div className="w-full mt-3 flex flex-col gap-1">
                {igAccounts.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "rgba(100,220,100,0.9)" }} />
                    <span className="text-[10px] text-white truncate" style={{ opacity: 0.72 }}>
                      @{a.instagram_username}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </button>

          {/* YouTube card */}
          <button
            onClick={handleConnectYouTube}
            disabled={connectingYt}
            className="flex flex-col items-center text-center rounded-2xl p-5 transition-all"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              cursor: connectingYt ? "default" : "pointer",
            }}
            onMouseEnter={e => { if (!connectingYt) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)" }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shrink-0"
              style={{ background: "#FF0000" }}
            >
              {connectingYt ? (
                <svg className="animate-spin" width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="11" r="8" stroke="white" strokeWidth="2" strokeDasharray="12 12" />
                </svg>
              ) : (
                <svg width="22" height="16" viewBox="0 0 24 17" fill="none">
                  <path d="M9.5 5L16.5 8.5L9.5 12V5Z" fill="white" />
                </svg>
              )}
            </div>

            <p className="text-sm font-semibold text-white mb-0.5">YouTube</p>
            <p className="text-xs leading-snug" style={{ color: "rgba(255,255,255,0.38)" }}>
              {ytAccounts.length > 0
                ? `${ytAccounts.length} channel${ytAccounts.length > 1 ? 's' : ''} connected`
                : "Channel"}
            </p>

            {ytAccounts.length > 0 && (
              <div className="w-full mt-3 flex flex-col gap-1">
                {ytAccounts.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "rgba(100,220,100,0.9)" }} />
                    <span className="text-[10px] text-white truncate" style={{ opacity: 0.72 }}>
                      {a.youtube_channel_name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </button>
        </div>

        {/* Actions */}
        <p className="text-center text-xs mt-5" style={{ color: "rgba(255,255,255,0.14)" }}>
          We never post on your behalf or access private messages
        </p>
      </div>
    </div>
  )
}
