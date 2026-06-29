'use client'

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import SplineScene from "./spline-scene";
import { useAuth } from "./context/auth-context";
import Link from "next/link";

interface ChatHistoryEntry {
  id: string
  title: string
  post_ids: string[]
  created_at: string
}

interface LocalPost {
  id: string
  platform: 'instagram' | 'youtube'
  connected_account_id: string | null
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function PlatformBadge({ platform, label }: { platform: 'instagram' | 'youtube'; label: string }) {
  if (platform === 'instagram') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
        style={{ background: "rgba(131,58,180,0.18)", border: "1px solid rgba(131,58,180,0.3)", color: "rgba(200,130,255,0.9)" }}
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="17.5" cy="6.5" r="1.4" fill="currentColor" />
        </svg>
        {label}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ background: "rgba(255,0,0,0.12)", border: "1px solid rgba(255,80,80,0.28)", color: "rgba(255,110,110,0.9)" }}
    >
      <svg width="9" height="6" viewBox="0 0 24 17" fill="none">
        <rect x="0.5" y="0.5" width="23" height="16" rx="4.5" fill="currentColor" fillOpacity="0.8" />
        <path d="M9.5 5L16.5 8.5L9.5 12V5Z" fill="white" />
      </svg>
      {label}
    </span>
  )
}

