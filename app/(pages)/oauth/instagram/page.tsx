'use client'

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../context/auth-context";
import { api } from "../../../lib/api";

function OAuthContent() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect() {
    if (!user) return;
    setError("");
    setConnecting(true);
    try {
      const res = await api.get<{ url: string }>('/instagram/connect');
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Instagram");
      setConnecting(false);
    }
  }

  async function handleSkip() {
    await refreshUser();
    router.push(q ? `/posts?q=${encodeURIComponent(q)}` : "/posts");
  }

  function handleContinue() {
    router.push(q ? `/posts?q=${encodeURIComponent(q)}` : "/posts");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12" style={{ position: "relative" }}>
      <div style={{ position: "fixed", inset: 0, background: "#0e0e0e", zIndex: -1 }} />
      {/* Navbar */}
      <div className="absolute top-0 left-0 right-0 flex items-center px-8 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/echoo.png" alt="Echoo" className="w-25 h-25 rounded-lg object-contain absolute" />
        </Link>
      </div>

      {/* Card */}
      <div
        className="glass-card w-full"
        style={{
          maxWidth: "420px",
          borderRadius: "22px",
          padding: "40px 36px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        {/* Already connected state */}
        {user?.instagram_id && (
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl mb-5"
            style={{
              background: "rgba(80,200,80,0.08)",
              border: "1px solid rgba(80,200,80,0.22)",
            }}
          >
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "rgba(100,220,100,0.9)" }} />
            <p className="text-sm" style={{ color: "rgba(120,230,120,0.9)" }}>
              Connected as <strong>@{user.instagram_username}</strong>
            </p>
          </div>
        )}

        {/* Logos connection row */}
        <div className="flex items-center justify-center gap-4 mb-7">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/echoo.png" alt="Echoo" className="w-12 h-12 rounded-xl object-contain shrink-0" />

          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-full"
                style={{
                  width: i === 1 ? "5px" : "3px",
                  height: i === 1 ? "5px" : "3px",
                  background: i === 1 ? "rgba(205,138,18,0.7)" : "rgba(255,255,255,0.2)",
                }}
              />
            ))}
          </div>

          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="2" width="20" height="20" rx="5" stroke="white" strokeWidth="1.8" />
              <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" />
              <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
            </svg>
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-7">
          <h1 className="text-white font-semibold mb-2" style={{ fontSize: "20px", letterSpacing: "-0.02em" }}>
            Connect Instagram
          </h1>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
            Echoo needs access to your Instagram account to analyze post comments and generate insights.
          </p>
        </div>

        {/* Permissions list */}
        <div
          className="rounded-xl mb-5 overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.07)" }}
        >
          {[
            { icon: "📸", label: "View your posts", desc: "Read captions and media" },
            { icon: "💬", label: "Read comments", desc: "Access comment threads" },
            { icon: "👤", label: "Basic profile info", desc: "Username and profile picture" },
          ].map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                background: "rgba(255,255,255,0.018)",
                borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none",
              }}
            >
              <span style={{ fontSize: "16px" }}>{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{item.label}</p>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.32)" }}>{item.desc}</p>
              </div>
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "rgba(205,138,18,0.18)", border: "1px solid rgba(205,138,18,0.35)" }}
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                  <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="rgba(205,138,18,0.95)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div
            className="px-4 py-3 rounded-xl text-sm mb-4"
            style={{
              background: "rgba(220,50,50,0.10)",
              border: "1px solid rgba(220,50,50,0.25)",
              color: "rgba(255,120,120,0.9)",
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          {user?.instagram_id ? (
            <button
              onClick={handleContinue}
              className="flex items-center justify-center gap-2.5 w-full py-3 rounded-xl text-sm font-medium text-white transition-all btn-gold"
            >
              Continue to Posts
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center justify-center gap-2.5 w-full py-3 rounded-xl text-sm font-medium text-white transition-all"
              style={{
                background: connecting
                  ? "rgba(130,50,160,0.5)"
                  : "linear-gradient(135deg, #833ab4 0%, #fd1d1d 55%, #fcb045 100%)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 4px 20px rgba(130,50,160,0.25)",
                opacity: connecting ? 0.8 : 1,
              }}
            >
              {connecting ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.5" strokeDasharray="8 8" />
                  </svg>
                  Connecting…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="2" y="2" width="20" height="20" rx="5" stroke="white" strokeWidth="1.8" />
                    <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" />
                    <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
                  </svg>
                  Connect with Instagram
                </>
              )}
            </button>
          )}

          <button
            onClick={handleSkip}
            className="btn-ghost w-full py-3 rounded-xl text-sm font-medium text-center block"
          >
            Skip for now
          </button>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: "rgba(255,255,255,0.20)" }}>
          We never post on your behalf or access DMs
        </p>
      </div>
    </main>
  );
}

export default function InstagramOAuthPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center" style={{ background: "#0e0e0e" }}>
        <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Loading…</div>
      </div>
    }>
      <OAuthContent />
    </Suspense>
  );
}
