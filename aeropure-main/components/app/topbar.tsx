"use client"
import { ProfileMenu } from "@/components/profile/profile-menu"
import { Input } from "@/components/ui/input"
import Image from "next/image"
import { useCallback, useEffect, useState } from "react"

export function Topbar({ title, searchQuery, onSearchChange }: { title: string, searchQuery?: string, onSearchChange?: (q: string) => void }) {
  const [localQuery, setLocalQuery] = useState(searchQuery || "")

  useEffect(() => {
    setLocalQuery(searchQuery || "")
  }, [searchQuery])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setLocalQuery(value)
    onSearchChange?.(value)
  }, [onSearchChange])

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 bg-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),_0_2px_4px_-2px_rgba(0,0,0,0.1)]">
        <div className="mx-auto flex items-center justify-between px-4 py-2">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Toggle sidebar"
              onClick={() => {
                const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
                if (isMobile) {
                  const m = document.getElementById('app-sidebar-mobile')
                  const b = document.getElementById('app-sidebar-backdrop')
                  if (!m) return
                  const open = m.getAttribute('data-open') === 'true'
                  const next = !open
                  m.setAttribute('data-open', String(next))
                  if (b) {
                    if (next) b.classList.remove('hidden')
                    else b.classList.add('hidden')
                  }
                } else {
                  const el = document.getElementById('app-sidebar')
                  if (!el) return
                  const isCollapsed = el.getAttribute('data-collapsed') === 'true'
                  const next = !isCollapsed
                  el.setAttribute('data-collapsed', String(next))
                  // Ensure width adjusts reliably
                  el.classList.toggle('w-16', next)
                  el.classList.toggle('w-56', !next)
                  // Resize main content (md+ margins)
                  const main = document.getElementById('app-main')
                  if (main) {
                    if (next) {
                      main.classList.remove('md:ml-56')
                      main.classList.add('md:ml-16')
                    } else {
                      main.classList.remove('md:ml-16')
                      main.classList.add('md:ml-56')
                    }
                  }
                }
              }}
              className="mr-1 inline-flex h-9 w-9 items-center justify-center rounded-md border p-1 hover:bg-slate-100"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          
            <div className="flex items-center gap-3">
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
              className="rounded"
            />
            <span className="text-lg font-semibold text-slate-900">AeroPure</span>
          </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* <div className="hidden md:block">
              <Input 
                placeholder="Search devices, cities..." 
                aria-label="Search devices and cities" 
                className="w-56"
                value={localQuery}
                onChange={handleSearchChange}
              />
            </div> */}
            <ProfileMenu />
          </div>
        </div>
      </header>
      {/* Spacer to offset fixed header height */}
      <div className="h-10" />
    </>
  )
}

export default Topbar
