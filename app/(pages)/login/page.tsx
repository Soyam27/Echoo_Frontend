'use client'

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../context/auth-context";
import { Suspense } from "react";

function LoginForm() {
  const { login, user, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && user) {
      router.replace(redirectTo || (user.instagram_id ? "/posts" : "/oauth/instagram"));
    }
  }, [user, isLoading, router, redirectTo]);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      // redirect handled by useEffect above
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      {/* Navbar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 sm:px-8 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/echoo.png" alt="Echoo" className="w-25 h-25 rounded-lg object-contain absolute" />
        </Link>
        <Link href="/signup" className="try-btn px-3 sm:px-5 py-2 text-sm text-white rounded-full transition-all"
          style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)" }}>
          Sign up
        </Link>
      </div>

      {/* Card */}
      <div
        className="glass-card w-full px-5 py-8 sm:px-9 sm:py-10"
        style={{
          maxWidth: "420px",
          borderRadius: "22px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        {/* Header */}
        <div className="mb-8 text-center relative" style={{ paddingTop: "90px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/echoo.png" alt="Echoo" className="absolute top-8 left-1/2 -translate-x-1/2 w-25 h-25 rounded-xl object-contain" />
          <h1 className="text-white font-semibold mb-1.5" style={{ fontSize: "22px", letterSpacing: "-0.02em" }}>
            Welcome back
          </h1>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
            Sign in to your Echoo account
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && (
            <div
              className="px-4 py-3 rounded-xl text-sm"
              style={{
                background: "rgba(220,50,50,0.10)",
                border: "1px solid rgba(220,50,50,0.25)",
                color: "rgba(255,120,120,0.9)",
              }}
            >
              {error}
            </div>
          )}

          {/* Email */}
          <div
            className="input-wrapper"
            style={{
              borderRadius: "12px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.09)",
              padding: "11px 15px",
            }}
          >
            <label className="block text-xs mb-1" style={{ color: "rgba(255,255,255,0.32)" }}>
              Email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              className="input-field text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {/* Password */}
          <div
            className="input-wrapper"
            style={{
              borderRadius: "12px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.09)",
              padding: "11px 15px",
            }}
          >
            <label className="block text-xs mb-1" style={{ color: "rgba(255,255,255,0.32)" }}>
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              className="input-field text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {/* Forgot */}
          <div className="flex justify-end -mt-1">
            <a href="#" className="text-xs transition-colors" style={{ color: "rgba(205,138,18,0.75)" }}>
              Forgot password?
            </a>
          </div>

          {/* Sign in */}
          <button
            type="submit"
            disabled={submitting}
            className="btn-gold w-full py-3 rounded-xl text-sm font-medium text-center mt-1 flex items-center justify-center gap-2"
            style={{ opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 8" />
                </svg>
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.22)" }}>or</span>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
          </div>

          {/* Sign up link */}
          <p className="text-center text-sm" style={{ color: "rgba(255,255,255,0.32)" }}>
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium transition-colors" style={{ color: "rgba(205,138,18,0.88)" }}>
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
