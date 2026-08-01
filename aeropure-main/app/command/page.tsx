"use client"

import AppShell from "@/components/app/shell"
import { useState } from "react"
import { useApi } from "@/components/iot/use-fetcher"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OnlineBadge } from "@/components/iot/online-badge"
import { Topbar } from "@/components/app/topbar"

export default function DevicesPage() {
  const [query, setQuery] = useState("")
  const { data, error, isLoading } = useApi<any>(
    `/api/iot/devices?pageNo=1&pageSize=20${query ? `&deviceName=${encodeURIComponent(query)}` : ""}`,
  )

  return (
    <AppShell>
      <Topbar title="Devices" />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Command and Control</h1>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64"
          />
        </div>
      </div>

      {isLoading && <p>Loading…</p>}
      {error && <p className="text-red-600">Failed to load devices.</p>}

      {data && (
        <div className="overflow-auto rounded border">
          <table className="min-w-[700px] w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Serial</th>
                <th className="px-3 py-2 text-left">Online</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data.data?.list ?? []).map((d: any) => (
                <tr key={d.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{d.deviceName}</td>
                  <td className="px-3 py-2">{d.serial ?? "-"}</td>
                  <td className="px-3 py-2">
                    <OnlineBadge state={d.onlineState} />
                  </td>
                  <td className="px-3 py-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/devices/${encodeURIComponent(d.deviceName)}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
                //ok
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  )
}
