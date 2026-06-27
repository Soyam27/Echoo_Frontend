'use client'

import { Suspense, useState, useRef, useEffect, useCallback, useMemo } from "react"
import { flushSync } from "react-dom"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { useAuth } from "../../context/auth-context"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type Mode = 'analysis' | 'listing'

interface Source {
  id: string
  instagram_comment_id: string
  username: string
  text: string
  posted_at: string
}


interface Message {
  role: "ai" | "user"
  text: string
  streaming?: boolean
  error?: boolean
  sources?: Source[]
  isListing?: boolean
}

interface SidebarPost {
  id: string
  instagram_post_id: string
  caption: string | null
  media_url: string | null
  comment_count: number
  sync_status?: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
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

const SUGGESTED_ANALYSIS = [
  "What are the most common complaints?",
  "Which post has the most negative sentiment?",
  "Summarize the overall audience feedback",
  "Draft a reply to the most common concerns",
]

const SUGGESTED_LISTING = [
  "List all negative comments",
  "List comments that include questions",
  "List comments mentioning price or cost",
  "List the most recent feedback",
]

async function streamChat(
  question: string,
  postIds: string[],
  conversationId: string | null,
  onToken: (token: string) => void,
  onDone: (convId: string, sources: Source[]) => void,
) {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      question,
      post_ids: postIds,
      mode: 'analysis',
      conversation_id: conversationId,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Chat failed' }))
    throw new Error(err.detail || 'Chat request failed')
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data) continue
      if (data === '[DONE]') return
      const event = JSON.parse(data)
      if (event.type === 'text') onToken(event.content)
      else if (event.type === 'done') onDone(event.conversation_id, event.sources ?? [])
      else if (event.type === 'error') throw new Error(event.content)
    }
  }
}

function stripMeta(text: string): string {
  return text.replace(/\n?USED:[0-9,\s]+$/i, '').trimEnd()
}

