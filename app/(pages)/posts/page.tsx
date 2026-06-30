'use client'

import { useState, useEffect, useRef, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "../../context/auth-context"
import { api } from "../../lib/api"

interface PostResponse {
  id: string
  platform: 'instagram' | 'youtube'
  instagram_post_id: string | null
  youtube_video_id: string | null
  caption: string | null
  media_url: string | null
  media_type: string
  permalink: string
  posted_at: string
  sync_status: string
  comment_count: number
  synced_at: string | null
  connected_account_id: string | null
  is_external?: boolean
}

const CACHE_TTL_MS = 30_000

const GRADIENTS = [
  ["#1a0533", "#4a1080"],
  ["#1a0a00", "#6b3000"],
  ["#001a1a", "#004444"],
  ["#0a1a00", "#1a4000"],
  ["#1a0a1a", "#4a0844"],
  ["#1a1000", "#4a3000"],
  ["#00081a", "#001a40"],
  ["#1a001a", "#3a0030"],
  ["#001a0a", "#003020"],
]

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

type Tab = string // connected_account UUID

function PostsContent() {
  const { user, isLoading, refreshUser } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const justConnected = searchParams.get("connected") === "true"
  const q = searchParams.get("q") ?? ""

  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => { setHasMounted(true) }, [])

  // Restore home-page prompt from sessionStorage (saved when user was logged out)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('echoo_home_prompt')
      if (saved && !searchParams.get('q')) {
        const params = new URLSearchParams(searchParams.toString())
        params.set('q', saved)
        router.replace(`/posts?${params.toString()}`)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [posts, setPosts] = useState<PostResponse[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsError, setPostsError] = useState<string | null>(null)
  const [externalPosts, setExternalPosts] = useState<PostResponse[]>([])

  // Hydrate from localStorage cache immediately after mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem('echoo_all_posts')
      if (cached) {
        setPosts(JSON.parse(cached) as PostResponse[])
        setPostsLoading(false)
      }
    } catch {}
    try {
      const ext = localStorage.getItem('echoo_external_posts')
      if (ext) setExternalPosts(JSON.parse(ext) as PostResponse[])
    } catch {}
  }, [])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [authChecked, setAuthChecked] = useState(!justConnected)
  const [activeTab, setActiveTab] = useState<Tab>('')

  // Persist active tab — only write non-empty values so we don't clobber saved state on mount
  useEffect(() => {
    if (!activeTab) return
    try { localStorage.setItem('echoo_active_tab', activeTab) } catch {}
  }, [activeTab])

  // Link fetch state
  const [linkInput, setLinkInput] = useState("")
  const [linkFetching, setLinkFetching] = useState(false)
  const [linkError, setLinkError] = useState("")
  const linkPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => () => { if (linkPollRef.current) clearInterval(linkPollRef.current) }, [])

  async function handleFetchLink() {
    const url = linkInput.trim()
    if (!url || linkFetching) return
    setLinkError("")
    setLinkFetching(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/links/analyze`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLinkError(data.detail || "Failed to fetch link")
        setLinkFetching(false)
        return
      }
      const postId: string = data.post_id
      function _onDone(statusData: PostResponse) {
        setLinkFetching(false)
        setLinkInput("")
        setExternalPosts(prev => {
          const next = prev.find(p => p.id === postId) ? prev : [statusData, ...prev]
          try { localStorage.setItem("echoo_external_posts", JSON.stringify(next)) } catch {}
          return next
        })
        setActiveTab("__others__")
        setSelected(prev => new Set([...prev, postId]))
      }
      if (data.sync_status === "completed") {
        _onDone(data as PostResponse)
        return
      }
      let polls = 0
      linkPollRef.current = setInterval(async () => {
        if (++polls > 200) {
          clearInterval(linkPollRef.current!); linkPollRef.current = null
          setLinkError("Sync timed out — try again.")
          setLinkFetching(false)
          return
        }
        try {
          const sr = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/links/status/${postId}`,
            { credentials: "include" }
          )
          const status: PostResponse & { sync_status: string } = await sr.json()
          if (status.sync_status === "completed" || status.sync_status === "failed") {
            clearInterval(linkPollRef.current!); linkPollRef.current = null
            if (status.sync_status === "completed") {
              _onDone(status)
            } else {
              setLinkError("Could not fetch comments for this link.")
              setLinkFetching(false)
            }
          }
        } catch {}
      }, 3000)
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Failed")
      setLinkFetching(false)
    }
  }

  // Sync-before-navigate state
  const [syncing, setSyncing] = useState(false)
  const [syncChatUrl, setSyncChatUrl] = useState<string | null>(null)
  const [syncPostIds, setSyncPostIds] = useState<string[]>([])

  useEffect(() => {
    if (!justConnected) return
    refreshUser().then(() => setAuthChecked(true))
  }, [justConnected, refreshUser])

  useEffect(() => { router.prefetch('/chat') }, [router])

  useEffect(() => {
    if (!hasMounted || isLoading || !authChecked) return
    if (!user) {
      router.replace("/login?redirect=/posts")
      return
    }
    const accounts = user.connected_accounts ?? []
    if (accounts.length === 0) {
      router.replace("/connect")
      return
    }
    // Default to first account; preserve tab if it's still valid
    const savedTab = (() => { try { return localStorage.getItem('echoo_active_tab') || '' } catch { return '' } })()
    setActiveTab(prev => {
      const candidate = prev || savedTab
      if (candidate === '__others__') return candidate
      if (candidate && accounts.find(a => a.id === candidate)) return candidate
      return accounts[0].id
    })
  }, [hasMounted, user, isLoading, authChecked, router])

  useEffect(() => {
    const hasAny = (user?.connected_accounts?.length ?? 0) > 0
    if (!hasAny) return
    // Skip fetch if cache is fresh enough
    try {
      const ts = Number(localStorage.getItem('echoo_all_posts_ts') || '0')
      if (Date.now() - ts < CACHE_TTL_MS && localStorage.getItem('echoo_all_posts')) {
        setPostsLoading(false)
        return
      }
    } catch {}
    setPostsError(null)
    api.get<PostResponse[]>('/posts')
      .then(data => {
        setPosts(data)
        try {
          localStorage.setItem('echoo_all_posts', JSON.stringify(data))
          localStorage.setItem('echoo_all_posts_ts', Date.now().toString())
        } catch {}
      })
      .catch(err => setPostsError(err.message))
      .finally(() => setPostsLoading(false))
  }, [user?.connected_accounts?.length])

  // Fetch externally-analyzed posts (from "Analyze a link" feature)
  useEffect(() => {
    if (!user) return
    api.get<PostResponse[]>('/links/analyzed')
      .then(data => {
        setExternalPosts(data)
        try { localStorage.setItem('echoo_external_posts', JSON.stringify(data)) } catch {}
      })
      .catch(() => {})
  }, [user])

  // Per-account tab data derived from connected accounts
  const accountTabs = (user?.connected_accounts ?? []).map(account => ({
    id: account.id,
    platform: account.platform,
    label: account.platform === 'instagram'
      ? `@${account.instagram_username ?? 'Instagram'}`
      : (account.youtube_channel_name ?? 'YouTube'),
    posts: posts.filter(p => p.connected_account_id === account.id),
  }))
  const effectiveTab = activeTab || accountTabs[0]?.id || ''
  const isOthersTab = effectiveTab === '__others__'
  const tabPosts = isOthersTab
    ? externalPosts
    : (accountTabs.find(t => t.id === effectiveTab)?.posts ?? [])

  const totalComments = posts
    .filter(p => selected.has(p.id))
    .reduce((s, p) => s + p.comment_count, 0)
  const allTabSelected = tabPosts.length > 0 && tabPosts.every(p => selected.has(p.id))

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllTab() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allTabSelected) {
        tabPosts.forEach(p => next.delete(p.id))
      } else {
        tabPosts.forEach(p => next.add(p.id))
      }
      return next
    })
  }

  // Restore in-progress sync after refresh (expires after 10 minutes)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('echoo_pending_sync')
      if (!raw) return
      const parsed = JSON.parse(raw) as { chatUrl: string; postIds: string[]; createdAt?: number }
      if (parsed.createdAt && Date.now() - parsed.createdAt > 10 * 60 * 1000) {
        sessionStorage.removeItem('echoo_pending_sync')
        return
      }
      // If the localStorage cache already shows all posts completed, skip polling and go straight to chat
      try {
        const cached = localStorage.getItem('echoo_all_posts')
        if (cached) {
          const allPosts = JSON.parse(cached) as PostResponse[]
          const watched = allPosts.filter(p => parsed.postIds.includes(p.id))
          if (
            watched.length === parsed.postIds.length &&
            watched.every(p => p.sync_status === 'completed' || p.sync_status === 'failed')
          ) {
            sessionStorage.removeItem('echoo_pending_sync')
            router.push(parsed.chatUrl)
            return
          }
        }
      } catch {}
      setSelected(new Set(parsed.postIds))
      setSyncPostIds(parsed.postIds)
      setSyncChatUrl(parsed.chatUrl)
      setSyncing(true)
    } catch { sessionStorage.removeItem('echoo_pending_sync') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!syncing) return
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [syncing])

  // Poll until all selected posts finish syncing (max ~5 min)
  useEffect(() => {
    if (!syncing || !syncChatUrl || syncPostIds.length === 0) return
    let polls = 0
    const MAX_POLLS = 100
    const stopSync = () => {
      setSyncing(false)
      setSyncPostIds([])
      sessionStorage.removeItem('echoo_pending_sync')
    }
    const interval = setInterval(async () => {
      if (++polls > MAX_POLLS) {
        clearInterval(interval)
        stopSync()
        return
      }
      try {
        const data = await api.get<PostResponse[]>('/posts')
        setPosts(data)
        try {
          localStorage.setItem('echoo_all_posts', JSON.stringify(data))
          localStorage.setItem('echoo_all_posts_ts', Date.now().toString())
        } catch {}
        const watched = data.filter(p => syncPostIds.includes(p.id))
        const allDone = watched.length > 0 && watched.every(
          p => p.sync_status === 'completed' || p.sync_status === 'failed'
        )
        if (allDone) {
          clearInterval(interval)
          // Write completed post data into sessionStorage so the chat page
          // doesn't see stale "pending" status and kick off its own polling loop
          try {
            const freshSelected = data.filter(p => syncPostIds.includes(p.id))
            sessionStorage.setItem('echoo_selected_posts', JSON.stringify(freshSelected))
          } catch {}
          stopSync()
          router.push(syncChatUrl)
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [syncing, syncChatUrl, syncPostIds, router])

  async function handleAnalyze() {
    if (selected.size === 0 || syncing) return
    try { sessionStorage.removeItem('echoo_home_prompt') } catch {}
    const params = new URLSearchParams({ posts: [...selected].join(",") })
    if (q) params.set("q", q)
    const chatUrl = `/chat?${params.toString()}`

    // Include external posts (Others tab) alongside regular posts
    const allAvailablePosts = [...posts, ...externalPosts]
    const selectedPosts = allAvailablePosts.filter(p => selected.has(p.id))
    const needsSync = selectedPosts.filter(p => p.sync_status !== 'completed')

    try {
      sessionStorage.setItem('echoo_selected_posts', JSON.stringify(selectedPosts))
    } catch {}

    if (needsSync.length === 0) {
      router.push(chatUrl)
      return
    }

    // Use DB UUID for sync (works for both platforms)
    const dbIds = selectedPosts.map(p => p.id)
    setSyncing(true)
    setSyncChatUrl(chatUrl)
    setSyncPostIds(dbIds)
    try {
      sessionStorage.setItem('echoo_pending_sync', JSON.stringify({ chatUrl, postIds: dbIds, createdAt: Date.now() }))
      await api.post('/posts/sync', { post_ids: needsSync.map(p => p.id) })
    } catch {
      setSyncing(false)
      setSyncChatUrl(null)
      setSyncPostIds([])
      sessionStorage.removeItem('echoo_pending_sync')
    }
  }

  if (!hasMounted || isLoading || !authChecked || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Loading…</div>
      </div>
    )
  }

  if ((user.connected_accounts?.length ?? 0) === 0) return null

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-4 sm:px-8 py-4 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.055)" }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/echoo.png" alt="Echoo" className="w-14 h-14 sm:w-20 sm:h-20 md:w-25 md:h-25 rounded-lg object-contain absolute" />
        </Link>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {user.connected_accounts?.map(account => (
            <div
              key={account.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: account.platform === 'instagram' ? "rgba(120,210,85,0.95)" : "rgba(255,80,80,0.95)" }}
              />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.50)" }}>
                {account.platform === 'instagram'
                  ? `@${account.instagram_username}`
                  : account.youtube_channel_name}
              </span>
            </div>
          ))}
          <Link
            href="/connect"
            className="text-xs px-3 py-1.5 rounded-full transition-all"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.38)",
            }}
          >
            + Connect
          </Link>
        </div>
      </nav>

      {/* Header */}
      <div className="px-4 sm:px-8 pt-6 pb-3 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1
              className="text-white font-semibold"
              style={{ fontSize: "21px", letterSpacing: "-0.025em" }}
            >
              Select Posts
            </h1>
            <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.36)" }}>
              Choose posts whose comments you want to analyze with AI
            </p>
          </div>

          <div className="flex items-center gap-3 mt-0.5">
            {selected.size > 0 && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
                style={{
                  background: "rgba(205,138,18,0.10)",
                  border: "1px solid rgba(205,138,18,0.28)",
                  color: "rgba(205,138,18,0.88)",
                }}
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                  <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {selected.size} selected
              </div>
            )}
            {tabPosts.length > 0 && (
              <button
                onClick={toggleAllTab}
                className="text-xs transition-colors"
                style={{ color: "rgba(255,255,255,0.38)" }}
              >
                {allTabSelected ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 mt-4">
          {!postsLoading && !postsError && (
            <>
              <div
                className="px-3 py-1 rounded-full text-xs"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  color: "rgba(255,255,255,0.42)",
                }}
              >
                {tabPosts.length} posts
              </div>
              <div
                className="px-3 py-1 rounded-full text-xs"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  color: "rgba(255,255,255,0.42)",
                }}
              >
                {tabPosts.reduce((s, p) => s + p.comment_count, 0).toLocaleString()} total comments
              </div>
            </>
          )}
          {selected.size > 0 && (
            <div
              className="px-3 py-1 rounded-full text-xs"
              style={{
                background: "rgba(205,138,18,0.08)",
                border: "1px solid rgba(205,138,18,0.22)",
                color: "rgba(215,148,28,0.85)",
              }}
            >
              {totalComments.toLocaleString()} comments selected
            </div>
          )}
        </div>

        {/* Per-account tabs + Others */}
        {(accountTabs.length > 1 || externalPosts.length > 0) && (
          <div className="flex items-center gap-1 mt-4 flex-wrap">
            {accountTabs.map(tab => {
              const isActive = effectiveTab === tab.id
              const isIg = tab.platform === 'instagram'
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: isActive
                      ? isIg ? "rgba(131,58,180,0.15)" : "rgba(255,0,0,0.12)"
                      : "rgba(255,255,255,0.04)",
                    border: isActive
                      ? isIg ? "1px solid rgba(131,58,180,0.35)" : "1px solid rgba(255,0,0,0.28)"
                      : "1px solid rgba(255,255,255,0.07)",
                    color: isActive
                      ? isIg ? "rgba(200,130,255,0.9)" : "rgba(255,100,100,0.9)"
                      : "rgba(255,255,255,0.40)",
                  }}
                >
                  {isIg ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                      <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg width="12" height="9" viewBox="0 0 24 17" fill="none">
                      <rect x="0.5" y="0.5" width="23" height="16" rx="4.5" fill="currentColor" fillOpacity="0.8" />
                      <path d="M9.5 5L16.5 8.5L9.5 12V5Z" fill="white" />
                    </svg>
                  )}
                  {tab.label}
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[10px]"
                    style={{
                      background: isActive
                        ? isIg ? "rgba(131,58,180,0.25)" : "rgba(255,0,0,0.18)"
                        : "rgba(255,255,255,0.06)",
                      color: isActive
                        ? isIg ? "rgba(200,130,255,0.8)" : "rgba(255,100,100,0.8)"
                        : "rgba(255,255,255,0.30)",
                    }}
                  >
                    {tab.posts.length}
                  </span>
                </button>
              )
            })}

            {/* Others tab — externally analyzed links */}
            {externalPosts.length > 0 && (
              <button
                onClick={() => setActiveTab('__others__')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: isOthersTab ? "rgba(205,138,18,0.15)" : "rgba(255,255,255,0.04)",
                  border: isOthersTab ? "1px solid rgba(205,138,18,0.35)" : "1px solid rgba(255,255,255,0.07)",
                  color: isOthersTab ? "rgba(205,138,18,0.9)" : "rgba(255,255,255,0.40)",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 4.5v3M7 9v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Others
                <span
                  className="px-1.5 py-0.5 rounded-full text-[10px]"
                  style={{
                    background: isOthersTab ? "rgba(205,138,18,0.25)" : "rgba(255,255,255,0.06)",
                    color: isOthersTab ? "rgba(205,138,18,0.8)" : "rgba(255,255,255,0.30)",
                  }}
                >
                  {externalPosts.length}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Fetch from link — below tabs */}
        <div className="mt-3" style={{ maxWidth: "420px" }}>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {linkInput.includes("instagram.com") ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: "rgba(200,100,255,0.7)" }}>
                <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2.2" />
                <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2.2" />
                <circle cx="17.5" cy="6.5" r="1.3" fill="currentColor" />
              </svg>
            ) : (
              <svg width="12" height="9" viewBox="0 0 24 17" fill="none" style={{ color: "rgba(255,80,80,0.6)", flexShrink: 0 }}>
                <rect x="0.5" y="0.5" width="23" height="16" rx="4.5" fill="currentColor" fillOpacity="0.6" />
                <path d="M9.5 5L16.5 8.5L9.5 12V5Z" fill="white" />
              </svg>
            )}
            <input
              type="text"
              value={linkInput}
              onChange={e => { setLinkInput(e.target.value); setLinkError("") }}
              onKeyDown={e => e.key === "Enter" && handleFetchLink()}
              placeholder="Paste an Instagram or YouTube URL…"
              className="flex-1 bg-transparent outline-none text-xs"
              style={{ color: "rgba(255,255,255,0.72)", caretColor: "rgba(255,255,255,0.7)" }}
            />
            <button
              onClick={handleFetchLink}
              disabled={!linkInput.trim() || linkFetching}
              className="text-xs px-2.5 py-1 rounded-lg shrink-0 transition-all"
              style={{
                background: linkInput.trim() && !linkFetching ? "rgba(205,138,18,0.18)" : "rgba(255,255,255,0.04)",
                border: linkInput.trim() && !linkFetching ? "1px solid rgba(205,138,18,0.32)" : "1px solid rgba(255,255,255,0.07)",
                color: linkInput.trim() && !linkFetching ? "rgba(205,138,18,0.9)" : "rgba(255,255,255,0.22)",
                cursor: linkInput.trim() && !linkFetching ? "pointer" : "default",
              }}
            >
              {linkFetching ? (
                <span className="flex items-center gap-1">
                  <svg className="animate-spin" width="9" height="9" viewBox="0 0 10 10" fill="none">
                    <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6" />
                  </svg>
                  Fetching…
                </span>
              ) : "Fetch"}
            </button>
          </div>
          {linkError && (
            <p className="mt-1 text-xs px-1" style={{ color: "rgba(255,100,100,0.8)" }}>{linkError}</p>
          )}
        </div>
      </div>

      {/* Question banner */}
      {q && (
        <div
          className="mx-4 sm:mx-8 mb-2 px-4 py-3 rounded-xl flex items-center gap-3 shrink-0"
          style={{
            background: "rgba(205,138,18,0.07)",
            border: "1px solid rgba(205,138,18,0.22)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "rgba(205,138,18,0.75)", flexShrink: 0 }}>
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M7 4.5v3M7 9.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <p className="text-sm flex-1" style={{ color: "rgba(205,138,18,0.85)" }}>
            Answering: <span className="font-medium">&ldquo;{q}&rdquo;</span>
            <span className="ml-1.5" style={{ color: "rgba(205,138,18,0.5)" }}>— select posts to continue</span>
          </p>
          <button
            onClick={() => {
              try { sessionStorage.removeItem('echoo_home_prompt') } catch {}
              const params = new URLSearchParams(searchParams.toString())
              params.delete('q')
              router.replace(`/posts?${params.toString()}`)
            }}
            style={{ color: "rgba(205,138,18,0.5)", flexShrink: 0, lineHeight: 1 }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Posts grid */}
      <div
        className="flex-1 px-4 sm:px-8 pb-4 overflow-y-auto"
        style={{ scrollbarWidth: "none" } as React.CSSProperties}
      >
        {postsLoading && (
          <div className="flex items-center justify-center h-48">
            <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Loading posts…</div>
          </div>
        )}

        {postsError && (
          <div className="flex items-center justify-center h-48">
            <div className="text-sm" style={{ color: "rgba(255,80,80,0.75)" }}>{postsError}</div>
          </div>
        )}

        {!postsLoading && !postsError && tabPosts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
              {(() => {
                const tab = accountTabs.find(t => t.id === effectiveTab)
                return tab?.platform === 'instagram'
                  ? `No posts found for ${tab.label}.`
                  : `No videos found for ${tab?.label ?? 'this account'}.`
              })()}
            </div>
          </div>
        )}

        {!postsLoading && !postsError && tabPosts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tabPosts.map((post, idx) => {
              const isSelected = selected.has(post.id)
              const [gradFrom, gradTo] = GRADIENTS[idx % GRADIENTS.length]
              return (
                <button
                  key={post.id}
                  onClick={() => toggle(post.id)}
                  className="text-left rounded-2xl overflow-hidden w-full"
                  style={{
                    background: isSelected
                      ? "rgba(205,138,18,0.055)"
                      : "rgba(255,255,255,0.025)",
                    border: `1px solid ${isSelected ? "rgba(205,138,18,0.40)" : "rgba(255,255,255,0.07)"}`,
                    backdropFilter: "blur(40px)",
                    WebkitBackdropFilter: "blur(40px)",
                    boxShadow: isSelected
                      ? "0 0 0 1px rgba(205,138,18,0.10), 0 8px 32px rgba(140,80,0,0.14)"
                      : "none",
                    transition: "all 0.18s ease",
                  }}
                >
                  {/* Thumbnail */}
                  <div className="relative w-full" style={{ aspectRatio: "16/10" }}>
                    {post.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.media_url}
                        alt={post.caption ?? ""}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div
                        className="absolute inset-0"
                        style={{ background: `linear-gradient(135deg, ${gradFrom} 0%, ${gradTo} 100%)` }}
                      />
                    )}

                    <div
                      className="absolute inset-x-0 bottom-0 h-14 pointer-events-none"
                      style={{ background: "linear-gradient(to top, rgba(0,0,0,0.68) 0%, transparent 100%)" }}
                    />

                    {/* Platform badge */}
                    <div
                      className="absolute top-2.5 left-2.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                      style={{
                        background: "rgba(0,0,0,0.55)",
                        backdropFilter: "blur(8px)",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    >
                      {post.platform === 'instagram' ? (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                          <rect x="2" y="2" width="20" height="20" rx="5" stroke="rgba(200,130,255,0.9)" strokeWidth="2" />
                          <circle cx="12" cy="12" r="4.5" stroke="rgba(200,130,255,0.9)" strokeWidth="2" />
                          <circle cx="17.5" cy="6.5" r="1.2" fill="rgba(200,130,255,0.9)" />
                        </svg>
                      ) : (
                        <svg width="10" height="7" viewBox="0 0 24 17" fill="none">
                          <rect x="0.5" y="0.5" width="23" height="16" rx="4.5" fill="#FF0000" />
                          <path d="M9.5 5L16.5 8.5L9.5 12V5Z" fill="white" />
                        </svg>
                      )}
                    </div>

                    <div
                      className="absolute bottom-0 inset-x-0 px-3 pb-2 flex items-center gap-3 text-white"
                      style={{ fontSize: "11px", opacity: 0.82 }}
                    >
                      <span>💬 {post.comment_count.toLocaleString()}</span>
                      <span className="ml-auto" style={{ opacity: 0.55, fontSize: "10px" }}>
                        {timeAgo(post.posted_at)}
                      </span>
                    </div>

                    <div
                      className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{
                        background: isSelected ? "rgba(205,138,18,0.95)" : "rgba(0,0,0,0.48)",
                        border: `1.5px solid ${isSelected ? "rgba(228,160,40,0.85)" : "rgba(255,255,255,0.28)"}`,
                        backdropFilter: "blur(8px)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {isSelected && (
                        <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
                          <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Caption */}
                  <div className="px-3.5 py-3">
                    <p
                      className="text-sm text-white line-clamp-2 leading-snug"
                      style={{ opacity: post.caption ? 0.72 : 0.28 }}
                    >
                      {post.caption ?? "No caption"}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div
        className="shrink-0 px-4 sm:px-8 py-4 flex items-center justify-between gap-3"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(6,6,10,0.6)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
        }}
      >
        {syncing ? (
          <div>
            <p className="text-sm text-white" style={{ opacity: 0.82 }}>Syncing comments…</p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(205,138,18,0.72)" }}>
              {posts.filter(p => syncPostIds.includes(p.id) && p.sync_status === 'completed').length}
              /{syncPostIds.length} posts ready — please don&apos;t close this tab
            </p>
          </div>
        ) : selected.size === 0 ? (
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.32)" }}>
            Select posts to get started
          </p>
        ) : (
          <div>
            <p className="text-sm text-white" style={{ opacity: 0.82 }}>
              {selected.size} post{selected.size !== 1 ? "s" : ""} selected
            </p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(205,138,18,0.72)" }}>
              {totalComments.toLocaleString()} comments will be analyzed
            </p>
          </div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={selected.size === 0 || syncing}
          className="btn-gold flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium"
          style={{ opacity: selected.size === 0 || syncing ? 0.32 : 1 }}
        >
          {syncing ? (
            <>
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 8" />
              </svg>
              Syncing…
            </>
          ) : (
            <>
              Analyze with AI
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M11 6.5H2M7 2.5L11 6.5l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default function PostsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Loading…</div>
      </div>
    }>
      <PostsContent />
    </Suspense>
  )
}
