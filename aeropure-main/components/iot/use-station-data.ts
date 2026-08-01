"use client"
import useSWR from "swr"
import { useMemo } from "react"

export type StationReading = {
  _id: string
  deviceID: number
  receivedAt: string
  airHumidity?: number
  airQualityIndex?: number
  airTemperature?: number
  atmosPressure?: number
  windDir?: number
  windSpeed?: number
  rainfall?: number
  valueCO?: number
  valueNO2?: number
  valueO3?: number
  valuePM_10?: number
  valuePM_2_5?: number
  valueSO2?: number
  [k: string]: any
}

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => {
  if (!r.ok) throw new Error("Network error")
  return r.json()
})

export function useStationData(limit = 100) {
  const { data, error, isLoading, mutate } = useSWR<{ data?: StationReading[]; total?: number }>(
    `/api/data?limit=${encodeURIComponent(String(limit))}`,
    fetcher,
    { refreshInterval: 30_000 }
  )

  const readings = (data?.data ?? []) as StationReading[]

  const latest = useMemo(() => {
    if (!readings.length) return undefined
    // sort descending by receivedAt
    const sorted = [...readings].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    return sorted[0]
  }, [readings])

  const getLatestForDevice = (deviceId?: number) => {
    if (!deviceId) return undefined
    const filtered = readings.filter((r) => Number(r.deviceID) === Number(deviceId))
    if (filtered.length === 0) return undefined
    const sorted = filtered.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    return sorted[0]
  }

  return { readings, latest, getLatestForDevice, isLoading, error, mutate }
}
