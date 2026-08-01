"use client"

import type React from "react"
import Link from "next/link"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Image from "next/image"
import { Checkbox } from "@/components/ui/checkbox"

export default function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    // Basic front-end validation; hook up to your auth API here
    if (!username.trim() || !password) {
      setError("Please enter both username and password")
      setLoading(false)
      return
    }
    try {
      // TODO: Replace wiuth real authentication API call
      await new Promise((r) => setTimeout(r, 400))
      router.push("/dashboard")
    } catch (err) {
      setError("Login failed. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-dvh">
      <Image
        src="/images/login_background.png"
        alt="City Smog background"
        fill
        className="object-cover"
        priority
      />
      {/* keep the background image clean; just a subtle dark overlay for readability */}
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative z-10 flex min-h-dvh items-center justify-center p-4">
        <form
          onSubmit={onSubmit}
          className="w-[380px] md:w-[400px] rounded-3xl border border-white/10 p-8 md:p-10 backdrop-blur-[25px] shadow-[0_8px_40px_rgba(0,0,0,0.4)] flex flex-col gap-6 bg-transparent"
          style={{
            background:
              "linear-gradient(180deg, rgba(44,58,91,0.85) 0%, rgba(10,15,30,0.85) 100%)",
          }}
        >
          {/* Header */}
          <div className="text-center">
            <div className="mb-4 flex items-center justify-center gap-2">
              <div
                aria-label="AeroPure logo"
                style={{
                  width: 44,
                  height: 44,
                  background: "linear-gradient(90deg, #60A5FA, #9CC1EF)",
                  WebkitMaskImage: 'url(/images/logo.png)',
                  maskImage: 'url(/images/logo.png)',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              />
              <span className="bg-gradient-to-r from-[#60A5FA] to-[#9CC1EF] bg-clip-text text-2xl font-semibold text-transparent">
                AeroPure
              </span>
            </div>
            <h4 className="mb-1 text-lg font-medium text-slate-400">Welcome back</h4>
            <h1 className="m-0 text-2xl font-bold text-white">Login to your account</h1>
          </div>

          {/* Inputs */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-white">
                Username<span className="text-red-400">*</span>
              </label>
              <Input
                placeholder="Enter your username or email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="border-slate-200 bg-slate-100 text-slate-950 placeholder:text-slate-500"
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-white">
                Password<span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Input
                  type={showPwd ? "text" : "password"}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10 border-slate-200 bg-slate-100 text-slate-950 placeholder:text-slate-500"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-600 hover:text-slate-800"
                >
                  {/* simple eye icon */}
                  {showPwd ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5 0-9.27-3.11-11-8  .74-2.07 2.02-3.86 3.62-5.17" />
                      <path d="M1 1l22 22" />
                      <path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88" />
                      <path d="M14.12 14.12 20.49 20.49" />
                      <path d="M10.73 5.08A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8-.46 1.29-1.13 2.48-1.97 3.5" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {error && <p className="-mt-2 text-sm text-red-400">{error}</p>}
          </div>

          {/* Options */}
          <div className="flex items-center justify-between text-sm">
            <label className="inline-flex items-center gap-2 text-slate-300">
              <Checkbox id="remember" />
              Remember me
            </label>
            <span className="text-slate-500">{/* Reserved for future link */}</span>
          </div>

          {/* Ations */}
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              className="w-full bg-[#60A5FA] text-slate-50 hover:bg-[#3B82F6]"
              disabled={loading || !username.trim() || !password}
            >
              {loading ? "Logging in..." : "Login"}
            </Button>

            <Button
              asChild
              variant="outline"
              className="w-full border-white/20 bg-transparent text-white hover:bg-white/10"
            >
              <Link href="/dashboard">Skip for now</Link>
            </Button>
          </div>

          {/* Footer note */}
          <p className="text-center text-sm text-slate-400">
            <span className="mr-1">🔒</span>Protected by enterprise-grade security & encryption
          </p>
        </form>
      </div>
    </div>
  )
}
