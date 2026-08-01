import type React from "react"
import { Sidebar } from "./sidebar"

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex">
      <Sidebar />
      {/* Main content shifts only on md+ where the desktop sidebar is visible */}
      <main
        id="app-main"
        className="flex-1 p-4 mt-6 ml-0 md:ml-56 transition-all duration-200 overflow-x-hidden"
      >
        {children}
      </main>
    </div>
  )
}