export default function Home() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [showTooltip, setShowTooltip] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [history, setHistory] = useState<ChatHistoryEntry[]>([]);
  const [localPosts, setLocalPosts] = useState<LocalPost[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Change 3: link analysis state
  const [linkInput, setLinkInput] = useState("");
  const [linkAnalyzing, setLinkAnalyzing] = useState(false);
  const [linkError, setLinkError] = useState("");
  const linkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setHasMounted(true); }, []);
  useEffect(() => () => { if (linkPollRef.current) clearInterval(linkPollRef.current) }, []);

  useEffect(() => {
    const onScroll = () => {
      if (!overlayRef.current) return;
      overlayRef.current.style.opacity = String(Math.min(window.scrollY / 200, 1));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    if (!hasMounted || isLoading) return
    if (!user) {
      setHistoryLoading(false)
      return
    }
    try {
      const cached = localStorage.getItem('echoo_chat_history')
      if (cached) {
        setHistory(JSON.parse(cached))
        setHistoryLoading(false)
        return
      }
    } catch {}
    fetch(`${API_BASE}/chat/conversations`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: ChatHistoryEntry[]) => {
        setHistory(data.slice(0, 20))
        try { localStorage.setItem('echoo_chat_history', JSON.stringify(data.slice(0, 20))) } catch {}
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMounted, isLoading, user]);

  // Load posts from localStorage for account lookup in the chat history table
  useEffect(() => {
    if (!hasMounted) return
    try {
      const cached = localStorage.getItem('echoo_all_posts')
      if (cached) setLocalPosts(JSON.parse(cached) as LocalPost[])
    } catch {}
  }, [hasMounted]);

  const isLoggedIn = !isLoading && !!user;

  // Change 2: allow sending when logged out — save prompt + redirect to login
  function handleSend() {
    const q = input.trim();
    if (!isLoggedIn) {
      const redirect = q ? `/posts?q=${encodeURIComponent(q)}` : "/posts";
      window.open(`/login?redirect=${encodeURIComponent(redirect)}`, '_blank');
      return;
    }
    if (!user?.connected_accounts?.length) {
      window.open('/connect', '_blank');
    } else {
      window.open(q ? `/posts?q=${encodeURIComponent(q)}` : "/posts", '_blank');
    }
  }

  // Change 3: analyze any YouTube link
  async function handleAnalyzeLink() {
    const url = linkInput.trim()
    if (!url || linkAnalyzing) return
    setLinkError('')
    if (!isLoggedIn) {
      window.open('/login?redirect=/posts', '_blank')
      return
    }
    setLinkAnalyzing(true)
    try {
      const res = await fetch(`${API_BASE}/links/analyze`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLinkError(data.detail || 'Failed to analyze link')
        setLinkAnalyzing(false)
        return
      }
      const postId: string = data.post_id

      function _goToChat(statusData: Record<string, unknown>) {
        try {
          sessionStorage.setItem('echoo_selected_posts', JSON.stringify([statusData]))
          const ext = JSON.parse(localStorage.getItem('echoo_external_posts') || '[]') as Array<{id: string}>
          if (!ext.find(p => p.id === statusData.id)) {
            localStorage.setItem('echoo_external_posts', JSON.stringify([statusData, ...ext]))
          }
        } catch {}
        router.push(`/chat?posts=${postId}`)
      }

      if (data.sync_status === 'completed') {
        setLinkAnalyzing(false)
        _goToChat(data)
        return
      }
      let polls = 0
      linkPollRef.current = setInterval(async () => {
        if (++polls > 200) {
          clearInterval(linkPollRef.current!); linkPollRef.current = null
          setLinkError('Sync timed out — please try again.')
          setLinkAnalyzing(false)
          return
        }
        try {
          const sr = await fetch(`${API_BASE}/links/status/${postId}`, { credentials: 'include' })
          const status = await sr.json()
          if (status.sync_status === 'completed' || status.sync_status === 'failed') {
            clearInterval(linkPollRef.current!); linkPollRef.current = null
            setLinkAnalyzing(false)
            if (status.sync_status === 'completed') {
              _goToChat(status)
            } else {
              setLinkError('Could not fetch comments for this video.')
            }
          }
        } catch {}
      }, 3000)
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to analyze link')
      setLinkAnalyzing(false)
    }
  }

  // Helper: get account info for a conversation history entry
  function getEntryAccount(entry: ChatHistoryEntry): { platform: 'instagram' | 'youtube'; label: string } | null {
    const postId = entry.post_ids?.[0]
    if (!postId) return null
    const post = localPosts.find(p => p.id === postId)
    if (!post) return null
    const account = post.connected_account_id
      ? (user?.connected_accounts ?? []).find(a => a.id === post.connected_account_id)
      : null
    const label = account
      ? (post.platform === 'instagram'
          ? `@${account.instagram_username ?? 'Instagram'}`
          : (account.youtube_channel_name ?? 'YouTube'))
      : (post.platform === 'instagram' ? 'Instagram' : 'YouTube')
    return { platform: post.platform, label }
  }

  if (historyLoading) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-4"
        style={{ background: "#0e0e0e" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/echoo.png"
          alt="Loading"
          className="w-34 h-34 rounded-2xl object-contain animate-pulse"
          style={{ opacity: 0.65 }}
        />
      </div>
    )
  }

  return (
    <div className="relative flex flex-col min-h-screen">
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100vh', zIndex: 0 }}>
        <SplineScene />
        <div ref={overlayRef} style={{ position: 'absolute', inset: 0, background: '#0e0e0e', opacity: 0, pointerEvents: 'none' }} />
      </div>

      <div className="relative flex flex-col min-h-screen" style={{ zIndex: 1 }}>
        {/* Navbar */}
        <nav className="relative flex items-center px-4 sm:px-8 py-5">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/echoo.png" alt="Echoo" className="w-14 h-14 sm:w-20 sm:h-20 md:w-25 md:h-25 rounded-lg object-contain absolute left-4 sm:left-6" />
          </div>

          <div className="hidden md:flex items-center gap-7 absolute left-[50%] -translate-x-1/2">
            {["Echoo", "API", "Company", "Careers", "Pricing"].map((link) => (
              <a key={link} href="#" className="nav-link text-sm">{link}</a>
            ))}
          </div>

          <div className="ml-auto">
            {!hasMounted || isLoading ? (
              <div className="w-20 sm:w-24 h-8 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
            ) : isLoggedIn ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/posts"
                  className="try-btn px-3 sm:px-5 py-2 text-sm text-white rounded-full transition-all"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)" }}
                >
                  Posts
                </Link>
                <button
                  onClick={() => logout()}
                  className="hidden sm:block px-5 py-2 text-sm rounded-full transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.45)" }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                href="/login?redirect=/"
                className="try-btn px-3 sm:px-5 py-2 text-sm text-white rounded-full transition-all"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)" }}
              >
                Sign in
              </Link>
            )}
          </div>
        </nav>

        {/* Hero */}
        <main
          className="flex flex-col items-center flex-1 px-4 text-center pb-20 md:pb-40"
          style={{ paddingTop: "clamp(120px, 22vh, 220px)" }}
        >
          <h1
            className="text-white font-semibold mb-3"
            style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-0.02em", lineHeight: 1.2 }}
          >
            How can I assist you?
          </h1>

          <p className="mb-9 max-w-md text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>
            Quickly find answers, get assistance, and explore AI-powered insights—all in one place
          </p>

          {/* Chat input — enabled for everyone */}
          <div
            className="w-full"
            style={{
              maxWidth: "530px",
              borderRadius: "14px",
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(56px)",
              WebkitBackdropFilter: "blur(56px)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
            }}
          >
            <div className="px-5 pt-4 pb-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={isLoggedIn ? "What do you want to know?" : "Sign in to start — or type a question to continue"}
                className="w-full bg-transparent outline-none text-sm"
                style={{ color: "rgba(255,255,255,0.85)", caretColor: "rgba(255,255,255,0.7)" }}
              />
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <button
                  className="icon-btn w-7 h-7 rounded-full flex items-center justify-center transition-all"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)" }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
                <button className="icon-btn transition-all" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M2 13c1.5-1 3-3.5 3-5.5 0-1.1-.9-2-2-2s-2 .9-2 2c0 .55.22 1.05.59 1.41L2 10l1 3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    <path d="M5 7.5L11 2l2 2-6 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button className="icon-btn transition-all" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M5 9.5s.9 1.2 2.5 1.2 2.5-1.2 2.5-1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <circle cx="5.5" cy="6.5" r="0.8" fill="currentColor" />
                    <circle cx="9.5" cy="6.5" r="0.8" fill="currentColor" />
                  </svg>
                </button>
              </div>

              <div
                className="relative"
                onMouseEnter={() => !isLoggedIn && setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              >
                {showTooltip && !isLoggedIn && (
                  <div
                    className="absolute right-0 bottom-full mb-2 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap pointer-events-none"
                    style={{ background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)", boxShadow: "0 4px 16px rgba(0,0,0,0.4)" }}
                  >
                    Continue to login
                    <div className="absolute right-2.5 top-full w-0 h-0" style={{ borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid rgba(20,20,30,0.95)" }} />
                  </div>
                )}
                <button
                  onClick={handleSend}
                  className="send-btn w-7 h-7 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: "rgba(205,138,18,0.25)",
                    border: "1px solid rgba(205,138,18,0.4)",
                    color: "rgba(205,138,18,0.95)",
                    cursor: "pointer",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M10 6H2M6.5 2L10 6l-3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Logged-out nudge */}
          {hasMounted && !isLoading && !isLoggedIn && (
            <p className="mt-5 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              <Link href="/login" style={{ color: "rgba(205,138,18,0.7)" }}>Sign in</Link>{" "}
              to start analyzing your social comments with AI
            </p>
          )}

          {/* Change 3: Analyze a link */}
          {hasMounted && (
            <div className="w-full mt-5" style={{ maxWidth: "530px" }}>
              <div
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                {/* Icon: switches between YouTube and Instagram based on URL */}
                {linkInput && linkInput.includes('instagram.com') ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: "rgba(200,100,255,0.75)" }}>
                    <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2.2" />
                    <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2.2" />
                    <circle cx="17.5" cy="6.5" r="1.3" fill="currentColor" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 17" fill="none" style={{ color: "rgba(255,80,80,0.65)", flexShrink: 0 }}>
                    <rect x="0.5" y="0.5" width="23" height="16" rx="4.5" fill="currentColor" fillOpacity="0.6" />
                    <path d="M9.5 5L16.5 8.5L9.5 12V5Z" fill="white" />
                  </svg>
                )}
                <input
                  type="text"
                  value={linkInput}
                  onChange={e => { setLinkInput(e.target.value); setLinkError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleAnalyzeLink()}
                  placeholder="Paste a YouTube or Instagram URL to analyze comments…"
                  className="flex-1 bg-transparent outline-none text-xs"
                  style={{ color: "rgba(255,255,255,0.72)", caretColor: "rgba(255,255,255,0.7)" }}
                />
                <button
                  onClick={handleAnalyzeLink}
                  disabled={!linkInput.trim() || linkAnalyzing}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all shrink-0"
                  style={{
                    background: linkInput.trim() && !linkAnalyzing ? "rgba(205,138,18,0.2)" : "rgba(255,255,255,0.05)",
                    border: linkInput.trim() && !linkAnalyzing ? "1px solid rgba(205,138,18,0.35)" : "1px solid rgba(255,255,255,0.08)",
                    color: linkInput.trim() && !linkAnalyzing ? "rgba(205,138,18,0.9)" : "rgba(255,255,255,0.25)",
                    cursor: linkInput.trim() && !linkAnalyzing ? "pointer" : "default",
                  }}
                >
                  {linkAnalyzing ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin" width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6" />
                      </svg>
                      Fetching…
                    </span>
                  ) : 'Analyze'}
                </button>
              </div>
              {linkError && (
                <p className="mt-1.5 text-xs text-left px-1" style={{ color: "rgba(255,100,100,0.8)" }}>
                  {linkError}
                </p>
              )}
            </div>
          )}

          {/* Change 1: Recent chats as table */}
          {hasMounted && isLoggedIn && history.length > 0 && (
            <div className="w-full mt-30" style={{ maxWidth: "900px" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Recent chats
                </span>
                <button
                  onClick={() => {
                    localStorage.removeItem('echoo_chat_history')
                    setHistory([])
                  }}
                  className="text-xs transition-colors"
                  style={{ color: "rgba(255,255,255,0.18)" }}
                >
                  Clear
                </button>
              </div>

              {/* Table */}
              <div
                className="rounded-b-2xl overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                {/* Table header */}
                <div
                  className="grid px-4 py-2.5"
                  style={{
                    gridTemplateColumns: "72px 1fr 140px 100px",
                  }}
                >
                  {["ID", "CHAT", "ACCOUNT", "LAST MODIFIED"].map(col => (
                    <span
                      key={col}
                      className="text-[10px] font-semibold tracking-wider text-left"
                      style={{ color: "rgba(255,255,255,0.22)" }}
                    >
                      {col}
                    </span>
                  ))}
                </div>

                {/* Table rows */}
                {history.slice(0, 7).map((entry) => {
                  const acct = getEntryAccount(entry)
                  const shortId = entry.id.replace(/-/g, '').slice(0, 6).toUpperCase()
                  return (
                    <button
                      key={entry.id}
                      onClick={() => router.push(`/chat?posts=${entry.post_ids.join(',')}&conversation_id=${entry.id}`)}
                      className="grid w-full text-left px-4 py-3 transition-all"
                      style={{
                        gridTemplateColumns: "72px 1fr 140px 100px",
                        borderTop: "1px solid rgba(255,255,255,0.07)",
                        background: "transparent",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* ID */}
                      <span
                        className="text-xs font-mono"
                        style={{ color: "rgba(255,255,255,0.28)" }}
                      >
                        #{shortId}
                      </span>

                      {/* CHAT */}
                      <span
                        className="text-sm truncate pr-4"
                        style={{ color: "rgba(255,255,255,0.72)" }}
                      >
                        {entry.title}
                      </span>

                      {/* ACCOUNT */}
                      <div className="flex items-center">
                        {acct ? (
                          <PlatformBadge platform={acct.platform} label={acct.label} />
                        ) : (
                          <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>—</span>
                        )}
                      </div>

                      {/* LAST MODIFIED */}
                      <span
                        className="text-xs"
                        style={{ color: "rgba(255,255,255,0.28)" }}
                      >
                        {timeAgo(entry.created_at)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
