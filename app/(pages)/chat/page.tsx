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
  platform: string
  external_comment_id: string
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
  platform: string
  instagram_post_id: string | null
  youtube_video_id: string | null
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

function parseApiMessage(m: { role: string; content: string }): Message {
  if (m.role === 'assistant') {
    try {
      const p = JSON.parse(m.content)
      if (p && p._listing === true) {
        return { role: 'ai', text: '', isListing: true, sources: p.sources ?? [] }
      }
    } catch {}
    return { role: 'ai', text: m.content }
  }
  return { role: 'user', text: m.content }
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
      // Fallback: merge regular + external localStorage caches
      const allCached: SidebarPost[] = []
      try { const r = localStorage.getItem('echoo_all_posts'); if (r) allCached.push(...JSON.parse(r)) } catch {}
      try { const e = localStorage.getItem('echoo_external_posts'); if (e) allCached.push(...JSON.parse(e)) } catch {}
      const filtered = allCached.filter(p => ids.includes(p.id))
      if (filtered.length > 0) return filtered
      return []
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
  const [sidebarSection, setSidebarSection] = useState<'posts' | 'sessions' | 'accounts'>('posts')
  const [sessions, setSessions] = useState<{ id: string; title: string; post_ids: string[]; created_at: string }[]>([])
  const [messagesLoading, setMessagesLoading] = useState(() => !!searchParams.get('conversation_id'))

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
  const conversationIdRef = useRef<string | null>(searchParams.get('conversation_id') || null)

  // Auth guards
  useEffect(() => {
    if (isLoading) return
    if (!user) { router.replace('/login?redirect=/chat'); return }
    if ((user.connected_accounts?.length ?? 0) === 0) { router.replace('/connect'); return }
    if (postIds.length === 0) { router.replace('/posts'); return }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isLoading])

  // Load + refresh conversation sessions for sidebar history
  const loadSessions = useCallback(() => {
    fetch(`${API_BASE}/chat/conversations`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { id: string; title: string; post_ids: string[]; created_at: string }[]) => {
        const trimmed = data.slice(0, 30)
        setSessions(trimmed)
        try { localStorage.setItem('echoo_chat_history', JSON.stringify(trimmed)) } catch {}
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!user) return
    try {
      const cached = localStorage.getItem('echoo_chat_history')
      if (cached) setSessions(JSON.parse(cached))
    } catch {}
    loadSessions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // When navigating from home history or refreshing: restore messages (cache-first)
  useEffect(() => {
    const convId = searchParams.get('conversation_id')
    if (!convId) return
    // Check per-session localStorage cache first — instant restore, no flash
    try {
      const cached = localStorage.getItem(`echoo_chat_messages_${convId}`)
      if (cached) {
        const parsed = JSON.parse(cached) as Message[]
        if (parsed.length > 0) {
          setMessages(parsed)
          setMessagesLoading(false)
          hasSentInitialRef.current = true
          return
        }
      }
    } catch {}
    // Cache miss — fetch from server
    fetch(`${API_BASE}/chat/conversations/${convId}/messages`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((msgs: { id: string; role: string; content: string }[]) => {
        if (msgs.length === 0) return
        const parsed = msgs.map(parseApiMessage)
        setMessages(parsed)
        try { localStorage.setItem(`echoo_chat_messages_${convId}`, JSON.stringify(parsed)) } catch {}
        hasSentInitialRef.current = true
      })
      .catch(() => {})
      .finally(() => setMessagesLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load sidebar post data from storage; fall back to a single server fetch on cache miss.
  // Never auto-starts syncingPosts — the posts page guarantees sync is complete before
  // navigating here. Manual re-sync uses the sidebar Sync button (syncPost()).
  useEffect(() => {
    if (postIds.length === 0) return
    if (sidebarPosts.length > 0) return

    // Lazy initializer might have missed (e.g. URL not yet set) — check storage here too
    try {
      const session = sessionStorage.getItem('echoo_selected_posts')
      if (session) {
        const filtered = (JSON.parse(session) as SidebarPost[]).filter(p => postIds.includes(p.id))
        if (filtered.length > 0) { setSidebarPosts(filtered); return }
      }
      const allCached: SidebarPost[] = []
      try { const r = localStorage.getItem('echoo_all_posts'); if (r) allCached.push(...JSON.parse(r)) } catch {}
      try { const e = localStorage.getItem('echoo_external_posts'); if (e) allCached.push(...JSON.parse(e)) } catch {}
      const filtered = allCached.filter(p => postIds.includes(p.id))
      if (filtered.length > 0) { setSidebarPosts(filtered); return }
    } catch {}

    // True cache miss — fetch from server as last resort (one-shot, no poll)
    fetch(`${API_BASE}/posts`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: SidebarPost[]) => {
        try { localStorage.setItem('echoo_all_posts', JSON.stringify(data)) } catch {}
        setSidebarPosts(data.filter(p => postIds.includes(p.id)))
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
            if (syncingPosts.has(p.id) &&
                p.sync_status !== 'pending' && p.sync_status !== 'syncing') {
              done.add(p.id)
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

  // Save current session messages to localStorage so refresh / session-switch is instant
  useEffect(() => {
    if (isStreaming) return
    const convId = conversationIdRef.current
    if (!convId || messages.length === 0) return
    try { localStorage.setItem(`echoo_chat_messages_${convId}`, JSON.stringify(messages)) } catch {}
  }, [messages, isStreaming])

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
        // Persist conversation_id in URL so refresh stays in this session
        const listingParams = new URLSearchParams(window.location.search)
        if (!listingParams.get('conversation_id')) {
          listingParams.set('conversation_id', data.conversation_id)
          router.replace(`/chat?${listingParams.toString()}`)
        }
        loadSessions()
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
            // Persist conversation_id in URL so refresh stays in this session
            const analysisParams = new URLSearchParams(window.location.search)
            if (!analysisParams.get('conversation_id')) {
              analysisParams.set('conversation_id', convId)
              router.replace(`/chat?${analysisParams.toString()}`)
            }
            setMessages(prev => {
              const lastIdx = prev.length - 1
              const last = prev[lastIdx]
              if (last?.role !== 'ai') return prev
              const updated = [...prev]
              updated[lastIdx] = { ...last, streaming: false, sources }
              return updated
            })
            loadSessions() // refresh sidebar history after each reply
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

  async function syncPost(postDbId: string) {
    if (syncingPosts.has(postDbId)) return
    setSyncingPosts(prev => new Set(prev).add(postDbId))
    try {
      await fetch(`${API_BASE}/posts/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ post_ids: [postDbId] }),
      })
      setSyncedPosts(prev => new Set(prev).add(postDbId))
      setTimeout(() => {
        setSyncedPosts(prev => { const n = new Set(prev); n.delete(postDbId); return n })
      }, 2000)
    } catch {
      // silently fail
    } finally {
      setSyncingPosts(prev => { const n = new Set(prev); n.delete(postDbId); return n })
    }
  }

  async function sendReply(commentId: string) {
    const text = (replyText[commentId] ?? '').trim()
    if (!text) return
    setReplySending(prev => ({ ...prev, [commentId]: true }))
    try {
      const res = await fetch(`${API_BASE}/comments/${commentId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) throw new Error()
      setReplySent(prev => ({ ...prev, [commentId]: true }))
      setReplyText(prev => ({ ...prev, [commentId]: '' }))
      setReplyOpen(prev => ({ ...prev, [commentId]: false }))
    } catch {
      // keep open so user can retry
    } finally {
      setReplySending(prev => ({ ...prev, [commentId]: false }))
    }
  }

  function newChat() {
    if (isStreaming) return
    setMessages([])
    setInput('')
    setExpandedSources(new Set())
    setReplyOpen({})
    setReplyText({})
    setReplySending({})
    setReplySent({})
    conversationIdRef.current = null
    hasSentInitialRef.current = true // don't re-fire initial ?q= on new chat
    const params = new URLSearchParams(searchParams.toString())
    params.delete('conversation_id')
    router.replace(`/chat?${params.toString()}`)
  }

  async function openSession(session: { id: string; title: string; post_ids: string[]; created_at: string }) {
    if (isStreaming) return

    function applySession(parsed: Message[]) {
      setMessages(parsed)
      setExpandedSources(new Set())
      setReplyOpen({})
      setReplyText({})
      setReplySending({})
      setReplySent({})
      conversationIdRef.current = session.id
      hasSentInitialRef.current = true
      if (session.post_ids.length > 0) {
        try {
          const allCached: SidebarPost[] = []
          try { const r = localStorage.getItem('echoo_all_posts'); if (r) allCached.push(...JSON.parse(r)) } catch {}
          try { const e = localStorage.getItem('echoo_external_posts'); if (e) allCached.push(...JSON.parse(e)) } catch {}
          const filtered = allCached.filter(p => session.post_ids.includes(p.id))
          if (filtered.length > 0) setSidebarPosts(filtered)
        } catch {}
        router.replace(`/chat?posts=${session.post_ids.join(',')}&conversation_id=${session.id}`)
      }
    }

    // Check per-session cache first — avoids loading screen on session switch
    try {
      const cached = localStorage.getItem(`echoo_chat_messages_${session.id}`)
      if (cached) {
        const parsed = JSON.parse(cached) as Message[]
        if (parsed.length > 0) {
          applySession(parsed)
          return
        }
      }
    } catch {}

    // Cache miss — fetch from server
    setMessagesLoading(true)
    try {
      const r = await fetch(`${API_BASE}/chat/conversations/${session.id}/messages`, { credentials: 'include' })
      if (!r.ok) return
      const msgs: { id: string; role: string; content: string }[] = await r.json()
      const parsed = msgs.map(parseApiMessage)
      try { localStorage.setItem(`echoo_chat_messages_${session.id}`, JSON.stringify(parsed)) } catch {}
      applySession(parsed)
    } catch {}
    finally { setMessagesLoading(false) }
  }

  if (!hasMounted || isLoading || !user || (user.connected_accounts?.length ?? 0) === 0 || postIds.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#0e0e0e' }}>
        <div className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>Loading…</div>
      </div>
    )
  }

  if (messagesLoading) {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-4" style={{ background: '#0e0e0e' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/echoo.png" alt="Echoo" className="w-12 h-12 rounded-2xl object-contain animate-pulse" style={{ opacity: 0.7 }} />
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.38)' }}>Loading chats…</p>
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
      const allCached: SidebarPost[] = []
      try { const r = localStorage.getItem('echoo_all_posts'); if (r) allCached.push(...JSON.parse(r)) } catch {}
      try { const e = localStorage.getItem('echoo_external_posts'); if (e) allCached.push(...JSON.parse(e)) } catch {}
      const filtered = allCached.filter(p => postIds.includes(p.id))
      if (filtered.length > 0) return filtered
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
        {/* Section switcher */}
        <div className="px-3 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex gap-1">
            {([
              { key: 'posts', label: `Posts (${displayPosts.length || postIds.length})` },
              { key: 'sessions', label: 'History' },
              { key: 'accounts', label: 'Accounts' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSidebarSection(key)}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all"
                style={{
                  background: sidebarSection === key ? 'rgba(255,255,255,0.09)' : 'transparent',
                  color: sidebarSection === key ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.32)',
                  border: sidebarSection === key ? '1px solid rgba(255,255,255,0.10)' : '1px solid transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Posts section */}
        {sidebarSection === 'posts' && (
          <>
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
                      const dbId = (post as SidebarPost).id
                      const syncing = syncingPosts.has(dbId)
                      const synced = syncedPosts.has(dbId)
                      return (
                        <button
                          onClick={() => syncPost(dbId)}
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
            <div className="p-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
          </>
        )}

        {/* Sessions / History section */}
        {sidebarSection === 'sessions' && (
          <>
            <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
              {sessions.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'rgba(255,255,255,0.25)' }}>No sessions yet</p>
              ) : sessions.map(session => {
                const isCurrent = session.id === conversationIdRef.current
                return (
                  <button
                    key={session.id}
                    onClick={() => openSession(session)}
                    className="w-full text-left rounded-xl px-3 py-2.5 transition-all"
                    style={{
                      background: isCurrent ? 'rgba(205,138,18,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isCurrent ? 'rgba(205,138,18,0.25)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    <p className="text-xs leading-snug line-clamp-2" style={{ color: 'rgba(255,255,255,0.70)' }}>
                      {session.title}
                    </p>
                    <p className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {timeAgo(session.created_at)}
                    </p>
                  </button>
                )
              })}
            </div>
            <div className="p-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={newChat}
                className="btn-ghost flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                New chat
              </button>
            </div>
          </>
        )}

        {/* Accounts section */}
        {sidebarSection === 'accounts' && (
          <>
            <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
              {(user.connected_accounts ?? []).map(account => {
                const isIg = account.platform === 'instagram'
                const name = isIg ? `@${account.instagram_username ?? ''}` : (account.youtube_channel_name ?? 'YouTube')
                return (
                  <div
                    key={account.id}
                    className="flex items-center gap-2.5 rounded-xl p-2.5"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    {/* Platform icon */}
                    <div
                      className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center"
                      style={{
                        background: isIg
                          ? 'linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)'
                          : 'rgba(220,0,0,0.80)',
                      }}
                    >
                      {isIg ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <rect x="2" y="2" width="20" height="20" rx="5" stroke="white" strokeWidth="1.8" />
                          <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" />
                          <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
                        </svg>
                      ) : (
                        <svg width="16" height="11" viewBox="0 0 24 17" fill="none">
                          <rect x="0.5" y="0.5" width="23" height="16" rx="4.5" fill="white" fillOpacity="0.15" />
                          <path d="M9.5 5L16.5 8.5L9.5 12V5Z" fill="white" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white font-medium truncate" style={{ opacity: 0.82 }}>{name}</p>
                      <p className="text-[10px] mt-0.5 capitalize" style={{ color: 'rgba(255,255,255,0.30)' }}>
                        {account.platform}
                      </p>
                    </div>
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: 'rgba(120,210,85,0.85)' }}
                      title="Connected"
                    />
                  </div>
                )
              })}
            </div>
            <div className="p-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <Link
                href="/connect"
                className="btn-ghost flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Add account
              </Link>
            </div>
          </>
        )}
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
                Ask anything about your comments
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
                                  {replySent[s.external_comment_id] ? (
                                    <p className="mt-1.5" style={{ color: 'rgba(120,210,85,0.7)' }}>✓ Reply sent</p>
                                  ) : replyOpen[s.external_comment_id] ? (
                                    <div className="mt-1.5 flex items-center gap-1.5">
                                      <input
                                        autoFocus
                                        type="text"
                                        value={replyText[s.external_comment_id] ?? ''}
                                        onChange={e => setReplyText(prev => ({ ...prev, [s.external_comment_id]: e.target.value }))}
                                        onKeyDown={e => { if (e.key === 'Enter') sendReply(s.external_comment_id) }}
                                        placeholder="Write a reply…"
                                        disabled={replySending[s.external_comment_id]}
                                        className="input-field flex-1"
                                        style={{ fontSize: '11px' }}
                                      />
                                      <button
                                        onClick={() => sendReply(s.external_comment_id)}
                                        disabled={replySending[s.external_comment_id] || !replyText[s.external_comment_id]?.trim()}
                                        className="px-2.5 py-1 rounded-lg transition-all"
                                        style={{ background: 'rgba(205,138,18,0.18)', border: '1px solid rgba(205,138,18,0.32)', color: 'rgba(205,138,18,0.9)', fontSize: '11px' }}
                                      >
                                        {replySending[s.external_comment_id] ? '…' : 'Send'}
                                      </button>
                                      <button
                                        onClick={() => setReplyOpen(prev => ({ ...prev, [s.external_comment_id]: false }))}
                                        style={{ color: 'rgba(255,255,255,0.28)', fontSize: '11px' }}
                                      >✕</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setReplyOpen(prev => ({ ...prev, [s.external_comment_id]: true }))}
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
                          {replySent[s.external_comment_id] ? (
                            <p className="text-xs" style={{ color: 'rgba(120,210,85,0.7)' }}>✓ Reply sent</p>
                          ) : replyOpen[s.external_comment_id] ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                autoFocus
                                type="text"
                                value={replyText[s.external_comment_id] ?? ''}
                                onChange={e => setReplyText(prev => ({ ...prev, [s.external_comment_id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') sendReply(s.external_comment_id) }}
                                placeholder="Reply…"
                                disabled={replySending[s.external_comment_id]}
                                className="input-field flex-1"
                                style={{ fontSize: '11px' }}
                              />
                              <button
                                onClick={() => sendReply(s.external_comment_id)}
                                disabled={replySending[s.external_comment_id] || !replyText[s.external_comment_id]?.trim()}
                                className="px-2 py-1 rounded-lg transition-all"
                                style={{ background: 'rgba(205,138,18,0.18)', border: '1px solid rgba(205,138,18,0.32)', color: 'rgba(205,138,18,0.9)', fontSize: '11px' }}
                              >
                                {replySending[s.external_comment_id] ? '…' : 'Send'}
                              </button>
                              <button
                                onClick={() => setReplyOpen(prev => ({ ...prev, [s.external_comment_id]: false }))}
                                style={{ color: 'rgba(255,255,255,0.28)', fontSize: '11px' }}
                              >✕</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setReplyOpen(prev => ({ ...prev, [s.external_comment_id]: true }))}
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
                <div
                  className="flex items-center rounded-lg p-0.5"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {(['analysis', 'listing'] as Mode[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className="text-xs px-3 py-1 rounded-md transition-all"
                      style={{
                        background: mode === m ? 'rgba(205,138,18,0.18)' : 'transparent',
                        border: mode === m ? '1px solid rgba(205,138,18,0.35)' : '1px solid transparent',
                        color: mode === m ? 'rgba(205,138,18,0.95)' : 'rgba(255,255,255,0.38)',
                      }}
                    >
                      {m === 'analysis' ? 'Analysis' : 'Listing'}
                    </button>
                  ))}
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
