"use client"
import { DEMO_POLLUTANTS } from "@/lib/demo-data"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useState } from "react"

export type MapFilterState = {
  pollutant: (typeof DEMO_POLLUTANTS)[number]
  status: { online: boolean; offline: boolean }
  timeRange: "24h" | "7d" | "30d"
  heatmap: boolean
  wind: boolean
}

export function useDefaultMapFilters(): MapFilterState {
  return { pollutant: "AQI", status: { online: true, offline: true }, timeRange: "24h", heatmap: false, wind: false }
}

export function MapFilters({ value, onChange }: { value: MapFilterState; onChange: (v: MapFilterState) => void }) {
  const [local, setLocal] = useState(value)

  function apply(next: Partial<MapFilterState>) {
    const v = { ...local, ...next }
    setLocal(v)
    onChange(v)
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Select value={local.pollutant} onValueChange={(v: any) => apply({ pollutant: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Pollutant" />
          </SelectTrigger>
          <SelectContent>
            {DEMO_POLLUTANTS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={local.timeRange} onValueChange={(v: any) => apply({ timeRange: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Time range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24h</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 items-center gap-2">
        <label className="text-sm text-muted-foreground" aria-label="Online devices toggle">
          Online
        </label>
        <Switch
          checked={local.status.online}
          onCheckedChange={(c) => apply({ status: { ...local.status, online: !!c } })}
        />
        <label className="text-sm text-muted-foreground" aria-label="Offline devices toggle">
          Offline
        </label>
        <Switch
          checked={local.status.offline}
          onCheckedChange={(c) => apply({ status: { ...local.status, offline: !!c } })}
        />
      </div>

      <div className="grid grid-cols-2 items-center gap-2">
        <label className="text-sm text-muted-foreground" aria-label="Heatmap toggle">
          Heatmap
        </label>
        <Switch checked={local.heatmap} onCheckedChange={(c) => apply({ heatmap: !!c })} />
        <label className="text-sm text-muted-foreground" aria-label="Wind layer toggle">
          Wind layer
        </label>
        <Switch checked={local.wind} onCheckedChange={(c) => apply({ wind: !!c })} />
      </div>

      <Button
        variant="outline"
        onClick={() =>
          apply({
            pollutant: "AQI",
            timeRange: "24h",
            status: { online: true, offline: false },
            heatmap: false,
            wind: false,
          })
        }
      >
        Reset
      </Button>
    </div>
  )
}
