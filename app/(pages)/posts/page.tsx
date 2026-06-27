'use client'

import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "../../context/auth-context"
import { api } from "../../lib/api"

interface PostResponse {
  id: string
  instagram_post_id: string
  caption: string | null
  media_url: string | null
  media_type: string
  permalink: string
  posted_at: string
  sync_status: string
  comment_count: number
  synced_at: string | null
}

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

function PostsContent() {
  const { user, isLoading, refreshUser } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const justConnected = searchParams.get("connected") === "true"
  const q = searchParams.get("q") ?? ""

  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => { setHasMounted(true) }, [])

  const [posts, setPosts] = useState<PostResponse[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const cached = localStorage.getItem('echoo_all_posts')
      return cached ? (JSON.parse(cached) as PostResponse[]) : []
    } catch { return [] }
  })
  const [postsLoading, setPostsLoading] = useState(() => {
    if (typeof window === 'undefined') return false
    return !localStorage.getItem('echoo_all_posts')
  })
  const [postsError, setPostsError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [authChecked, setAuthChecked] = useState(!justConnected)

  // Sync-before-navigate state
  const [syncing, setSyncing] = useState(false)
  const [syncChatUrl, setSyncChatUrl] = useState<string | null>(null)
  const [syncPostIds, setSyncPostIds] = useState<string[]>([]) // DB ids being polled

  useEffect(() => {
    if (!justConnected) return
    refreshUser().then(() => setAuthChecked(true))
  }, [justConnected, refreshUser])

  // Prefetch chat route so JS chunk is ready before the user clicks Analyze
  useEffect(() => { router.prefetch('/chat') }, [router])

  useEffect(() => {
    if (!isLoading && authChecked) {
      if (!user) {
        router.replace("/login?redirect=/posts")
        return
      }
      if (!user.instagram_id) {
        router.replace("/oauth/instagram")
      }
    }
  }, [user, isLoading, authChecked, router])

  useEffect(() => {
    if (!user?.instagram_id) return
    setPostsError(null)
    api.get<PostResponse[]>('/posts')
      .then(data => {
        setPosts(data)
        try { localStorage.setItem('echoo_all_posts', JSON.stringify(data)) } catch {}
      })
      .catch(err => setPostsError(err.message))
      .finally(() => setPostsLoading(false))
  }, [user?.instagram_id])

  const totalComments = posts
    .filter(p => selected.has(p.id))
    .reduce((s, p) => s + p.comment_count, 0)
  const allSelected = posts.length > 0 && selected.size === posts.length

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(posts.map(p => p.id)))
  }

  // Restore in-progress sync after refresh
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('echoo_pending_sync')
      if (!raw) return
      const { chatUrl, postIds } = JSON.parse(raw) as { chatUrl: string; postIds: string[] }
      setSelected(new Set(postIds))
      setSyncPostIds(postIds)
      setSyncChatUrl(chatUrl)
      setSyncing(true)
    } catch { sessionStorage.removeItem('echoo_pending_sync') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Block refresh while sync is running
  useEffect(() => {
    if (!syncing) return
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [syncing])

  // Poll until all selected posts finish syncing, then navigate
  useEffect(() => {
    if (!syncing || !syncChatUrl || syncPostIds.length === 0) return
    const interval = setInterval(async () => {
      try {
        const data = await api.get<PostResponse[]>('/posts')
        setPosts(data)
        try { localStorage.setItem('echoo_all_posts', JSON.stringify(data)) } catch {}
        const watched = data.filter(p => syncPostIds.includes(p.id))
        const allDone = watched.length > 0 && watched.every(
          p => p.sync_status === 'completed' || p.sync_status === 'failed'
        )
        if (allDone) {
          clearInterval(interval)
          setSyncing(false)
          setSyncPostIds([])
          sessionStorage.removeItem('echoo_pending_sync')
          router.push(syncChatUrl)
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [syncing, syncChatUrl, syncPostIds, router])

  async function handleAnalyze() {
    if (selected.size === 0 || syncing) return
    const params = new URLSearchParams({ posts: [...selected].join(",") })
    if (q) params.set("q", q)
    const chatUrl = `/chat?${params.toString()}`

    const selectedPosts = posts.filter(p => selected.has(p.id))
    const needsSync = selectedPosts.filter(p => p.sync_status !== 'completed')

    // Pass selected post data to chat page so sidebar renders instantly
    try {
      sessionStorage.setItem('echoo_selected_posts', JSON.stringify(selectedPosts))
    } catch {}

    if (needsSync.length === 0) {
      router.push(chatUrl)
      return
    }

    const dbIds = selectedPosts.map(p => p.id)
    setSyncing(true)
    setSyncChatUrl(chatUrl)
    setSyncPostIds(dbIds)
    try {
      sessionStorage.setItem('echoo_pending_sync', JSON.stringify({ chatUrl, postIds: dbIds }))
      await api.post('/posts/sync', { post_ids: needsSync.map(p => p.instagram_post_id) })
    } catch {
      setSyncing(false)
      setSyncChatUrl(null)
      setSyncPostIds([])
      sessionStorage.removeItem('echoo_pending_sync')
    }
  }

  if (!hasMounted || isLoading || !authChecked || !user || !user.instagram_id) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Loading…</div>
      </div>
    )
  }

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

        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "rgba(120,210,85,0.95)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.50)" }}>
              @{user.instagram_username ?? "Instagram"} connected
            </span>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="px-4 sm:px-8 pt-6 pb-5 shrink-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
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
            {posts.length > 0 && (
              <button
                onClick={toggleAll}
                className="text-xs transition-colors"
                style={{ color: "rgba(255,255,255,0.38)" }}
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
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
                {posts.length} posts
              </div>
              <div
                className="px-3 py-1 rounded-full text-xs"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  color: "rgba(255,255,255,0.42)",
                }}
              >
                {posts.reduce((s, p) => s + p.comment_count, 0).toLocaleString()} total comments
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
          <p className="text-sm" style={{ color: "rgba(205,138,18,0.85)" }}>
            Answering: <span className="font-medium">&ldquo;{q}&rdquo;</span>
            <span className="ml-1.5" style={{ color: "rgba(205,138,18,0.5)" }}>— select posts to continue</span>
          </p>
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

        {!postsLoading && !postsError && posts.length === 0 && (
          <div className="flex items-center justify-center h-48">
            <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>No posts found on your Instagram account.</div>
          </div>
        )}

        {!postsLoading && !postsError && posts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {posts.map((post, idx) => {
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
              /{syncPostIds.length} posts ready — please don't close this tab
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
