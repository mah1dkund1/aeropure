"use client"
import useSWR from "swr"
import { useMemo } from "react"
import type { AssetMarker } from "@/lib/iot-types"

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("Network error")
    return r.json()
  })

// Upstream returns { items: [...] }
// Each item contains _id, lat, long, location, name, type, efficiency, images
export function useAssets() {
  const { data, error, isLoading, mutate } = useSWR<{ items?: any[] }>("/api/assets", fetcher, {
    refreshInterval: 60_000,
  })

  const items = (data?.items ?? []) as any[]
  const assets: AssetMarker[] = useMemo(() => {
    return (items as any[])
      .map((a) => {
        const lat = typeof a.lat === "number" ? a.lat : Number(a.lat)
        const lng = typeof a.long === "number" ? a.long : Number(a.long)
        if (!isFinite(lat) || !isFinite(lng)) return null
        const deviceIdCandidate = a.deviceID ?? a.deviceId ?? a.id
        const deviceIdNum = typeof deviceIdCandidate === "number" ? deviceIdCandidate : Number(deviceIdCandidate)
        const s = String(a.status ?? "").toLowerCase()
        const isOnline = s === "online" || s === "active" || s === "1" || s === "true" || a.active === true || Number(a.status) === 1
        return {
          id: String(a._id ?? a.id ?? `${a.name}-${lat}-${lng}`),
          name: String(a.name ?? "Asset"),
          lat,
          lng,
          location: a.location ?? undefined,
          type: a.type ?? undefined,
          efficiency: a.efficiency ?? undefined,
          images: Array.isArray(a.images) ? a.images : undefined,
          // Prefer explicit backend `status` when possible, otherwise infer
          status: isOnline ? "online" : "offline",
          deviceId: Number.isFinite(deviceIdNum) ? Number(deviceIdNum) : undefined,
        } as AssetMarker
      })
      .filter(Boolean) as AssetMarker[]
  }, [data])

  return { assets, isLoading, error, mutate }
}
