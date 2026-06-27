'use client'

import { useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import SplineScene from "./spline-scene";
import { useAuth } from "./context/auth-context";
import Link from "next/link";

export default function Home() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [showTooltip, setShowTooltip] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const isLoggedIn = !isLoading && !!user;

  function handleSend() {
    if (!isLoggedIn) return;
    const q = input.trim();
    if (!user?.instagram_id) {
      router.push(q ? `/oauth/instagram?q=${encodeURIComponent(q)}` : "/oauth/instagram");
    } else {
      router.push(q ? `/posts?q=${encodeURIComponent(q)}` : "/posts");
    }
  }

  return (
    <>
      {/* ── Spline Background ── */}
      <div
        className="fixed inset-0"
        style={{ background: "#0e0e0e", zIndex: 0 }}
      >
        <SplineScene />
      </div>

      {/* ── Page Content ── */}
      <div
        className="relative flex flex-col min-h-screen"
        style={{ zIndex: 1 }}
      >
        {/* Navbar */}
        <nav className="relative flex items-center px-4 sm:px-8 py-5">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/echoo.png" alt="Echoo" className="w-14 h-14 sm:w-20 sm:h-20 md:w-25 md:h-25 rounded-lg object-contain absolute left-4 sm:left-6" />
          </div>

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-7 absolute left-[50%] -translate-x-1/2">
            {["Echoo", "API", "Company", "Careers", "Pricing"].map((link) => (
              <a key={link} href="#" className="nav-link text-sm">
                {link}
              </a>
            ))}
          </div>

          {/* CTA */}
          <div className="ml-auto">
          {!hasMounted || isLoading ? (
            <div className="w-20 sm:w-24 h-8 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
          ) : isLoggedIn ? (
            <div className="flex items-center gap-2">
              <Link
                href="/posts"
                className="try-btn px-3 sm:px-5 py-2 text-sm text-white rounded-full transition-all"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.18)",
                }}
              >
                Posts
              </Link>
              <button
                onClick={() => logout()}
                className="hidden sm:block px-5 py-2 text-sm rounded-full transition-all"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="try-btn px-3 sm:px-5 py-2 text-sm text-white rounded-full transition-all"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.18)",
              }}
            >
              Sign in
            </Link>
          )}
          </div>
        </nav>

        {/* Hero */}
        <main
          className="flex flex-col items-center justify-center flex-1 px-4 text-center pb-20 md:pb-40"
          style={{ paddingTop: "60px" }}
        >
          {/* Heading */}
          <h1
            className="text-white font-semibold mb-3"
            style={{
              fontSize: "clamp(28px, 4vw, 40px)",
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
            }}
          >
            How can I assist you?
          </h1>

          {/* Subtitle */}
          <p
            className="mb-9 max-w-md text-sm leading-relaxed"
            style={{ color: "rgba(255,255,255,0.38)" }}
          >
            Quickly find answers, get assistance, and explore AI-powered
            insights—all in one place
          </p>

          {/* Chat input card */}
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
            {/* Input field */}
            <div className="px-5 pt-4 pb-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && isLoggedIn && handleSend()}
                placeholder="What do you want to know?"
                className="w-full bg-transparent outline-none text-sm"
                style={{
                  color: "rgba(255,255,255,0.85)",
                  caretColor: "rgba(255,255,255,0.7)",
                }}
                disabled={!isLoggedIn}
              />
            </div>

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-4 py-3">
              {/* Left: action icons */}
              <div className="flex items-center gap-2.5">
                <button
                  className="icon-btn w-7 h-7 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path
                      d="M5.5 1v9M1 5.5h9"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>

                <button
                  className="icon-btn transition-all"
                  style={{ color: "rgba(255,255,255,0.35)" }}
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path
                      d="M2 13c1.5-1 3-3.5 3-5.5 0-1.1-.9-2-2-2s-2 .9-2 2c0 .55.22 1.05.59 1.41L2 10l1 3z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M5 7.5L11 2l2 2-6 5.5"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <button
                  className="icon-btn transition-all"
                  style={{ color: "rgba(255,255,255,0.35)" }}
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <circle
                      cx="7.5"
                      cy="7.5"
                      r="6"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M5 9.5s.9 1.2 2.5 1.2 2.5-1.2 2.5-1.2"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                    <circle cx="5.5" cy="6.5" r="0.8" fill="currentColor" />
                    <circle cx="9.5" cy="6.5" r="0.8" fill="currentColor" />
                  </svg>
                </button>
              </div>

              {/* Right: send button */}
              <div
                className="relative"
                onMouseEnter={() => !isLoggedIn && setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              >
                {showTooltip && (
                  <div
                    className="absolute right-0 bottom-full mb-2 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap pointer-events-none"
                    style={{
                      background: "rgba(20,20,30,0.95)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.75)",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                    }}
                  >
                    Login to chat
                    <div
                      className="absolute right-2.5 top-full w-0 h-0"
                      style={{
                        borderLeft: "5px solid transparent",
                        borderRight: "5px solid transparent",
                        borderTop: "5px solid rgba(20,20,30,0.95)",
                      }}
                    />
                  </div>
                )}
                <button
                  onClick={isLoggedIn ? handleSend : undefined}
                  className="send-btn w-7 h-7 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: isLoggedIn
                      ? "rgba(205,138,18,0.25)"
                      : "rgba(255,255,255,0.1)",
                    border: isLoggedIn
                      ? "1px solid rgba(205,138,18,0.4)"
                      : "1px solid rgba(255,255,255,0.12)",
                    color: isLoggedIn
                      ? "rgba(205,138,18,0.95)"
                      : "rgba(255,255,255,0.25)",
                    cursor: isLoggedIn ? "pointer" : "not-allowed",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M10 6H2M6.5 2L10 6l-3.5 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Not logged in nudge */}
          {hasMounted && !isLoading && !isLoggedIn && (
            <p className="mt-5 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              <Link href="/login" style={{ color: "rgba(205,138,18,0.7)" }}>
                Sign in
              </Link>{" "}
              to start analyzing your Instagram comments
            </p>
          )}
        </main>
      </div>
    </>
  );
}
