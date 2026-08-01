"use client"

import AppShell from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Topbar } from "@/components/app/topbar"
//test
export default function SettingsPage() {
  const [mapsKey, setMapsKey] = useState("")
  const [saving, setSaving] = useState(false)

  const exportKey = async () => {
    const res = await fetch("/api/iot/devices?pageNo=1&pageSize=1")
    alert(res.ok ? "API reachable with your AppKey." : "API unreachable.")
  }

  const saveMapsKey = async () => {
    setSaving(true)
    const res = await fetch("/api/session/set-maps-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapsKey }),
    })
    setSaving(false)
    alert(res.ok ? "Google Maps key saved. Open Live Map to load the map." : "Failed to save key.")
  }

  return (
    <AppShell>
      <Topbar title="Dashboard" />
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
      <div className="grid gap-4">
        <div className="rounded border p-4">
          <p className="mb-2 text-sm">Validate your current AppKey connection.</p>
          <div className="flex items-center gap-2">
            <Button onClick={exportKey}>Test connection</Button>
            <Button asChild variant="outline">
              <Link href="/login">Set / Change AppKey</Link>
            </Button>
          </div>
        </div>
        <div className="rounded border p-4">
          <p className="mb-2 text-sm">Google Maps</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Paste Google Maps JavaScript API key"
              value={mapsKey}
              onChange={(e) => setMapsKey(e.target.value)}
              className="sm:max-w-md"
            />
            <Button onClick={saveMapsKey} disabled={!mapsKey.trim() || saving}>
              {saving ? "Saving…" : "Save Key"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Key is stored in a secure HttpOnly cookie and only used to load Google Maps on the Live Map page.
          </p>
        </div>
      </div>
    </AppShell>
  )
}