function ChatContent() {
  const { user, isLoading } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()

  const postsParam = searchParams.get('posts') ?? ''
  const postIds = useMemo(() => postsParam.split(',').filter(Boolean), [postsParam])
  const initialQ = searchParams.get('q') ?? ''
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sidebarPosts, setSidebarPosts] = useState<SidebarPost[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const ids = (new URLSearchParams(window.location.search).get('posts') ?? '').split(',').filter(Boolean)
      if (!ids.length) return []
      // Prefer sessionStorage — set by posts page on navigate, has fresh media_url
      const session = sessionStorage.getItem('echoo_selected_posts')
      if (session) {
        const parsed = JSON.parse(session) as SidebarPost[]
        const filtered = parsed.filter(p => ids.includes(p.id))
        if (filtered.length > 0) return filtered
      }
      // Fallback: localStorage cache
      const cached = localStorage.getItem('echoo_all_posts')
      if (!cached) return []
      return (JSON.parse(cached) as SidebarPost[]).filter(p => ids.includes(p.id))
    } catch { return [] }
  })
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set())

  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => { setHasMounted(true) }, [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('analysis')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [syncingPosts, setSyncingPosts] = useState<Set<string>>(new Set())
  const [syncedPosts, setSyncedPosts] = useState<Set<string>>(new Set())

  const modeMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false)
      }
    }
    if (modeMenuOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [modeMenuOpen])
  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({})
  const [replyText, setReplyText] = useState<Record<string, string>>({})
  const [replySending, setReplySending] = useState<Record<string, boolean>>({})
  const [replySent, setReplySent] = useState<Record<string, boolean>>({})

  const bottomRef = useRef<HTMLDivElement>(null)
  const hasSentInitialRef = useRef(false)
  const sendRef = useRef<(text: string) => void>(() => {})
  const conversationIdRef = useRef<string | null>(null)

  // Auth guards
  useEffect(() => {
    if (isLoading) return
    if (!user) { router.replace('/login?redirect=/chat'); return }
    if (!user.instagram_id) { router.replace('/oauth/instagram'); return }
    if (postIds.length === 0) { router.replace('/posts'); return }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isLoading])


  // Seed syncingPosts from sidebar data; load sidebar from storage if initializer missed.
  useEffect(() => {
    if (postIds.length === 0) return
    const seed = (list: SidebarPost[]) => {
      const inProgress = new Set(
        list.filter(p => p.sync_status === 'pending' || p.sync_status === 'syncing').map(p => p.instagram_post_id)
      )
      if (inProgress.size > 0) setSyncingPosts(inProgress)
    }
    if (sidebarPosts.length > 0) { seed(sidebarPosts); return }

    // Lazy initializer might have missed (e.g. URL not yet set) — check storage here too
    try {
      const session = sessionStorage.getItem('echoo_selected_posts')
      if (session) {
        const filtered = (JSON.parse(session) as SidebarPost[]).filter(p => postIds.includes(p.id))
        if (filtered.length > 0) { setSidebarPosts(filtered); seed(filtered); return }
      }
      const cached = localStorage.getItem('echoo_all_posts')
      if (cached) {
        const filtered = (JSON.parse(cached) as SidebarPost[]).filter(p => postIds.includes(p.id))
        if (filtered.length > 0) { setSidebarPosts(filtered); seed(filtered); return }
      }
    } catch {}

    // True cache miss — fetch from server as last resort
    fetch(`${API_BASE}/posts`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: SidebarPost[]) => {
        try { localStorage.setItem('echoo_all_posts', JSON.stringify(data)) } catch {}
        const filtered = data.filter(p => postIds.includes(p.id))
        setSidebarPosts(filtered)
        seed(filtered)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postsParam])

  // Poll posts while any sync is in progress (catches refreshes mid-sync)
  useEffect(() => {
    if (syncingPosts.size === 0) return
    const interval = setInterval(() => {
      fetch(`${API_BASE}/posts`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((data: SidebarPost[]) => {
          try { localStorage.setItem('echoo_all_posts', JSON.stringify(data)) } catch {}
          const filtered = data.filter(p => postIds.includes(p.id))
          setSidebarPosts(filtered)
          const done = new Set<string>()
          filtered.forEach(p => {
            if (syncingPosts.has(p.instagram_post_id) &&
                p.sync_status !== 'pending' && p.sync_status !== 'syncing') {
              done.add(p.instagram_post_id)
            }
          })
          if (done.size > 0) {
            setSyncingPosts(prev => { const n = new Set(prev); done.forEach(id => n.delete(id)); return n })
            setSyncedPosts(prev => new Set([...prev, ...done]))
          }
        })
        .catch(() => {})
    }, 4000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncingPosts.size, postsParam])

  // Warn before refresh if AI is streaming or a reply is in flight / being typed
  useEffect(() => {
    const active =
      isStreaming ||
      Object.values(replySending).some(Boolean) ||
      Object.values(replyText).some(t => t.trim().length > 0)
    if (!active) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isStreaming, replySending, replyText])


  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return

    setMessages(prev => [
      ...prev,
      { role: 'user', text: trimmed },
      { role: 'ai', text: '', streaming: true, isListing: mode === 'listing' },
    ])
    setInput('')
    setIsStreaming(true)

    try {
      if (mode === 'listing') {
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            question: trimmed,
            post_ids: postIds,
            mode: 'listing',
            conversation_id: conversationIdRef.current,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Chat failed' }))
          throw new Error(err.detail || 'Chat request failed')
        }
        const data = await res.json()
        conversationIdRef.current = data.conversation_id
        setMessages(prev => {
          const lastIdx = prev.length - 1
          const last = prev[lastIdx]
          if (last?.role !== 'ai') return prev
          const updated = [...prev]
          updated[lastIdx] = { ...last, text: data.answer, streaming: false, sources: data.sources ?? [], isListing: true }
          return updated
        })
      } else {
        await streamChat(
          trimmed,
          postIds,
          conversationIdRef.current,
          (token) => {
            flushSync(() => {
              setMessages(prev => {
                const lastIdx = prev.length - 1
                const last = prev[lastIdx]
                if (last?.role !== 'ai') return prev
                const updated = [...prev]
                updated[lastIdx] = { ...last, text: last.text + token }
                return updated
              })
            })
          },
          (convId, sources) => {
            conversationIdRef.current = convId
            setMessages(prev => {
              const lastIdx = prev.length - 1
              const last = prev[lastIdx]
              if (last?.role !== 'ai') return prev
              const updated = [...prev]
              updated[lastIdx] = { ...last, streaming: false, sources }
              return updated
            })
          },
        )
      }
    } catch (err) {
      setMessages(prev => {
        const lastIdx = prev.length - 1
        const last = prev[lastIdx]
        if (last?.role !== 'ai') return prev
        const updated = [...prev]
        updated[lastIdx] = {
          ...last,
          streaming: false,
          error: true,
          text: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
    }
  }, [isStreaming, postIds, mode])

  // Keep sendRef current
  useEffect(() => { sendRef.current = send }, [send])

  // Auto-send initial question from home page
  useEffect(() => {
    if (!initialQ || hasSentInitialRef.current || postIds.length === 0) return
    hasSentInitialRef.current = true
    sendRef.current(initialQ)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ, postIds.length])


  function toggleSources(idx: number) {
    setExpandedSources(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  async function syncPost(instagram_post_id: string) {
    if (syncingPosts.has(instagram_post_id)) return
    setSyncingPosts(prev => new Set(prev).add(instagram_post_id))
    try {
      await fetch(`${API_BASE}/posts/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ post_ids: [instagram_post_id] }),
      })
      setSyncedPosts(prev => new Set(prev).add(instagram_post_id))
      setTimeout(() => {
        setSyncedPosts(prev => { const n = new Set(prev); n.delete(instagram_post_id); return n })
      }, 2000)
    } catch {
      // silently fail
    } finally {
      setSyncingPosts(prev => { const n = new Set(prev); n.delete(instagram_post_id); return n })
    }
  }

  async function sendReply(instagram_comment_id: string) {
    const text = (replyText[instagram_comment_id] ?? '').trim()
    if (!text) return
    setReplySending(prev => ({ ...prev, [instagram_comment_id]: true }))
    try {
      const res = await fetch(`${API_BASE}/comments/${instagram_comment_id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) throw new Error()
      setReplySent(prev => ({ ...prev, [instagram_comment_id]: true }))
      setReplyText(prev => ({ ...prev, [instagram_comment_id]: '' }))
      setReplyOpen(prev => ({ ...prev, [instagram_comment_id]: false }))
    } catch {
      // keep open so user can retry
    } finally {
      setReplySending(prev => ({ ...prev, [instagram_comment_id]: false }))
    }
  }

  function newChat() {
    setMessages([])
    setInput('')
    setExpandedSources(new Set())
    setReplyOpen({})
    setReplyText({})
    setReplySending({})
    setReplySent({})
    conversationIdRef.current = null
  }

  if (!hasMounted || isLoading || !user || !user.instagram_id || postIds.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#0e0e0e' }}>
        <div className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>Loading…</div>
      </div>
    )
  }

  // If state initializer missed localStorage (e.g. URL not yet set), read it now during render
  const displayPosts: SidebarPost[] = sidebarPosts.length > 0 ? sidebarPosts : (() => {
    try {
      const session = sessionStorage.getItem('echoo_selected_posts')
      if (session) {
        const filtered = (JSON.parse(session) as SidebarPost[]).filter(p => postIds.includes(p.id))
        if (filtered.length > 0) return filtered
      }
      const cached = localStorage.getItem('echoo_all_posts')
      if (cached) {
        const filtered = (JSON.parse(cached) as SidebarPost[]).filter(p => postIds.includes(p.id))
        if (filtered.length > 0) return filtered
      }
    } catch {}
    return []
  })()

  const hasMessages = messages.length > 0

  return (
    <div className="flex overflow-hidden relative" style={{ position: 'fixed', inset: 0, background: '#0e0e0e', zIndex: 10 }}>
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-10 lg:hidden"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`flex flex-col shrink-0 h-full absolute lg:relative z-20 transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{width: '268px',background: 'rgba(0,0,0,0.22)',backdropFilter: 'blur(52px)',WebkitBackdropFilter: 'blur(52px)',borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className=" pt-6 " style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Link href="/" className="flex items-center gap-2 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/echoo.png" alt="Echoo" className="absolute w-25 h-25 rounded-lg object-contain" />
          </Link>
         
        </div>

        {/* Post list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
          {(displayPosts.length > 0 ? displayPosts : postIds.map((id, i) => ({ id, caption: null, media_url: null, comment_count: 0, _placeholder: true, _index: i }))).map((post, i) => {
            const isPlaceholder = !('comment_count' in post) || (displayPosts.length === 0)
            const idx = displayPosts.length > 0 ? i : (post as { _index?: number })._index ?? i
            return (
              <div
                key={post.id}
                className="flex items-center gap-2.5 rounded-xl p-2.5"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                {!isPlaceholder && (post as SidebarPost).media_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(post as SidebarPost).media_url!}
                    alt=""
                    className="w-10 h-10 rounded-lg shrink-0 object-cover"
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-lg shrink-0"
                    style={{ background: `linear-gradient(135deg, ${GRADIENTS[idx % GRADIENTS.length][0]} 0%, ${GRADIENTS[idx % GRADIENTS.length][1]} 100%)` }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-white leading-snug line-clamp-2" style={{ opacity: 0.75 }}>
                    {isPlaceholder ? `Post ${idx + 1}` : ((post as SidebarPost).caption ?? 'No caption')}
                  </p>
                  {!isPlaceholder && (
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
                      {(post as SidebarPost).comment_count} comments
                    </p>
                  )}
                </div>
                {!isPlaceholder && (() => {
                  const igId = (post as SidebarPost).instagram_post_id
                  const syncing = syncingPosts.has(igId)
                  const synced = syncedPosts.has(igId)
                  return (
                    <button
                      onClick={() => syncPost(igId)}
                      disabled={syncing}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg transition-all"
                      style={{
                        background: synced ? 'rgba(120,210,85,0.10)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${synced ? 'rgba(120,210,85,0.28)' : 'rgba(255,255,255,0.08)'}`,
                        color: synced ? 'rgba(120,210,85,0.85)' : 'rgba(255,255,255,0.38)',
                      }}
                    >
                      {synced ? (
                        <>
                          <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
                            <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span style={{ fontSize: '10px' }}>Synced</span>
                        </>
                      ) : (
                        <>
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" className={syncing ? 'animate-spin' : ''}>
                            <path d="M9 5A4 4 0 1 1 5 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                            <path d="M5 1l1.5 1.5L5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span style={{ fontSize: '10px' }}>{syncing ? 'Syncing…' : 'Sync'}</span>
                        </>
                      )}
                    </button>
                  )
                })()}
              </div>
            )
          })}
        </div>

        <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Link
            href="/posts"
            className="btn-ghost flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Add more posts
          </Link>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-4 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.08)' }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
              aria-label="Toggle sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 4h10M2 7h10M2 10h10" stroke="rgba(255,255,255,0.6)" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
            <div>
              <h2 className="text-white font-medium text-sm">Comment Intelligence</h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Ask anything about your Instagram comments
              </p>
            </div>
          </div>
          <button
            onClick={newChat}
            disabled={isStreaming}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] sm:text-xs transition-all"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.09)',
              color: 'rgba(255,255,255,0.45)',
              opacity: isStreaming ? 0.4 : 1,
            }}
          >
            New chat
          </button>
        </div>

        {/* Messages — shared by both analysis and listing modes */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-4" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
              {!hasMessages && (
                <div className="relative flex flex-col items-center justify-center h-full pb-8 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/echoo.png" alt="Echoo" className="absolute top-20  sm:top-35 left-1/2 -translate-x-1/2 w-30 h-30 rounded-2xl object-contain " />
                  <p className="text-white font-medium mb-1.5" style={{ opacity: 0.75 }}>
                    {mode === 'listing' ? 'Ready to list' : 'Ready to analyze'}
                  </p>
                  <p className="text-sm max-w-xs" style={{ color: 'rgba(255,255,255,0.32)' }}>
                    {mode === 'listing'
                      ? 'Ask me to list or filter comments from your selected posts'
                      : 'Ask me anything about the comments on your selected posts'}
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className="flex flex-col gap-3">
                  <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className="max-w-xl rounded-2xl px-4 py-3 text-sm leading-relaxed"
                      style={
                        msg.role === 'user'
                          ? {
                              background: 'rgba(205,138,18,0.08)',
                              border: '1px solid rgba(205,138,18,0.18)',
                              color: 'rgba(255,255,255,0.85)',
                              borderBottomRightRadius: '4px',
                              backdropFilter: 'blur(18px)',
                              WebkitBackdropFilter: 'blur(48px)',
                            }
                          : {
                              background: msg.error ? 'rgba(220,60,60,0.06)' : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${msg.error ? 'rgba(220,60,60,0.20)' : 'rgba(255,255,255,0.07)'}`,
                              color: msg.error ? 'rgba(255,120,120,0.85)' : 'rgba(255,255,255,0.80)',
                              borderBottomLeftRadius: '4px',
                              backdropFilter: 'blur(16px)',
                              WebkitBackdropFilter: 'blur(56px)',
                            }
                      }
                    >
                      {msg.role === 'ai' && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium" style={{ color: 'rgba(205,138,18,0.8)' }}>Echoo AI</span>
                        </div>
                      )}

                      <span style={{ whiteSpace: 'pre-line' }}>
                        {msg.isListing && !msg.streaming
                          ? msg.sources && msg.sources.length > 0
                            ? `Found ${msg.sources.length} matching comment${msg.sources.length !== 1 ? 's' : ''}`
                            : 'No matching comments found.'
                          : stripMeta(msg.text)}
                      </span>

                      {msg.streaming && (
                        <span
                          className="inline-block animate-pulse ml-0.5"
                          style={{
                            width: msg.text ? '2px' : '8px',
                            height: '13px',
                            background: 'rgba(205,138,18,0.7)',
                            verticalAlign: 'text-bottom',
                            borderRadius: '1px',
                          }}
                        />
                      )}

                      {/* Analysis mode: collapsible sources inside bubble */}
                      {!msg.isListing && !msg.streaming && msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                          <button
                            onClick={() => toggleSources(i)}
                            className="text-xs transition-colors"
                            style={{ color: expandedSources.has(i) ? 'rgba(205,138,18,0.5)' : 'rgba(205,138,18,0.65)' }}
                          >
                            {expandedSources.has(i) ? 'Hide' : 'Show'} {msg.sources.length} source comment{msg.sources.length !== 1 ? 's' : ''}
                          </button>
                          {expandedSources.has(i) && (
                            <div className="mt-2 flex flex-col gap-2">
                              {msg.sources.map(s => (
                                <div
                                  key={s.id}
                                  className="px-3 py-2.5 rounded-xl text-xs"
                                  style={{
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.07)',
                                    color: 'rgba(255,255,255,0.55)',
                                  }}
                                >
                                  <span style={{ color: 'rgba(205,138,18,0.65)' }}>@{s.username}</span>
                                  {' — '}{s.text}
                                  {replySent[s.instagram_comment_id] ? (
                                    <p className="mt-1.5" style={{ color: 'rgba(120,210,85,0.7)' }}>✓ Reply sent</p>
                                  ) : replyOpen[s.instagram_comment_id] ? (
                                    <div className="mt-1.5 flex items-center gap-1.5">
                                      <input
                                        autoFocus
                                        type="text"
                                        value={replyText[s.instagram_comment_id] ?? ''}
                                        onChange={e => setReplyText(prev => ({ ...prev, [s.instagram_comment_id]: e.target.value }))}
                                        onKeyDown={e => { if (e.key === 'Enter') sendReply(s.instagram_comment_id) }}
                                        placeholder="Write a reply…"
                                        disabled={replySending[s.instagram_comment_id]}
                                        className="input-field flex-1"
                                        style={{ fontSize: '11px' }}
                                      />
                                      <button
                                        onClick={() => sendReply(s.instagram_comment_id)}
                                        disabled={replySending[s.instagram_comment_id] || !replyText[s.instagram_comment_id]?.trim()}
                                        className="px-2.5 py-1 rounded-lg transition-all"
                                        style={{ background: 'rgba(205,138,18,0.18)', border: '1px solid rgba(205,138,18,0.32)', color: 'rgba(205,138,18,0.9)', fontSize: '11px' }}
                                      >
                                        {replySending[s.instagram_comment_id] ? '…' : 'Send'}
                                      </button>
                                      <button
                                        onClick={() => setReplyOpen(prev => ({ ...prev, [s.instagram_comment_id]: false }))}
                                        style={{ color: 'rgba(255,255,255,0.28)', fontSize: '11px' }}
                                      >✕</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setReplyOpen(prev => ({ ...prev, [s.instagram_comment_id]: true }))}
                                      className="mt-1.5 block transition-colors"
                                      style={{ color: 'rgba(255,255,255,0.28)', fontSize: '11px' }}
                                    >↩ Reply</button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Listing mode: source tiles below the bubble */}
                  {msg.isListing && !msg.streaming && msg.role === 'ai' && msg.sources && msg.sources.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {msg.sources.map(s => (
                        <div
                          key={s.id}
                          className="rounded-xl px-3.5 py-3 flex flex-col gap-2"
                          style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium" style={{ color: 'rgba(205,138,18,0.8)' }}>@{s.username}</span>
                            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.22)' }}>{timeAgo(s.posted_at)}</span>
                          </div>
                          <p className="text-xs leading-relaxed line-clamp-4" style={{ color: 'rgba(255,255,255,0.65)' }}>{s.text}</p>
                          {replySent[s.instagram_comment_id] ? (
                            <p className="text-xs" style={{ color: 'rgba(120,210,85,0.7)' }}>✓ Reply sent</p>
                          ) : replyOpen[s.instagram_comment_id] ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                autoFocus
                                type="text"
                                value={replyText[s.instagram_comment_id] ?? ''}
                                onChange={e => setReplyText(prev => ({ ...prev, [s.instagram_comment_id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') sendReply(s.instagram_comment_id) }}
                                placeholder="Reply…"
                                disabled={replySending[s.instagram_comment_id]}
                                className="input-field flex-1"
                                style={{ fontSize: '11px' }}
                              />
                              <button
                                onClick={() => sendReply(s.instagram_comment_id)}
                                disabled={replySending[s.instagram_comment_id] || !replyText[s.instagram_comment_id]?.trim()}
                                className="px-2 py-1 rounded-lg transition-all"
                                style={{ background: 'rgba(205,138,18,0.18)', border: '1px solid rgba(205,138,18,0.32)', color: 'rgba(205,138,18,0.9)', fontSize: '11px' }}
                              >
                                {replySending[s.instagram_comment_id] ? '…' : 'Send'}
                              </button>
                              <button
                                onClick={() => setReplyOpen(prev => ({ ...prev, [s.instagram_comment_id]: false }))}
                                style={{ color: 'rgba(255,255,255,0.28)', fontSize: '11px' }}
                              >✕</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setReplyOpen(prev => ({ ...prev, [s.instagram_comment_id]: true }))}
                              className="text-left text-xs transition-colors w-fit"
                              style={{ color: 'rgba(255,255,255,0.28)' }}
                            >↩ Reply</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {!hasMessages && (
              <div className="px-4 sm:px-6 pb-3 flex gap-2 flex-wrap">
                {(mode === 'listing' ? SUGGESTED_LISTING : SUGGESTED_ANALYSIS).map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={isStreaming}
                    className="text-xs px-3 py-1.5 rounded-full transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      color: 'rgba(255,255,255,0.55)',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

        {/* Input bar */}
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 shrink-0">
          <div
            className="rounded-2xl"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
              backdropFilter: 'blur(56px)',
              WebkitBackdropFilter: 'blur(56px)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
            }}
          >
            <div className="px-5 pt-4 pb-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !isStreaming) send(input) }}
                placeholder={isStreaming ? 'Echoo is thinking…' : 'Ask about your comments…'}
                disabled={isStreaming}
                className="input-field text-sm"
              />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Link
                  href="/posts"
                  className="icon-btn w-7 h-7 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.09)',
                    color: 'rgba(255,255,255,0.45)',
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </Link>
                <div className="relative" ref={modeMenuRef}>
                  <button
                    onClick={() => setModeMenuOpen(v => !v)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{
                      background: modeMenuOpen ? 'rgba(205,138,18,0.10)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${modeMenuOpen ? 'rgba(205,138,18,0.30)' : 'rgba(255,255,255,0.10)'}`,
                      color: 'rgba(205,138,18,0.9)',
                    }}
                  >
                    {mode === 'analysis' ? 'Analysis' : 'Listing'}
                    <svg
                      width="8" height="5" viewBox="0 0 8 5" fill="none"
                      style={{ transform: modeMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                    >
                      <path d="M1 1l3 3 3-3" stroke="rgba(205,138,18,0.6)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {modeMenuOpen && (
                    <div
                      className="absolute bottom-full mb-2 left-0 rounded-xl overflow-hidden"
                      style={{
                        background: 'rgba(16,16,20,0.98)',
                        border: '1px solid rgba(255,255,255,0.09)',
                        backdropFilter: 'blur(24px)',
                        WebkitBackdropFilter: 'blur(24px)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
                        minWidth: '110px',
                      }}
                    >
                      {(['analysis', 'listing'] as Mode[]).map(m => (
                        <button
                          key={m}
                          onClick={() => { setMode(m); setModeMenuOpen(false) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all"
                          style={{
                            fontSize: '12px',
                            color: mode === m ? 'rgba(205,138,18,0.95)' : 'rgba(255,255,255,0.5)',
                            background: mode === m ? 'rgba(205,138,18,0.08)' : 'transparent',
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: mode === m ? 'rgba(205,138,18,0.9)' : 'rgba(255,255,255,0.18)' }}
                          />
                          {m === 'analysis' ? 'Analysis' : 'Listing'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.22)' }}>
                  {postIds.length} post{postIds.length !== 1 ? 's' : ''} selected
                </span>
              </div>
              <button
                onClick={() => { if (!isStreaming) send(input) }}
                disabled={isStreaming || !input.trim()}
                className="send-btn w-7 h-7 rounded-full flex items-center justify-center transition-all"
                style={{
                  background: input.trim() && !isStreaming ? 'rgba(205,138,18,0.25)' : 'rgba(255,255,255,0.1)',
                  border: input.trim() && !isStreaming ? '1px solid rgba(205,138,18,0.4)' : '1px solid rgba(255,255,255,0.12)',
                  color: input.trim() && !isStreaming ? 'rgba(205,138,18,0.95)' : 'rgba(255,255,255,0.55)',
                }}
              >
                {isStreaming ? (
                  <svg className="animate-spin" width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="6 6" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M10 6H2M6.5 2L10 6l-3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatFallback() {
  const [posts] = useState<SidebarPost[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('echoo_selected_posts') ?? '[]') } catch { return [] }
  })
  return (
    <div className="flex overflow-hidden" style={{ position: 'fixed', inset: 0, background: '#0e0e0e', zIndex: 10 }}>
      {/* Sidebar skeleton — hidden on mobile, visible on desktop */}
      <div
        className="hidden lg:flex flex-col shrink-0 h-full"
        style={{ width: '268px', background: 'rgba(0,0,0,0.22)', backdropFilter: 'blur(52px)', WebkitBackdropFilter: 'blur(52px)', borderRight: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="pt-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/echoo.png" alt="Echoo" className="absolute w-25 h-25 rounded-lg object-contain" />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
          {posts.length > 0 ? posts.map((post, i) => {
            const [gradFrom, gradTo] = GRADIENTS[i % GRADIENTS.length]
            return (
              <div key={post.id} className="flex items-center gap-2.5 rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {post.media_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.media_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg shrink-0" style={{ background: `linear-gradient(135deg, ${gradFrom} 0%, ${gradTo} 100%)` }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate" style={{ opacity: 0.68 }}>{post.caption ?? 'No caption'}</p>
                </div>
              </div>
            )
          }) : [0,1,2].map(i => (
            <div key={i} className="flex items-center gap-2.5 rounded-xl p-2.5 animate-pulse" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-10 h-10 rounded-lg shrink-0" style={{ background: 'rgba(255,255,255,0.07)' }} />
              <div className="flex-1 h-3 rounded" style={{ background: 'rgba(255,255,255,0.07)' }} />
            </div>
          ))}
        </div>
      </div>
      {/* Main area placeholder */}
      <div className="flex-1" />
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatContent />
    </Suspense>
  )
}
