"use client"
import useSWR from "swr"
import type { DemoDevice } from "@/lib/demo-data"

type ApiDevice = {
  id?: number
  deviceName: string
  latitude?: number
  longitude?: number
  status?: string
  city?: string
  pollutant?: string
  value?: number
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Network error")
    return r.json()
  })

export function useDevices() {
  const { data, error, isLoading } = useSWR<{
    code?: number
    data?: { list?: any[]; total?: number }
    devices?: ApiDevice[]
  }>("/api/iot/devices?pageNo=1&pageSize=200", fetcher)

  const list: any[] = (data as any)?.data?.list ?? (data as any)?.devices ?? []
  const devices: DemoDevice[] = (list || [])
    .map((d: any) => {
      const lat = typeof d.latitude === "number" ? d.latitude : Number(d.latitude)
      const lng = typeof d.longitude === "number" ? d.longitude : Number(d.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      const deviceIdCandidate = d.id ?? d.deviceID ?? d.deviceId
      const deviceIdNum = typeof deviceIdCandidate === "number" ? deviceIdCandidate : Number(deviceIdCandidate)
      return {
        deviceName: String(d.deviceName ?? "Device"),
        lat,
        lng,
        status: d.onlineState === 1 || d.status === "online" ? "online" : "offline",
        city: d.city ?? "",
        pollutant: (d.pollutant as any) ?? "AQI",
        value: typeof d.value === "number" ? d.value : 0,
        deviceId: Number.isFinite(deviceIdNum) ? Number(deviceIdNum) : undefined,
      } as DemoDevice
    })
    .filter(Boolean) as DemoDevice[]

  return { devices, isLoading, error }
}
