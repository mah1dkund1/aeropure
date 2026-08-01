"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LayoutDashboard, Server ,Stamp,ChartLineIcon ,Users, Map as MapIcon,AirplayIcon, ClipboardList, Settings, LogOut, Command } from "lucide-react"

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/map", label: "Live Map", icon: MapIcon },
  { href: "/assets", label: "Asset Management", icon: AirplayIcon },
  { href: "/data_analysis", label: "History & Data Analysis", icon: ChartLineIcon },
  { href: "/command", label: "Command & Control", icon: Command },
  { href: "/stakeholder", label: "Stakeholder & Integration", icon: Stamp },
  { href: "/audit", label: "Audit Logs", icon: ClipboardList },
  { href: "/users", label: "User Management", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const signOut = async () => {
    await fetch("/api/session/clear", { method: "POST" })
    router.push("/login")
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        id="app-sidebar"
        data-collapsed="false"
        className="group fixed top-14 left-0 hidden md:flex w-58 data-[collapsed=true]:w-16 h-[calc(100vh-58px)] shrink-0 border-r border-slate-800 bg-[#020617] text-white flex-col overflow-hidden transition-all duration-300 ease-in-out"
      >
        <nav className="flex flex-col gap-1 px-2 mt-10">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded px-3 py-2 text-sm transition-all duration-300 ease-in-out group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-2 ${
                  active ? "bg-[#60A5FA]/40 text-white" : "hover:bg-[#60A5FA]/30 text-white"
                }`}
              >
                <Icon size={18} className="text-white shrink-0 transition-transform duration-300" />
                <span className="whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out group-data-[collapsed=true]:w-0 group-data-[collapsed=true]:opacity-0">{item.label}</span>
              </Link>
            )
          })}
          {/* Sign out placed directly below Settings */}
          <div className="mt-2 px-2">
            <button
              onClick={signOut}
              className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-white/10 hover:text-white transition-all duration-300 ease-in-out group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-2 w-full"
            >
              <LogOut size={16} className="text-white shrink-0 transition-transform duration-300" />
              <span className="whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out group-data-[collapsed=true]:w-0 group-data-[collapsed=true]:opacity-0">Sign out</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Mobile off-canvas sidebar */}
      <div
        id="app-sidebar-backdrop"
        className="md:hidden fixed inset-0 z-40 hidden bg-black/40"
        onClick={() => {
          const m = document.getElementById("app-sidebar-mobile")
          const b = document.getElementById("app-sidebar-backdrop")
          m?.setAttribute("data-open", "false")
          if (b) b.classList.add("hidden")
        }}
      />
      <aside
        id="app-sidebar-mobile"
        data-open="false"
        className="md:hidden fixed top-14 left-0 z-50 w-64 h-[calc(100vh-56px)] -translate-x-full data-[open=true]:translate-x-0 transition-transform duration-200 border-r border-slate-800 bg-[#020617] text-white flex flex-col overflow-y-auto"
      >
        <nav className="flex flex-col gap-1 px-2 py-4">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors ${
                  active ? "bg-[#60A5FA]/40 text-white" : "hover:bg-[#60A5FA]/30 text-white"
                }`}
                onClick={() => {
                  // Close on navigation
                  const m = document.getElementById("app-sidebar-mobile")
                  const b = document.getElementById("app-sidebar-backdrop")
                  m?.setAttribute("data-open", "false")
                  if (b) b.classList.add("hidden")
                }}
              >
                <Icon size={18} className="text-white" />
                <span>{item.label}</span>
              </Link>
            )
          })}
          <div className="mt-2 px-2">
            <button
              onClick={() => {
                signOut()
                const m = document.getElementById("app-sidebar-mobile")
                const b = document.getElementById("app-sidebar-backdrop")
                m?.setAttribute("data-open", "false")
                if (b) b.classList.add("hidden")
              }}
              className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-white/10 hover:text-white w-full"
            >
              <LogOut size={16} className="text-white" />
              <span>Sign out</span>
            </button>
          </div>
        </nav>
      </aside>
    </>
  )
}
