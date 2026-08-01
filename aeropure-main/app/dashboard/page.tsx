"use client"
import React from "react"
import AppShell from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
// Recharts is code-split into `components/charts/ChartRenderer` to reduce initial bundle
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { ResponsiveContainer, PieChart, Pie, Cell, AreaChart, XAxis, YAxis, Area } from 'recharts'
import dynamic from 'next/dynamic'
import { SkeletonLineChart, SkeletonBarChart } from '@/components/charts/ChartSkeletons'

const DynamicChartRenderer = dynamic(
  () => import('@/components/charts/ChartRenderer').then((m) => m.ChartRenderer),
  {
    ssr: false,
    loading: (props: any) => (props?.showChart === 'bar' ? <SkeletonBarChart /> : <SkeletonLineChart />),
  }
)
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Topbar } from "@/components/app/topbar"
import { useDevices } from "@/components/iot/use-devices"
import { aggregateReadings } from '@/lib/aggregate'
import { AeropureMap } from "@/components/map/google-map"
import { useHeatmapGenerator } from '@/components/iot/use-heatmap-generator'
import { useAssets } from "@/components/iot/use-assets"
import { useApi } from "@/components/iot/use-fetcher"
import { detectAssetState } from "@/lib/asset-status"
import { ExportDialog } from "@/components/reports/export-dialog"
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { metricLabel, unitForMetric } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
export default function DashboardPage() {
  const [showChart, setShowChart] = useState<"line" | "bar">("line")
  type MetricKey = "AQI" | "PM2_5" | "PM10" | "CO" | "NO2" | "O3" | "SO2" | "Temperature" | "Humidity" | "Pressure"
  const [aqiMetric, setAqiMetric] = useState<MetricKey>("AQI")
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(["PM2_5", "PM10", "NO2", "O3", "SO2"])
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "total">("24h")
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showMetricDropdown, setShowMetricDropdown] = useState(false)
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [showCompactSelector, setShowCompactSelector] = useState(false)
  const [isNarrow, setIsNarrow] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<any>(null)
  const [showAssetDropdown, setShowAssetDropdown] = useState(false)
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])
  const [appliedDeviceIds, setAppliedDeviceIds] = useState<string[] | null>(null)
  const [multiAssetSeries, setMultiAssetSeries] = useState<any[] | null>(null)
  const [multiAssetTicks, setMultiAssetTicks] = useState<number[] | null>(null)
  const [multiAssetDomain, setMultiAssetDomain] = useState<[number, number] | null>(null)
  const [multiAggLoading, setMultiAggLoading] = useState<boolean>(false)
    const isMobile = useIsMobile()
    const [mobileUptimeInfo, setMobileUptimeInfo] = useState<{ assetId: string; seg: { start: number; end: number; online: boolean } } | null>(null)
  const [uptimeBarNow, setUptimeBarNow] = useState<number>(Date.now())
  useEffect(() => {
    // Update every 5 minutes
    const id = window.setInterval(() => {
      setUptimeBarNow(Date.now())
    }, 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [])
  const [showAverageOnly, setShowAverageOnly] = useState(false)
  //map of assetId -> last reading info: timestamp and original receivedAt string (if present)
  const [lastActiveMap, setLastActiveMap] = useState<Record<string, { ts?: number; receivedAt?: string }>>({})
  //fallback data timestamps from individual device API calls
  const [fallbackDataTimestamps, setFallbackDataTimestamps] = useState<Record<string, string>>({})
  //using a single datetime-local string 
  const formatDateTimeLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [fromDateTime, setFromDateTime] = useState<string>(formatDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)))
  const [toDateTime, setToDateTime] = useState<string>(formatDateTimeLocal(new Date()))
  //default to current time ON
  const [toDateIsLive, setToDateIsLive] = useState<boolean>(true)
  //track mount state to avoid state updates after unmount during indefinite polling
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1100px)')
    const onChange = () => setIsNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  //Clear metrics when switching to multi-asset mode
  useEffect(() => {
    if (selectedDeviceIds.length > 1 && selectedMetrics.length > 0) {
      setSelectedMetrics(['AQI'])
    }
  }, [selectedDeviceIds.length])

  // When multiple assets selected, disable "Current time" live mode
  useEffect(() => {
    if (selectedDeviceIds.length > 1 && toDateIsLive) {
      setToDateIsLive(false)
    }
  }, [selectedDeviceIds.length, toDateIsLive])
 
 
  // Multi-select metric handlers
  const baseMetrics: MetricKey[] = ["AQI","PM2_5", "PM10", "CO", "SO2", "NO2", "O3"]
  const senseMeshMetrics: MetricKey[] = ["Temperature", "Humidity", "Pressure"]
  // Environmental metrics (Temperature, Humidity, Pressure) should be available for all device types
  const allMetrics: MetricKey[] = [...baseMetrics, ...senseMeshMetrics]
 
  // Devices for map (uses live API when available; falls back to demo data with lat/lng)
  const { devices: mapDevices, isLoading: isLoadingMap } = useDevices()
  // Assets for map (server assets rendered like Live Map)
  const { assets } = useAssets()
  // Build heatmap/device readings (used to detect wind data presence)
  const { devicesWithReadings } = useHeatmapGenerator()
  const hasWindData = useMemo(() => {
    try {
      if (!devicesWithReadings || !devicesWithReadings.length) return false
      return devicesWithReadings.some((d: any) => {
        const s = Number(d?.windSpeed)
        return Number.isFinite(s) && s > 0 && (d?.windDir !== undefined && d?.windDir !== null)
      })
    } catch (e) { return false }
  }, [devicesWithReadings])
  
  const toggleMetric = (metric: MetricKey) => {
    if (selectedDeviceIds.length > 1) {
      // When multiple assets selected, only allow one metric
      setSelectedMetrics([metric])
    } else {
      setSelectedMetrics(prev =>
        prev.includes(metric)
          ? prev.filter(m => m !== metric)
          : [...prev, metric]
      )
    }
  }
  const toggleSelectAll = () => {
    if (selectedDeviceIds.length > 1) return //No select all for multi-asset
    if (selectedMetrics.length === allMetrics.length) {
      setSelectedMetrics([])
    } else {
      setSelectedMetrics([...allMetrics])
    }
  }
  // Warm up chart bundle when metrics dropdown is opened or hovered
  const preloadCharts = () => {
    import('@/components/charts/ChartRenderer')
    import('@/components/charts/ChartSkeletons')
  }
  useEffect(() => {
    if (showMetricDropdown) preloadCharts()
  }, [showMetricDropdown])
  // Google Mapss key 
  const [mapsKey, setMapsKey] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/session/get-maps-key")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMapsKey(d?.mapsKey || null) })
      .catch(() => { if (!cancelled) setMapsKey(null) })
    return () => { cancelled = true }
  }, [])
  // Fallback: if API didn't provide the key, try cookie 
  useEffect(() => {
    if (mapsKey) return
    try {
      const match = (typeof document !== 'undefined' ? document.cookie : '').match(/(?:^|; )maps_key=([^;]+)/)
      const fromCookie = match ? decodeURIComponent(match[1]) : null
      if (fromCookie) setMapsKey(fromCookie)
    } catch {}
  }, [mapsKey])

  // Manage stepped live end time when "Current time" mode is active
  const [liveEndMs, setLiveEndMs] = useState<number | null>(null)
  // When "Current time" mode changes, manage the stepped 30-minute live window.
  useEffect(() => {
    if (!toDateIsLive) {
      setLiveEndMs(null)
      return
    }
    //don't enable live stepping in multi-asset mode
    if (selectedDeviceIds.length > 1) {
      setToDateIsLive(false)
      return
    }
    const fiveMinutes = 30 * 60 * 1000
    // Initialize: set the visible To time to now + 30 minutes (one step ahead)
    const now = Date.now()
    const initialEnd = now + fiveMinutes
    setLiveEndMs(initialEnd)
    try { setToDateTime(formatDateTimeLocal(new Date(initialEnd))) } catch (e) {}

    // Check frequently (every 30s) whether real time has reached or passed
    // the current live end. When it does, advance the live end by 30 minutes
    // so the UI jumps in 30-minute increments instead of changing every minute.
    const id = window.setInterval(() => {
      const cur = Date.now()
      setLiveEndMs((prev) => {
        const curEnd = prev ?? initialEnd
        if (cur >= curEnd) {
          const next = curEnd + fiveMinutes
          try { setToDateTime(formatDateTimeLocal(new Date(next))) } catch (e) {}
          return next
        }
        return curEnd
      })
    }, 30_000)
    return () => window.clearInterval(id)
  }, [toDateIsLive])

  // Aggregated data: use datetime-local strings (fromDateTime / toDateTime)
  const fromTs = fromDateTime ? new Date(fromDateTime).getTime() : null
  const rawToTs = toDateTime ? new Date(toDateTime).getTime() : null

  // When Current time is ON, use a stepped internal end time (liveEndMs),
  // but never exceed the user-selected To timestamp.
  const effectiveToTs = (() => {
    if (!rawToTs) return null
    if (!toDateIsLive || liveEndMs == null) return rawToTs
    return Math.min(liveEndMs, rawToTs)
  })()

  const aggUrl = fromTs && effectiveToTs
    ? `/api/aggregate?start=${fromTs}&end=${effectiveToTs}${selectedDeviceIds && selectedDeviceIds.length === 1 ? `&deviceID=${selectedDeviceIds[0]}` : ''}`
    : `/api/aggregate?range=24h` // fallback
  const DAY_MS = 24 * 60 * 60 * 1000
  const selectedSpanMs = fromTs && effectiveToTs ? Number(effectiveToTs) - Number(fromTs) : null
  const isSpanTooLarge = selectedSpanMs != null && selectedSpanMs > 30 * DAY_MS
  // When multi-asset mode is active we use a separate batched endpoint and
  // should not auto-refresh the single-device `/api/aggregate` route.
  const aggRefreshInterval = (selectedDeviceIds && selectedDeviceIds.length > 1) ? 0 : 30_000
  const { data: agg, error: aggError, isLoading: aggLoading, mutate: refreshAgg } = useApi<{ start: number; end: number; ticks: number[]; points: any[] }>(aggUrl, aggRefreshInterval)
  // Assets API for Status Overview
  type ApiAsset = {
    _id: string
    name?: string
    location?: string
    efficiency?: string | number
    maintenanceHistory?: { action: string; date: string }[]
    status?: string | number | null
    type?: string
    deviceId?: string | number
  }
  const { data: assetsResp, error: assetsError, isLoading: assetsLoading } = useApi<{
    items: ApiAsset[]
    total: number
    page: number
    pageSize: number
  }>(`/api/assets`)

  // generate evenly spaced tick timestamps across a domain (same as reports)
  const generateEvenTicks = (domainStart: number, domainEnd: number, maxTicks: number): number[] => {
    if (domainEnd <= domainStart) return [domainStart]
    const ticks: number[] = []
    const count = Math.max(2, Math.min(maxTicks, 12))
    for (let i = 0; i < count; i++) {
      const t = domainStart + (i * (domainEnd - domainStart)) / (count - 1)
      ticks.push(Math.floor(t))
    }
    return ticks
  }

  //select evenly distributed elements from an array (always includes first and last)
  const selectEvenlySpaced = <T,>(arr: T[], maxCount: number): T[] => {
    if (!arr || arr.length === 0) return []
    if (arr.length <= maxCount) return arr
    const result: T[] = []
    const step = (arr.length - 1) / (maxCount - 1)
    for (let i = 0; i < maxCount; i++) {
      const idx = Math.round(i * step)
      result.push(arr[idx])
    }
    return result
  }

  // Fetch last active timestamp for the small preview list (compute from a single dataset to avoid per-device duplication)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const items = (assetsResp?.items ?? []) as ApiAsset[]
        const preview = items.slice(0, 8)
        if (!preview.length) {
          if (!cancelled) setLastActiveMap({})
          return
        }

        // Build a map deviceKey -> asset _id for quick lookup
        const devToAsset: Record<string, string> = {}
        const wantedDevKeys = new Set<string>()
        for (const a of preview) {
          const deviceId = (a as any).deviceId ?? (a as any).deviceID ?? (a as any).id
          if (deviceId == null) continue
          const key = String(deviceId)
          wantedDevKeys.add(key)
          devToAsset[key] = a._id
        }

        if (wantedDevKeys.size === 0) {
          if (!cancelled) setLastActiveMap({})
          return
        }

        // Fetch a bounded batch of recent rows and compute per-device latest timestamp
        const resp = await fetch(`/api/data?limit=5000`)
        if (!resp.ok) {
          if (!cancelled) setLastActiveMap({})
          return
        }
        const payload = await resp.json().catch(() => ({}))
        let rows: any[] = []
        if (Array.isArray(payload?.data)) rows = payload.data
        else if (Array.isArray(payload?.data?.data)) rows = payload.data.data
        else if (Array.isArray(payload?.data?.list)) rows = payload.data.list
        else if (Array.isArray(payload)) rows = payload
        else if (Array.isArray(payload?.rows)) rows = payload.rows
        else rows = []

        // Accumulate latest ts per requested device
        const latestByDev: Record<string, { ts?: number; receivedAt?: string }> = {}
        for (const r of rows) {
          const devRaw = r?.deviceID ?? r?.deviceId ?? r?.id ?? r?.DeviceID
          if (devRaw == null) continue
          const devKey = String(devRaw)
          if (!wantedDevKeys.has(devKey)) continue

          const rawReceived = r?.receivedAt ?? r?.received_at ?? undefined
          const tsRaw = rawReceived ?? r?.time ?? r?.t ?? r?.timestamp ?? r?.ts
          let ts = Number(tsRaw)
          if (Number.isFinite(ts)) {
            // Some backends provide seconds since epoch instead of milliseconds.
            // If the value looks like seconds (less than year 33658 in ms), convert to ms.
            if (ts > 0 && ts < 1e12) {
              ts = ts * 1000
            }
          } else {
            const parsed = Date.parse(String(tsRaw || ''))
            ts = Number.isFinite(parsed) ? parsed : NaN
          }
          if (!Number.isFinite(ts)) continue

          const prev = latestByDev[devKey]?.ts ?? -Infinity
          if (ts > prev) {
            latestByDev[devKey] = {
              ts,
              receivedAt: rawReceived ? String(rawReceived) : new Date(ts).toUTCString(),
            }
          }
        }

        if (cancelled) return
        const resultMap: Record<string, { ts?: number; receivedAt?: string }> = {}
        for (const key of wantedDevKeys) {
          const assetId = devToAsset[key]
          if (!assetId) continue
          const entry = latestByDev[key]
          resultMap[assetId] = entry ? { ts: entry.ts, receivedAt: entry.receivedAt } : { ts: undefined, receivedAt: undefined }
        }
        setLastActiveMap(resultMap)
      } catch (e) {
        if (!cancelled) setLastActiveMap({})
      }
    }
    run()
    return () => { cancelled = true }
  }, [assetsResp, effectiveToTs])
  
  // Fetch fallback data timestamps for offline assets without lastActiveMap entries
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!assetsResp?.items) return
      
      const offlineAssets = assetsResp.items.filter((a) => {
        const state = detectAssetState(a)
        const status = state === 'paused' ? 'inactive' : state
        const entry = lastActiveMap?.[a._id]
        // Only fetch for offline assets without existing last active data
        return status === 'offline' && a.deviceId && (!entry || (!entry.receivedAt && !entry.ts))
      })

      // Limit to a small number to avoid many parallel fetches
      const toCheck = offlineAssets.slice(0, 8)

      for (const asset of toCheck) {
        if (cancelled) break
        if (!asset.deviceId) continue
        
        try {
          const resp = await fetch(`/api/data?deviceID=${asset.deviceId}&limit=1`)
          if (!resp.ok) continue
          
          const data = await resp.json()
          if (cancelled) break
          
          if (Array.isArray(data) && data.length > 0 && data[0].receivedAt) {
            setFallbackDataTimestamps(prev => ({
              ...prev,
              [asset._id]: data[0].receivedAt
            }))
          }
        } catch (e) {
          // Silently skip failed fetches
        }
      }
    }
    
    run()
    return () => { cancelled = true }
  }, [assetsResp, lastActiveMap])
  
  // Compute hourly online percentage over last 24 hours by inspecting recent readings
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const totalAssets = (assetsResp?.total ?? (assetsResp?.items?.length ?? 0)) || 0
        if (!totalAssets) {
          setAssetOnlineTrend24(null)
          return
        }

        const H = 60 * 60 * 1000
        const end = effectiveToTs ?? Date.now()
        const start = end - 24 * H

        // Fetch recent readings via proxy; request the full dataset so we can inspect 24h window
        // Request a bounded number of recent rows to avoid very large responses.
        const resp = await fetch(`/api/data?limit=5000`)
        if (!resp.ok) {
          setAssetOnlineTrend24(null)
          return
        }
        const payload = await resp.json().catch(() => ({}))

        // Rows may be at payload.data or payload.data?.data or payload.data?.list etc. Normalize.
        let rows: any[] = []
        if (Array.isArray(payload?.data)) rows = payload.data
        else if (Array.isArray(payload?.data?.data)) rows = payload.data.data
        else if (Array.isArray(payload?.data?.list)) rows = payload.data.list
        else if (Array.isArray(payload)) rows = payload
        else if (Array.isArray(payload?.rows)) rows = payload.rows
        else rows = []

        // Prepare 24 sets for unique device ids per hour (use string ids — many backends use strings)
        const buckets: Set<string>[] = Array.from({ length: 24 }, () => new Set())

        // Also build per-device hourly presence map so we can render per-asset uptime bars
        const perDeviceHourSets: Record<string, Set<number>> = {}
        // Track first/last timestamp per device per hour to compute finer transition times
        const perDeviceHourTimestamps: Record<string, Record<number, { first?: number; last?: number }>> = {}

        let withinRangeCount = 0
        for (const r of rows) {
          const idRaw = r?.deviceID ?? r?.deviceId ?? r?.id ?? r?.DeviceID
          const id = idRaw != null ? String(idRaw) : ''
          if (!id) continue
          // timestamp heuristics
          const tsRaw = r?.receivedAt ?? r?.time ?? r?.t ?? r?.timestamp ?? r?.ts ?? r?.received_at
          let ts = Number(tsRaw)
          if (Number.isFinite(ts)) {
            // Convert seconds -> milliseconds when upstream provides epoch in seconds
            if (ts > 0 && ts < 1e12) ts = ts * 1000
          } else {
            const parsed = Date.parse(String(tsRaw || ''))
            ts = Number.isFinite(parsed) ? parsed : NaN
          }
          if (!Number.isFinite(ts)) continue
          if (ts < start || ts > end) continue
          withinRangeCount++
          const hourIndex = Math.floor((ts - start) / H)
          if (hourIndex >= 0 && hourIndex < 24) buckets[hourIndex].add(id)
          // Mark this device as present in this hour
          if (!perDeviceHourSets[id]) perDeviceHourSets[id] = new Set()
          perDeviceHourSets[id].add(hourIndex)
          // Track first/last ts within this hour for this device
          if (!perDeviceHourTimestamps[id]) perDeviceHourTimestamps[id] = {}
          if (!perDeviceHourTimestamps[id][hourIndex]) perDeviceHourTimestamps[id][hourIndex] = { first: ts, last: ts }
          else {
            const rec = perDeviceHourTimestamps[id][hourIndex]
            if (!rec.first || ts < (rec.first as number)) rec.first = ts
            if (!rec.last || ts > (rec.last as number)) rec.last = ts
          }
        }
        
        // Convert device IDs -> asset IDs
        const deviceIdToAssetId: Record<string, string> = {}
        for (const a of (assetsResp?.items ?? [])) {
          const dev = (a as any).deviceId ?? (a as any).deviceID ?? (a as any).id
          if (dev != null) deviceIdToAssetId[String(dev)] = a._id
        }

        // Build per-device timeline of readings (sorted by timestamp)
        const perDeviceTimeline: Record<string, number[]> = {}
        for (const r of rows) {
          const idRaw = r?.deviceID ?? r?.deviceId ?? r?.id ?? r?.DeviceID
          const id = idRaw != null ? String(idRaw) : ''
          if (!id) continue
          const tsRaw = r?.receivedAt ?? r?.time ?? r?.t ?? r?.timestamp ?? r?.ts ?? r?.received_at
          let ts = Number(tsRaw)
          if (Number.isFinite(ts)) {
            if (ts > 0 && ts < 1e12) ts = ts * 1000
          } else {
            const parsed = Date.parse(String(tsRaw || ''))
            ts = Number.isFinite(parsed) ? parsed : NaN
          }
          if (!Number.isFinite(ts)) continue
          if (ts < start || ts > end) continue
          if (!perDeviceTimeline[id]) perDeviceTimeline[id] = []
          perDeviceTimeline[id].push(ts)
        }

        // Sort timestamps for each device
        for (const id in perDeviceTimeline) {
          perDeviceTimeline[id].sort((a, b) => a - b)
        }

        // Build segments for each asset: { start, end, online }
        // Gap of ≥5 minutes = offline period
        const GAP_THRESHOLD = 5 * 60 * 1000 // 5 minutes
        const perAssetSegments: Record<string, Array<{ start: number; end: number; online: boolean }>> = {}

        for (const [devId, timestamps] of Object.entries(perDeviceTimeline)) {
          const assetId = deviceIdToAssetId[devId]
          if (!assetId) continue
          if (!perAssetSegments[assetId]) perAssetSegments[assetId] = []

          if (timestamps.length === 0) continue

          // Add offline segment from start to first reading if there's a gap
          const firstReading = timestamps[0]
          if (firstReading > start) {
            const gapFromStart = firstReading - start
            if (gapFromStart >= GAP_THRESHOLD) {
              perAssetSegments[assetId].push({ start, end: firstReading, online: false })
            }
          }

          // Build segments
          let segmentStart = timestamps[0]
          let lastTs = timestamps[0]

          for (let i = 1; i < timestamps.length; i++) {
            const currentTs = timestamps[i]
            const gap = currentTs - lastTs

            if (gap >= GAP_THRESHOLD) {
              // Close current online segment
              perAssetSegments[assetId].push({ start: segmentStart, end: lastTs, online: true })
              // Add offline segment
              perAssetSegments[assetId].push({ start: lastTs, end: currentTs, online: false })
              // Start new online segment
              segmentStart = currentTs
            }
            lastTs = currentTs
          }

          // Close final online segment
          perAssetSegments[assetId].push({ start: segmentStart, end: lastTs, online: true })

          // Add final segment to current time
          const now = end
          const gapToNow = now - lastTs
          if (gapToNow >= GAP_THRESHOLD) {
            // Device is offline now
            perAssetSegments[assetId].push({ start: lastTs, end: now, online: false })
          } else if (gapToNow > 0) {
            // Device is still online, extend to current time
            perAssetSegments[assetId].push({ start: lastTs, end: now, online: true })
          }
        }

        // For assets with no data, create a single offline segment
        for (const a of (assetsResp?.items ?? [])) {
          if (!perAssetSegments[a._id]) {
            perAssetSegments[a._id] = [{ start, end, online: false }]
          }
        }

        // Initialize per-asset uptime (kept for backward compatibility if needed)
        const perAssetUptime: Record<string, boolean[]> = {}
        for (const a of (assetsResp?.items ?? [])) {
          perAssetUptime[a._id] = Array.from({ length: 24 }, () => false)
        }

        for (const [devId, hourSet] of Object.entries(perDeviceHourSets)) {
          const assetId = deviceIdToAssetId[devId]
          if (!assetId) continue
          if (!perAssetUptime[assetId]) perAssetUptime[assetId] = Array.from({ length: 24 }, () => false)
          for (const hi of Array.from(hourSet)) {
            if (hi >= 0 && hi < 24) perAssetUptime[assetId][hi] = true
          }
        }

        // Kept for backward compatibility (unused now)
        const perAssetTransitions: Record<string, { idx: number; ts: number; dir: 'on->off' | 'off->on' }[]> = {}

        // Build trend data from segments: count assets online at each hour midpoint
        const trend = Array.from({ length: 24 }, (_, i) => {
          const t = start + i * H + Math.floor(H / 2)
          let onlineCount = 0
          
          // For each asset, check if it's online at this time point
          for (const a of (assetsResp?.items ?? [])) {
            const assetId = a._id
            const devId = Object.keys(deviceIdToAssetId).find(k => deviceIdToAssetId[k] === assetId)
            if (!devId) continue
            
            const timestamps = perDeviceTimeline[devId]
            if (!timestamps || timestamps.length === 0) continue
            
            // Find the last reading before or at this time point
            let lastReadingBefore = -Infinity
            for (const ts of timestamps) {
              if (ts <= t && ts > lastReadingBefore) lastReadingBefore = ts
            }
            
            // If there's a reading and the gap is < 5 minutes, count as online
            if (lastReadingBefore !== -Infinity && (t - lastReadingBefore) < GAP_THRESHOLD) {
              onlineCount++
            }
          }
          
          const v = Math.round((onlineCount / totalAssets) * 100)
          return { t, v }
        })

        // Debugging info: print counts so we can inspect why fallback is used
        try {
          // Limit logging noise — only log in non-production or when console is available
          if (typeof console !== 'undefined') {
            console.debug('[Dashboard] assetOnlineTrend24 debug', {
              rowsCount: rows.length,
              withinRangeCount,
              totalAssets,
              sampleTrendValues: trend.slice(0, 8).map(x => x.v),
            })
          }
        } catch (e) {
          // ignore
        }

        // If the fetch returned no rows inside the 24h window, avoid overwriting
        // an existing valid `assetOnlineTrend24` with an empty result. This prevents
        // the UI from flipping back to the demo/fallback series when upstream
        // responses are delayed or paginated.
        if (!cancelled) {
          if (withinRangeCount === 0) {
            // Only clear state if we don't already have a trend.
            // Use functional read to avoid a stale closure.
            setAssetOnlineTrend24((prev) => (prev && prev.length > 0 ? prev : null))
            setPerAssetUptime24((prev) => (prev && Object.keys(prev).length > 0 ? prev : null))
            setPerAssetSegments24((prev) => (prev && Object.keys(prev).length > 0 ? prev : null))
          } else {
            setAssetOnlineTrend24(trend)
            setPerAssetUptime24(perAssetUptime)
            setPerAssetSegments24(perAssetSegments)
          }
        }
      } catch (e) {
        if (!cancelled) setAssetOnlineTrend24(null)
      }
    }
    run()
    return () => { cancelled = true }
  }, [assetsResp, effectiveToTs])
  // Per-hour asset-online trend for last 24 hours (percent of assets with >=1 reading in hour)
  const [assetOnlineTrend24, setAssetOnlineTrend24] = useState<{ t: number; v: number }[] | null>(null)
  // Per-asset uptime map for last 24 hours: assetId -> boolean[24]
  const [perAssetUptime24, setPerAssetUptime24] = useState<Record<string, boolean[]> | null>(null)
  // Per-asset segments for last 24h: assetId -> [{ start, end, online }]
  const [perAssetSegments24, setPerAssetSegments24] = useState<Record<string, Array<{ start: number; end: number; online: boolean }>> | null>(null)
  // Fetch and build per-device aggregated series when user clicks Apply for multi-asset selection
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        if (!appliedDeviceIds || appliedDeviceIds.length < 2) {
          if (!cancelled) {
            setMultiAssetSeries(null)
            setMultiAssetTicks(null)
            setMultiAssetDomain(null)
            setMultiAggLoading(false)
          }
          return
        }
        if (!fromTs || !effectiveToTs) return

        setMultiAggLoading(true)

        // Build device list for upstream call
        const devicesPayload = appliedDeviceIds.map((devId) => ({ deviceID: Number(devId), start_date: new Date(fromTs).toISOString(), end_date: new Date(effectiveToTs).toISOString() }))

        const resp = await fetch('/api/data/range', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ devices: devicesPayload })
        })
        if (!resp.ok) {
          if (!cancelled) setMultiAggLoading(false)
          return
        }
        const payload = await resp.json().catch(() => ({}))
        const results = Array.isArray(payload?.results) ? payload.results : []

        const perDeviceAggregated: Record<string, { points: any[]; ticks: number[]; domain: [number, number] }> = {}
        let globalStart: number | null = null
        let globalEnd: number | null = null

        for (const r of results) {
          const devId = String(r?.deviceID ?? r?.deviceId ?? '')
          if (!devId) continue
          const points = Array.isArray(r?.points) ? r.points : []

          // points are expected to be already aggregated and shaped as { time, values }
          const normalizedPoints = points.map((p: any) => {
            const timeRaw = p.time ?? p.t ?? p.ts ?? p.timestamp ?? p.start ?? p.from
            let timeNum = Number(timeRaw)
            if (!Number.isFinite(timeNum)) {
              const parsed = Date.parse(String(timeRaw || ''))
              timeNum = Number.isFinite(parsed) ? parsed : NaN
            }
            if (!Number.isFinite(timeNum)) return null
            return { time: timeNum, values: p.values ?? p }
          }).filter(Boolean) as { time: number; values: Record<string, number | null> }[]

          if (!normalizedPoints.length) continue

          const ticks = normalizedPoints.map(p => p.time).sort((a, b) => a - b)
          const domain: [number, number] = [ticks[0], ticks[ticks.length - 1]]
          perDeviceAggregated[devId] = { points: normalizedPoints, ticks, domain }

          if (domain) {
            if (globalStart == null || domain[0] < globalStart) globalStart = domain[0]
            if (globalEnd == null || domain[1] > globalEnd) globalEnd = domain[1]
          }
        }

        if (!globalStart || !globalEnd) {
          if (!cancelled) {
            setMultiAssetSeries([])
            setMultiAssetTicks([])
            setMultiAssetDomain(null)
            setMultiAggLoading(false)
          }
          return
        }

        const maxTicks = isNarrow ? 6 : 9
        const allTimesSet = new Set<number>()
        for (const agg of Object.values(perDeviceAggregated)) {
          for (const p of agg.points) {
            const t = Number(p.time)
            if (Number.isFinite(t)) allTimesSet.add(t)
          }
        }
        const allTimes = Array.from(allTimesSet).sort((a, b) => a - b)
        let ticks: number[] = []
        if (allTimes.length === 0) {
          ticks = generateEvenTicks(globalStart, globalEnd, maxTicks)
        } else if (allTimes.length <= maxTicks) {
          ticks = allTimes
        } else {
          ticks = selectEvenlySpaced(allTimes, maxTicks)
        }

        const combined: any[] = allTimes.map((t) => ({ time: t }))
        for (const devId of Object.keys(perDeviceAggregated)) {
          const agg = perDeviceAggregated[devId]
          const map = new Map<number, Record<string, number | null>>()
          for (const p of agg.points) map.set(Number(p.time), p.values || {})
          for (let i = 0; i < allTimes.length; i++) {
            const t = allTimes[i]
            const vals = map.has(t) ? map.get(t) as Record<string, number | null> : {}
            for (const metric of allMetrics) {
              combined[i][`d_${devId}__${metric}`] = vals ? (Number.isFinite(Number(vals[metric])) ? Number(vals[metric]) : null) : null
            }
          }
        }

        for (let i = 0; i < combined.length; i++) {
          const row = combined[i]
          for (const metric of allMetrics) {
            const vals: number[] = []
            for (const devId of Object.keys(perDeviceAggregated)) {
              const v = row[`d_${devId}__${metric}`]
              if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(Number(v))
            }
            row[`avg__${metric}`] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
          }
        }

        if (!cancelled) {
          setMultiAssetSeries(combined)
          setMultiAssetTicks(ticks)
          setMultiAssetDomain([globalStart, globalEnd])
          setMultiAggLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setMultiAssetSeries([])
          setMultiAssetTicks([])
          setMultiAssetDomain(null)
          setMultiAggLoading(false)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [appliedDeviceIds, fromTs, effectiveToTs, isNarrow, selectedMetrics])
  // State for IonRain device power status (deviceId -> supplySTATUS from device data)
  const [ionRainSupplyStatus, setIonRainSupplyStatus] = useState<Record<string, string>>({})
  // Command interaction state for IonRain devices
  const [ionRainCommandLoading, setIonRainCommandLoading] = useState<Record<string, boolean>>({})
  const [ionRainCommandLog, setIonRainCommandLog] = useState<Record<string, { ts: number; message: string; status?: string }[]>>({})
  const [ionRainCommandStatus, setIonRainCommandStatus] = useState<Record<string, string>>({})
  // supplyFAULT from real-time data
  const [ionRainRealTimeFault, setIonRainRealTimeFault] = useState<Record<string, string | number | undefined>>({})
  
  const [searchQuery, setSearchQuery] = useState("")
  
  // Helper function to convert fault code to message
  const getFaultMessage = (faultCode: string | number | undefined): { message: string; isOk: boolean } => {
    const code = Number(faultCode)
    if (isNaN(code)) return { message: 'Unknown', isOk: false }
    
    switch (code) {
      case 0:
        return { message: 'No Fault', isOk: true }
      case 1:
        return { message: 'Supply Fault', isOk: false }
      case 2:
        return { message: 'CC Mode', isOk: false }
      case 3:
        return { message: 'High Humidity', isOk: false }
      default:
        return { message: 'Unknown', isOk: false }
    }
  }
  
  // Fetch supplySTATUS and supplyFAULT for IonRain devices 
  useEffect(() => {
    let cancelled = false
    const fetchIonRainStatus = async () => {
      try {
        const items = (assetsResp?.items ?? []) as ApiAsset[]
        const ionRainDevices = items.filter(a => a.type === 'IonRain')
        
        if (!ionRainDevices.length) return
        
        // Fetch latest data for each IonRain device
        const statusPromises = ionRainDevices.map(async (device) => {
          const deviceId = (device as any).deviceId ?? (device as any).deviceID ?? (device as any).id
          if (!deviceId) return null
          // If a command is currently in-flight for this device, don't override UI
          // Check the current state directly to avoid dependency on ionRainCommandLoading
          if (ionRainCommandLoading[String(deviceId)]) return null
          
          try {
            const resp = await fetch(`/api/data?deviceID=${deviceId}&limit=1`)
            if (!resp.ok) return null
            
            const payload = await resp.json()
            let rows: any[] = []
            if (Array.isArray(payload?.data)) rows = payload.data
            else if (Array.isArray(payload?.data?.data)) rows = payload.data.data
            else if (Array.isArray(payload)) rows = payload
            
            if (rows.length > 0) {
              const row = rows[0]
              const status = row.supplySTATUS
              const fault = row.supplyFAULT
              
              // Normalize fault value
              let faultNormalized: string | number | undefined
              if (fault !== undefined && fault !== null) {
                if (typeof fault === 'number') faultNormalized = fault
                else if (typeof fault === 'string') faultNormalized = fault.trim()
                else faultNormalized = String(fault)
              }
              
              return { 
                deviceId: String(deviceId), 
                status: status || undefined,
                fault: faultNormalized
              }
            }
            return null
          } catch (e) {
            return null
          }
        })
        
        const results = await Promise.all(statusPromises)
        if (cancelled) return
        // Merge into existing map to prevent flicker when some devices have no new value
        const statusUpdates: Record<string, string> = {}
        const faultUpdates: Record<string, string | number | undefined> = {}
        for (const result of results) {
          if (result) {
            if (result.status) statusUpdates[result.deviceId] = result.status
            if (result.fault !== undefined) faultUpdates[result.deviceId] = result.fault
          }
        }
        if (Object.keys(statusUpdates).length) {
          setIonRainSupplyStatus(prev => ({ ...prev, ...statusUpdates }))
        }
        if (Object.keys(faultUpdates).length) {
          setIonRainRealTimeFault(prev => ({ ...prev, ...faultUpdates }))
        }
      } catch (e) {
        if (!cancelled) setIonRainSupplyStatus({})
      }
    }
    
    fetchIonRainStatus()
    // Poll every 30 seconds instead of depending on ionRainCommandLoading
    const interval = setInterval(fetchIonRainStatus, 30000)
    
    return () => { 
      cancelled = true
      clearInterval(interval)
    }
  }, [assetsResp]) // Removed ionRainCommandLoading dependency
  
  // Manual refresh handler
  const handleManualRefresh = () => {
    refreshAgg()
  }
  // Handler for IonRain device power toggle
  const handleIonRainPowerToggle = async (deviceId: string, turnOn: boolean) => {
    try {
      const supplySTATUS = turnOn ? 'ON' : 'OFF'
      // set loading state & initialize log
      setIonRainCommandLoading(prev => ({ ...prev, [deviceId]: true }))
      setIonRainCommandLog(prev => ({
        ...prev,
        [deviceId]: [
          ...(prev[deviceId] || []),
          { ts: Date.now(), message: `Sending command supplySTATUS=${supplySTATUS}` }
        ]
      }))
      // Fire command to backend via our proxy
      const resp = await fetch(`/api/commands/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceID: Number(deviceId), supplySTATUS })
      })
      const json = await resp.json().catch(() => ({ error: true, message: 'Invalid response' }))
      setIonRainCommandLog(prev => ({
        ...prev,
        [deviceId]: [
          ...(prev[deviceId] || []),
          { ts: Date.now(), message: json?.message || 'Command response received', status: json?.status }
        ]
      }))
      if (!resp.ok) {
        setIonRainCommandLoading(prev => ({ ...prev, [deviceId]: false }))
        return
      }
      // Start polling for status
      pollIonRainCommandStatus(deviceId, supplySTATUS)
    } catch (error) {
      console.error('Failed to toggle IonRain device:', error)
      setIonRainCommandLog(prev => ({
        ...prev,
        [deviceId]: [
          ...(prev[deviceId] || []),
          { ts: Date.now(), message: 'Error sending command', status: 'error' }
        ]
      }))
      setIonRainCommandLoading(prev => ({ ...prev, [deviceId]: false }))
    }
  }
  // Poll command status until processed
  const pollIonRainCommandStatus = async (deviceId: string, expectedPower: string) => {
    const poll = async () => {
      if (!mountedRef.current) return
      try {
        const resp = await fetch(`/api/commands/poll?deviceID=${deviceId}`)
        const json = await resp.json().catch(() => ({}))
        if (!mountedRef.current) return
        const status = json?.status
        const message = (json?.message || '').toString().toLowerCase()
        setIonRainCommandStatus(prev => ({ ...prev, [deviceId]: status || 'unknown' }))
        setIonRainCommandLog(prev => ({
          ...prev,
          [deviceId]: [
            ...(prev[deviceId] || []),
            { ts: Date.now(), message: json?.message || 'Polling...', status }
          ]
        }))
        // Stop on processed OR explicit error indicating not understood
        if (status === 'processed') {
          const finalSupply = json?.supplySTATUS || expectedPower
          setIonRainSupplyStatus(prev => ({ ...prev, [deviceId]: finalSupply }))
          setIonRainCommandLoading(prev => ({ ...prev, [deviceId]: false }))
          setIonRainCommandLog(prev => ({
            ...prev,
            [deviceId]: [
              ...(prev[deviceId] || []),
              { ts: Date.now(), message: `Command complete. supplySTATUS=${finalSupply}`, status: 'complete' }
            ]
          }))
          return
        } else if (status === 'error' && message.includes('not understood')) {
          // Finalize on error not understood by device
          const finalSupply = json?.supplySTATUS || expectedPower
          setIonRainSupplyStatus(prev => ({ ...prev, [deviceId]: finalSupply }))
          setIonRainCommandLoading(prev => ({ ...prev, [deviceId]: false }))
          setIonRainCommandLog(prev => ({
            ...prev,
            [deviceId]: [
              ...(prev[deviceId] || []),
              { ts: Date.now(), message: `Device did not understand command. supplySTATUS=${finalSupply}`, status: 'error' }
            ]
          }))
          return
        }
        // No timeout: keep polling until processed
        setTimeout(poll, 2000)
      } catch (e) {
        if (!mountedRef.current) return
        // Keep loading and continue polling even on transient errors
        setIonRainCommandLog(prev => ({
          ...prev,
          [deviceId]: [
            ...(prev[deviceId] || []),
            { ts: Date.now(), message: 'Polling error', status: 'error' }
          ]
        }))
        setTimeout(poll, 2000)
      }
    }
    poll()
  }
  // Build series: prefer backend, fallback to deterministic demo
  const { aqiSeries, pollutantSeries, latestBackendAt, ticks, domain } = useMemo(() => {
    const days = Array.from({ length: 14 }).map((_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (13 - i))
      return d.toLocaleDateString()
    })
    const seeded = (seed: number) => {
      let s = seed
      return () => {
        s = (s * 1664525 + 1013904223) % 4294967296
        return s / 4294967296
      }
    }
    const r1 = seeded(42)
    const aqiSeries = days.map((day) => ({
      day,
      AQI: Math.round(60 + r1() * 80),
    }))
    // No demo fallback for pollutant plotting: only use backend aggregated data
    let pollutantSeries: any[] = []
    // If aggregated data exists, use it for the pollutant series
    let latestBackendAt: Date | undefined
    let ticks: number[] | undefined
    let domain: [number, number] | undefined
    if (agg) {
      // Normalize common response shapes: some backends nest points under `data`, `buckets`, or `items`.
      const pts = (agg as any).points ?? (agg as any).data ?? (agg as any).buckets ?? (agg as any).items ?? []
      const tks = (agg as any).ticks ?? (agg as any).tick ?? (agg as any).ticks ?? []
      const startVal = (agg as any).start ?? (agg as any).startTime ?? (agg as any).from
      const endVal = (agg as any).end ?? (agg as any).endTime ?? (agg as any).to
      if (Array.isArray(pts) && pts.length) {
        console.log(`[Dashboard] Using aggregated data: ${pts.length} points`)
        console.log(`[Dashboard] First point:`, pts[0])
        console.log(`[Dashboard] Last point:`, pts[pts.length - 1])
        console.log(`[Dashboard] Domain:`, [startVal, endVal])
        console.log(`[Dashboard] Ticks count:`, (tks || []).length)
       
        const norm = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
        const findVal = (obj: any, metric: string) => {
          const target = norm(metric)
          for (const k of Object.keys(obj || {})) {
            const nk = norm(k)
            if (nk.includes(target)) return obj[k]
          }
          return undefined
        }
        pollutantSeries = pts.map((p: any) => {
          const readingCount = Number(p.readingCount || p.count || 0)
          const rawA = findVal(p, 'AQI')
          const rawPM25 = findVal(p, 'PM2.5')
          const rawPM10 = findVal(p, 'PM10')
          const rawCO = findVal(p, 'CO')
          const rawNO2 = findVal(p, 'NO2')
          const rawO3 = findVal(p, 'O3')
          const rawSO2 = findVal(p, 'SO2')
    const rawTemp = findVal(p, 'Temperature')
    const rawHum = findVal(p, 'Humidity')
    const rawPress = findVal(p, 'Pressure')
          const hasReading = readingCount > 0 || [rawA, rawPM25, rawPM10, rawCO, rawNO2, rawO3, rawSO2].some(v => v !== undefined && v !== null)
          const toNum = (v: any) => {
            if (v === undefined || v === null) return null
            const n = Number(v)
            return Number.isFinite(n) ? n : null
          }
          const timeRaw = p.time ?? p.t ?? p.ts ?? p.timestamp ?? p.start ?? p.from
          let timeNum = Number(timeRaw)
          if (!Number.isFinite(timeNum)) {
            const parsed = Date.parse(String(timeRaw || ''))
            timeNum = Number.isFinite(parsed) ? parsed : NaN
          }
          return {
            time: Number.isFinite(timeNum) ? timeNum : NaN,
            PM2_5: hasReading ? toNum(rawPM25) : null,
            PM10: hasReading ? toNum(rawPM10) : null,
            CO: hasReading ? toNum(rawCO) : null,
            NO2: hasReading ? toNum(rawNO2) : null,
            O3: hasReading ? toNum(rawO3) : null,
            SO2: hasReading ? toNum(rawSO2) : null,
            AQI: hasReading ? toNum(rawA) : null,
            Temperature: hasReading ? toNum(rawTemp) : null,
            Humidity: hasReading ? toNum(rawHum) : null,
            Pressure: hasReading ? toNum(rawPress) : null,
            readingCount: readingCount,
          }
        })
        ticks = tks
        domain = (startVal && endVal) ? [Number(startVal), Number(endVal)] as [number, number] : [pollutantSeries[0]?.time, pollutantSeries[pollutantSeries.length - 1]?.time]
        const lastTime = pollutantSeries[pollutantSeries.length - 1]?.time
        if (Number.isFinite(lastTime)) latestBackendAt = new Date(Number(lastTime))
      } else {
        // Aggregated response returned but with no points -> show empty (no demo fallback)
        pollutantSeries = []
        ticks = []
        domain = undefined
      }
    } else {
      console.log('[Dashboard] No aggregated data')
      // For a selected date or explicit last 24 hours view, don't show demo
      if (selectedDate || range === '24h') {
        pollutantSeries = []
        ticks = []
        domain = undefined
      } else {
        console.log('[Dashboard] Using demo data for broader ranges')
      }
    }
    return { aqiSeries, pollutantSeries, latestBackendAt, ticks, domain }
  }, [agg, selectedDate, range])
  // Downsample adaptively on narrow screens
  const { displaySeries, displayTicks, displayDomain } = useMemo(() => {
    // If no pollutantSeries, return early
    if (!pollutantSeries?.length) return { displaySeries: pollutantSeries, displayTicks: ticks, displayDomain: domain }

  // Global strict cap for axis labels: no more than 6 on narrow screens,
  // no more than 9 on desktop. This applies to all time periods.
  const GLOBAL_MAX_LABELS = isNarrow ? 6 : 9

  // Determine domain span (use provided domain or derive from series)
  const firstTime = pollutantSeries[0]?.time
  const lastTime = pollutantSeries[pollutantSeries.length - 1]?.time
  // use the upstream `domain` (from aggregate normalization) if available
  const domStart = domain?.[0] ?? firstTime
  const domEnd = domain?.[1] ?? lastTime
    const span = Math.max(0, Number(domEnd) - Number(domStart))

    // If the user-selected span is larger than 30 days, do not show any data
    if (isSpanTooLarge) {
      console.log('[Dashboard] Selected span > 30 days — hiding chart')
      return { displaySeries: [], displayTicks: [], displayDomain: undefined }
    }

    // Choose binning behavior:
    // - if span <= 24 hours => group by 2 minute bins (skip empty minutes) but thin axis labels to <= 12
    // - else => try to form bins so each has ~minPerBin raw points, capped at maxBins (15)
    const H = 60 * 60 * 1000
    const isWithin24h = span <= 24 * H

    // Helper: insert a null-valued point between any two consecutive points
    // whose gap is significantly larger than the typical step. Recharts will
    // render a break in the line when it encounters null values (connectNulls=false).
      // we no longer inject synthetic null points here; downstream we split into
      // segments and render each segment separately so the line won't be drawn
      // across large gaps while also avoiding horizontal empty space.

      if (isWithin24h) {
      // For 24h or less, plot every backend point as-is (preserve per-minute/raw points if backend provides them).
      // We will not re-bin into larger buckets here; instead we show each input point and only thin the
      // axis tick labels to avoid collisions (max 12 labels).
      // Backend now provides minute-aligned aggregated points for 24h windows.
      // Use them directly (they include zero-valued minutes for gaps) and sort by time.
  const grouped = pollutantSeries.map((p: any) => ({ ...p })).sort((a: any, b: any) => Number(a.time) - Number(b.time))
      const tksFull = grouped.map((g) => g.time)
  // Tick label caps: enforce GLOBAL_MAX_LABELS
  const maxLabelTicks = GLOBAL_MAX_LABELS
      let tks = tksFull
      if (tksFull.length > maxLabelTicks) {
        // Use evenly distributed selection for consistent gaps
        tks = selectEvenlySpaced(tksFull, maxLabelTicks)
      }
      // For narrow screens, resample 24h data to 10-minute bins to reduce points
      const resampleToInterval = (series: any[], intervalMs: number) => {
        if (!series || !series.length) return series
        const map = new Map<number, any[]>()
        for (const p of series) {
          const key = Math.floor(Number(p.time) / intervalMs) * intervalMs
          const arr = map.get(key) || []
          arr.push(p)
          map.set(key, arr)
        }
        const out: any[] = []
        const keys = Object.keys(series[0] || {}).filter(k => k !== 'time')
        for (const [t, arr] of Array.from(map.entries()).sort((a, b) => a[0] - b[0])) {
          const o: any = { time: t }
          o.readingCount = arr.reduce((s, x) => s + (Number(x.readingCount) || 0), 0)
          for (const k of keys) {
            if (k === 'readingCount') continue
            const vals = arr.map(x => x[k]).filter(v => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number)
            o[k] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
          }
          out.push(o)
        }
        return out
      }

      let finalSeries = grouped
      if (isNarrow) {
        // On small screens for <=24h prefer 2-minute plotting to keep resolution
        // high while showing slightly more ticks (max 7)
        const twoMin = 2 * 60 * 1000
        finalSeries = resampleToInterval(grouped, twoMin)
      }

      const dom = finalSeries.length ? [finalSeries[0].time, finalSeries[finalSeries.length - 1].time] as [number, number] : domain
      return { displaySeries: finalSeries, displayTicks: tks, displayDomain: dom }
    }

    //fallback for spans > 24h: use tiered binning (user-facing rules):
    //- <= 3 days: 5 minute bins (higher resolution)
    //- 3-7 days: 1 hour bins
    //- 7-30 days: 4 hour bins (keeps point count reasonable)
    //also: cap selectable window to 30 days (upstream UI should enforce, but double-check)
  //global tick targets: cap labels to GLOBAL_MAX_LABELS. Allow a small
  //minimum so we don't try to force-add labels above the cap.
  const minTicks = isNarrow ? 3 : 6
  const maxTicks = GLOBAL_MAX_LABELS

    const maxWindowMs = 30 * 24 * H
    //use a mutable sourceSeries so we don't accidentally reassign the outer pollutantSeries
    let sourceSeries = (pollutantSeries || []).slice()
    if (span > maxWindowMs) {
      //if the requested range is > 30 days, clamp to last 30 days
      //(frontend clamping only; ideally server also enforces).
      const clampedStart = Number(domEnd) - maxWindowMs
      // filter series to the clamped window
      sourceSeries = sourceSeries.filter((p: any) => Number(p.time) >= clampedStart)
    }

    //choose bin size based on span. For 24-48h prefer a smaller bin to avoid
    //adjacent tick labels merging — reduce to 2-minute bins and slightly lower
    //the max tick cap for that case. For 48-72h use 5-minute bins; then hours.
    let binMsChoice = 0
    let effectiveMaxTicks = maxTicks
    if (span <= 2 * 24 * H) {
      binMsChoice = 2 * 60 * 1000 // 2 minutes for up to 48h
      // Respect GLOBAL_MAX_LABELS
      effectiveMaxTicks = GLOBAL_MAX_LABELS
    } else if (span <= 3 * 24 * H) {
      binMsChoice = 5 * 60 * 1000 // 5 minutes
      // For a 3-day window on narrow screens cap to our narrow max
      if (isNarrow) effectiveMaxTicks = GLOBAL_MAX_LABELS
    } else if (span <= 4 * 24 * H) {
      // 3-4 day window - use 30-minute bins to avoid final tick collisions
      binMsChoice = 30 * 60 * 1000 // 30 minutes
  // reduce tick cap slightly to give labels room and avoid merging;
  // respect GLOBAL_MAX_LABELS for both narrow and desktop (desktop cap is 10)
  effectiveMaxTicks = GLOBAL_MAX_LABELS
    } else if (span <= 7 * 24 * H) {
      binMsChoice = 60 * 60 * 1000 // 1 hour
    } else {
      binMsChoice = 4 * 60 * 60 * 1000 // 4 hours
    }

    // Align domStart to the bin boundary so bin sizes are deterministic
    const domStartAligned = Math.floor(Number(domStart) / binMsChoice) * binMsChoice
    // Build time-aligned bins starting from domStartAligned using sourceSeries
    const binMap = new Map<number, any[]>()
    for (const p of sourceSeries as any[]) {
      const t = Number(p.time)
      if (!Number.isFinite(t)) continue
      const idx = Math.floor((t - domStartAligned) / binMsChoice)
      const key = domStartAligned + idx * binMsChoice
      const arr = binMap.get(key) || []
      arr.push(p)
      binMap.set(key, arr)
    }

    // Aggregate each bin with weighted averages (readingCount if available)
    const groupedRaw: any[] = []
    const keysSet: Set<string> = new Set()
    for (const [t, arr] of Array.from(binMap.entries()).sort((a, b) => a[0] - b[0])) {
      const out: any = { time: t, readingCount: 0 }
      // collect keys
      for (const item of arr) {
        for (const k of Object.keys(item)) {
          if (k === 'time' || k === 'readingCount') continue
          if (typeof item[k] === 'number') keysSet.add(k)
        }
        out.readingCount = (out.readingCount ?? 0) + (Number(item.readingCount ?? item.count ?? 0) || 0)
      }
      // compute weighted averages per numeric key
      for (const k of keysSet) {
        let sum = 0
        let w = 0
        for (const item of arr) {
          const val = Number(item[k])
          if (!Number.isFinite(val)) continue
          const rw = Number(item.readingCount ?? item.count ?? 0)
          const weight = Number.isFinite(rw) && rw > 0 ? rw : 1
          sum += val * weight
          w += weight
        }
        out[k] = w > 0 ? Math.round(sum / w) : null
      }
      groupedRaw.push(out)
    }

    // Filter out empty bins
    const grouped = groupedRaw.filter((g) => {
      if (g.readingCount && Number(g.readingCount) > 0) return true
      for (const k of Object.keys(g)) {
        if (k === 'time' || k === 'readingCount') continue
        const v = g[k]
        if (typeof v === 'number' && Number.isFinite(v)) return true
      }
      return false
    })

    // Build tick candidates from grouped times and thin to min/max tick targets
    const tksFull = grouped.map((g) => g.time)
    let tks = tksFull
    if (tksFull.length > effectiveMaxTicks) {
      // Use evenly distributed selection for consistent gaps
      tks = selectEvenlySpaced(tksFull, effectiveMaxTicks)
    }

    // If there are too few ticks, try to add evenly spaced ones up to minTicks (when possible)
    if (tks.length < minTicks && tksFull.length > 0) {
      const need = Math.min(minTicks, tksFull.length, GLOBAL_MAX_LABELS)
      tks = selectEvenlySpaced(tksFull, need)
    }

    const dom = grouped.length ? [grouped[0].time, grouped[grouped.length - 1].time] as [number, number] : domain
    return { displaySeries: grouped, displayTicks: tks, displayDomain: dom }
  }, [isNarrow, pollutantSeries, ticks, domain, range, selectedDate])
  // Use displaySeries directly without CO scaling
  const plotSeries = useMemo(() => {
    return displaySeries
  }, [displaySeries])

  //build an indexed (compressed) series that removes empty timespans from the x-axis
  //while still allowing us to split into segments where there are large gaps so the
  //line does not draw across missing data. We return:
  //- concatenated: flat array of all points with x index
  //- segments: array of arrays (each segment is a contiguous block without large gaps)
  //- tickIndices: ticks mapped to the new x indices
  const { concatenatedSeries, segments, tickIndices } = useMemo(() => {
    if (!plotSeries || !plotSeries.length) return { concatenatedSeries: [], segments: [], tickIndices: [] }
    // sort by time
    const s = plotSeries.slice().sort((a: any, b: any) => Number(a.time) - Number(b.time))
    // compute diffs and median
    const diffs: number[] = []
    for (let i = 1; i < s.length; i++) {
      const a = Number(s[i - 1].time)
      const b = Number(s[i].time)
      if (Number.isFinite(a) && Number.isFinite(b)) diffs.push(Math.max(0, b - a))
    }
    const sorted = diffs.slice().sort((x, y) => x - y)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length ? (sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)) : 0
    const threshold = median ? Math.max(median * 1.5, median + 1) : 0

    const segments: any[][] = []
    let curSeg: any[] = []
    for (let i = 0; i < s.length; i++) {
      if (i === 0) {
        curSeg.push(s[i]);
        continue
      }
      const prev = Number(s[i - 1].time)
      const now = Number(s[i].time)
      const gap = now - prev
      if (threshold > 0 && gap > threshold) {
        // start new segment
        segments.push(curSeg)
        curSeg = [s[i]]
      } else {
        curSeg.push(s[i])
      }
    }
    if (curSeg.length) segments.push(curSeg)

    // flatten and assign x indices sequentially
    const concatenated: any[] = []
    for (const seg of segments) {
      for (const p of seg) {
        concatenated.push({ ...p })
      }
    }
    for (let i = 0; i < concatenated.length; i++) concatenated[i].x = i

    // map displayTicks (timestamps) to x indices for XAxis ticks
    const tickIndices = (displayTicks || []).map((t: number) => concatenated.findIndex((p: any) => Number(p.time) === Number(t))).filter((i: number) => i >= 0)
    // build segments with assigned x indices
    const segmentsWithIndices: any[][] = []
    let idx = 0
    for (const seg of segments) {
      const s2: any[] = []
      for (const p of seg) {
        const found = concatenated.find((c) => Number(c.time) === Number(p.time))
        const x = found ? found.x : idx
        s2.push({ ...p, x })
        idx = Math.max(idx, x + 1)
      }
      segmentsWithIndices.push(s2)
    }
    return { concatenatedSeries: concatenated, segments: segmentsWithIndices, tickIndices }
  }, [plotSeries, displayTicks])
  // Bar chart domain padding so first/last bars don't clip outside the left/right edges
  const barDomain = useMemo(() => {
    // For index-based compressed x-axis, pad by half a bucket so bars render fully
    const n = concatenatedSeries?.length ?? 0
    if (!n) return ['auto', 'auto'] as any
    return [-0.5, Math.max(0, n - 0.5)] as [number, number]
  }, [displayDomain, displayTicks, isNarrow])
  const metricColors: Record<MetricKey, string> = {
    AQI: "#8b5cf6",
    PM2_5: "#FF6B6B",
    PM10: "#FFB86B",
    CO: "#FFD56B",
    NO2: "#6BCBFF",
    O3: "#6BFF95",
    SO2: "#C56BFF",
    Temperature: "#FF9999",
    Humidity: "#3B82F6",
    Pressure: "#60A5FA"
  }
  // Custom tooltip - simple display without list
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null

    const data = payload[0].payload
    const timeStr = new Date(data.time).toLocaleString([], {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })

    // helper to format metric keys (use centralized formatter)
    const formatMetric = (n: string) => metricLabel(String(n))

    return (
      <div className="rounded-lg border bg-background p-3 shadow-lg">
        <div className="text-xs font-semibold mb-2 border-b pb-1">{timeStr}</div>
        {data.readingCount && (
          <div className="text-xs text-muted-foreground mb-2">
            {data.readingCount} readings averaged
          </div>
        )}
        <div className="space-y-1">
          {payload.map((entry: any, index: number) => {
            if (entry.dataKey === 'readingCount') return null
            const display = entry.value === null || entry.value === undefined ? '—' : entry.value

            let label = ''
            let metric = ''
            const key = String(entry.dataKey)
            if (key.startsWith('d_')) {
              const rest = key.slice(2)
              const parts = rest.split('__')
              const devId = parts[0]
              metric = parts[1]
              const asset = assets.find(a => String((a as any).deviceId) === devId)
              label = asset ? (asset.name || devId) : devId
              if (metric) label = `${label} — ${formatMetric(metric)}`
            } else if (key.startsWith('avg__')) {
              metric = key.slice(5)
              label = `Average — ${formatMetric(metric)}`
            } else if (key === 'average') {
              label = 'Average'
            } else {
              metric = entry.name || entry.dataKey
              label = formatMetric(metric)
            }

            // Get unit for the metric
            const unit = metric ? unitForMetric(metric) : ''

            return (
              <div key={index} className="flex items-center justify-between gap-4 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                  {label}
                </span>
                <span className="font-semibold">{display}{unit ? ` ${unit}` : ''}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  // Custom axis tick: render date and time on two lines to avoid overlap
  const CustomTick = ({ x, y, payload }: any) => {
    try {
      const v = Number(payload?.value)
      if (!Number.isFinite(v)) return <g />
      const d = new Date(v)
      const dateStr = d.toLocaleDateString([], { month: 'short', day: '2-digit' })
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
      // position the two lines centered on tick x; use hanging baseline so both lines stay above axis
      return (
        <g transform={`translate(${x},${y + 1})`}>
          <text textAnchor="middle" fontSize={10} fill="var(--muted-foreground, #6b7280)" dominantBaseline="hanging">
            <tspan x={0} dy={0}>{dateStr}</tspan>
            <tspan x={0} dy="1.1em">{timeStr}</tspan>
          </text>
        </g>
      )
    } catch (e) {
      return <g />
    }
  }
  // Custom tick for indexed (compressed) x-axis: payload.value is an index into concatenatedSeries
  const CustomTickIndexed = ({ x, y, payload }: any) => {
    try {
      const v = Number(payload?.value)
      if (!Number.isFinite(v)) return <g />
      const point = concatenatedSeries?.[v]
      const timeNum = point ? Number(point.time) : NaN
      if (!Number.isFinite(timeNum)) return <g />
      const d = new Date(timeNum)
      const dateStr = d.toLocaleDateString([], { month: 'short', day: '2-digit' })
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
      return (
        <g transform={`translate(${x},${y + 1})`}>
          <text textAnchor="middle" fontSize={10} fill="var(--muted-foreground, #6b7280)" dominantBaseline="hanging">
            <tspan x={0} dy={0}>{dateStr}</tspan>
            <tspan x={0} dy="1.1em">{timeStr}</tspan>
          </text>
        </g>
      )
    } catch (e) {
      return <g />
    }
  }
  

  return (
    <AppShell>
      <Topbar title="Dashboard" searchQuery={searchQuery} onSearchChange={setSearchQuery} />
     
      {/* Dashboard Header with Export Button */}
      <div className="mb-4 flex flex-col sm:flex-row items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-balance">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of air quality metrics and trends.</p>
        </div>
        <ExportDialog />
      </div>
      
      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4 mb-6">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2 flex items-center justify-between">
            <CardTitle className="text-base">Air Quality</CardTitle>
            <div>
              <select
                value={aqiMetric}
                onChange={(e) => setAqiMetric(e.target.value as MetricKey)}
                className="h-7 rounded-md border border-gray-300 bg-background px-2 text-sm"
              >
                <option value="AQI">AQI</option>
                <option value="PM2_5">PM2.5</option>
                <option value="PM10">PM10</option>
                <option value="CO">CO</option>
                <option value="NO2">NO₂</option>
                <option value="O3">O₃</option>
                <option value="SO2">SO₂</option>
                <option value="Temperature">T</option>
                <option value="Humidity">H</option>
                <option value="Pressure">P</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {/* AQI card displays latest value from backend data */}
            {(() => {
              // For multi-asset mode, derive the latest value from `multiAssetSeries`'s average
              let lastPoint: any | undefined
              let value: number = NaN
              let lastUpdated = latestBackendAt
              // thresholds per metric -> [goodEnd, moderateEnd, poorEnd]
              const metricThresholds: Record<MetricKey, { t: [number, number, number] }> = {
                AQI: { t: [50, 100, 150] },
                PM2_5: { t: [12, 35, 55] },
                PM10: { t: [54, 154, 254] },
                CO: { t: [0.5, 1, 1.5] }, // mg/m³ (demo-friendly)
                NO2: { t: [25, 50, 100] },
                O3: { t: [60, 120, 180] },
                SO2: { t: [20, 40, 80] },
                // Reasonable demo thresholds for environmental metrics
                Temperature: { t: [18, 28, 35] },
                Humidity: { t: [30, 60, 80] },
                Pressure: { t: [980, 1010, 1030] },
              }
              
              const displayMetric: MetricKey = aqiMetric
              const [g, m2, p] = metricThresholds[displayMetric].t
              // If multiple assets selected, use multiAssetSeries.average as the source
              let aqiAvg = NaN
              let aqiMin = NaN
              let aqiMax = NaN
              if (selectedDeviceIds && selectedDeviceIds.length > 1) {
                if (!multiAssetSeries || !multiAssetSeries.length) {
                  if (multiAggLoading) {
                    return (
                      <div className="h-40 flex items-center justify-center">
                        <img src="/images/logo.png" alt="Loading" className="h-15 w-15 object-contain animate-pulse" />
                      </div>
                    )
                  }
                  return (
                    <div className="h-40 flex items-center justify-center">
                      <div className="text-sm text-muted-foreground">No data for the selected window.</div>
                    </div>
                  )
                }
                lastPoint = [...multiAssetSeries].reverse().find((p: any) => p && p[`avg__${displayMetric}`] != null)
                if (!lastPoint) {
                  if (multiAggLoading) {
                    return (
                      <div className="h-40 flex items-center justify-center">
                        <img src="/images/logo.png" alt="Loading" className="h-15 w-15 object-contain animate-pulse" />
                      </div>
                    )
                  }
                  return (
                    <div className="h-40 flex items-center justify-center">
                      <div className="text-sm text-muted-foreground">No data for the selected window.</div>
                    </div>
                  )
                }
                value = Number(lastPoint?.[`avg__${displayMetric}`] ?? NaN)
                lastUpdated = lastPoint.time ? new Date(Number(lastPoint.time)) : latestBackendAt
                const vals = (multiAssetSeries || [])
                  .filter((p: any) => {
                    const t = Number(p?.time)
                    if (!Number.isFinite(t)) return false
                    if (Number.isFinite(Number(fromTs)) && Number.isFinite(Number(effectiveToTs))) {
                      return t >= Number(fromTs) && t <= Number(effectiveToTs)
                    }
                    return true
                  })
                  .map((p: any) => Number(p?.[`avg__${displayMetric}`]))
                  .filter((v: number) => Number.isFinite(v))
                aqiAvg = vals.length ? (vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : NaN
                aqiMin = vals.length ? Math.min(...vals) : NaN
                aqiMax = vals.length ? Math.max(...vals) : NaN
              } else {
                // single-asset / aggregated behavior
                lastPoint = (pollutantSeries && pollutantSeries.length)
                  ? [...pollutantSeries].reverse().find((p: any) => p && p[displayMetric] != null)
                  : undefined
                if (!lastPoint) {
                  if (aggLoading) {
                    return (
                      <div className="h-40 flex items-center justify-center">
                        <img src="/images/logo.png" alt="Loading" className="h-15 w-15 object-contain animate-pulse" />
                      </div>
                    )
                  }
                  return (
                    <div className="h-40 flex items-center justify-center">
                      <div className="text-sm text-muted-foreground">No data for the selected window.</div>
                    </div>
                  )
                }
                value = Number(lastPoint?.[displayMetric] ?? 0)
                const rangeStart = Number.isFinite(Number(fromTs)) ? Number(fromTs) : (displayDomain ? Number(displayDomain[0]) : NaN)
                const rangeEnd = Number.isFinite(Number(effectiveToTs)) ? Number(effectiveToTs) : (displayDomain ? Number(displayDomain[1]) : NaN)
                const aqiVals = (concatenatedSeries || [])
                  .filter((p: any) => {
                    const t = Number(p?.time)
                    if (!Number.isFinite(t)) return false
                    if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd)) {
                      return t >= rangeStart && t <= rangeEnd
                    }
                    return true
                  })
                  .map((p: any) => Number(p?.[displayMetric]))
                  .filter((v: number) => Number.isFinite(v))
                aqiAvg = aqiVals.length ? (aqiVals.reduce((a: number, b: number) => a + b, 0) / aqiVals.length) : NaN
                aqiMin = aqiVals.length ? Math.min(...aqiVals) : NaN
                aqiMax = aqiVals.length ? Math.max(...aqiVals) : NaN
              }
              const getCategory = (v: number) => {
                // Category labels depend on metric for environmental types
                const labelsByMetric: Record<MetricKey, [string, string, string, string]> = {
                  Temperature: ['Cool', 'Moderate', 'Warm', 'Hot'],
                  Humidity: ['Dry', 'Comfortable', 'Humid', 'Very Humid'],
                  Pressure: ['Low', 'Normal', 'High', 'Very High'],
                  AQI: ['Good', 'Moderate', 'Poor', 'Unhealthy'],
                  PM2_5: ['Good', 'Moderate', 'Poor', 'Unhealthy'],
                  PM10: ['Good', 'Moderate', 'Poor', 'Unhealthy'],
                  CO: ['Good', 'Moderate', 'Poor', 'Unhealthy'],
                  NO2: ['Good', 'Moderate', 'Poor', 'Unhealthy'],
                  O3: ['Good', 'Moderate', 'Poor', 'Unhealthy'],
                  SO2: ['Good', 'Moderate', 'Poor', 'Unhealthy'],
                }
                const labels = labelsByMetric[displayMetric]
                if (v <= g) return { label: labels[0], color: 'bg-emerald-400', text: 'text-emerald-800', numColor: 'text-emerald-500' }
                if (v <= m2) return { label: labels[1], color: 'bg-amber-300', text: 'text-amber-900', numColor: 'text-amber-400' }
                if (v <= p) return { label: labels[2], color: 'bg-orange-500', text: 'text-white', numColor: 'text-orange-500' }
                return { label: labels[3], color: 'bg-red-600', text: 'text-white', numColor: 'text-red-600' }
              }
              // Map value onto 4 equal bands [0-25-50-75-100]
              const percent = (() => {
                const band = m2 - g // use same width for the last band est.
                if (value <= g) return (value / Math.max(g, 1)) * 25
                if (value <= m2) return 25 + ((value - g) / Math.max(m2 - g, 1)) * 25
                if (value <= p) return 50 + ((value - m2) / Math.max(p - m2, 1)) * 25
                return 75 + (Math.min(value, p + band) - p) / Math.max(band, 1) * 25
              })()
              const category = getCategory(value)
              const rangeLabels = [
                `0-${g}`,
                `${g}-${m2}`,
                `${m2}-${p}`,
                `${p}+`,
              ]
              const threshold = m2
              // Determine location text based on selected asset(s)
              let locationText = ''
              if (selectedDeviceIds && selectedDeviceIds.length === 1) {
                const single = assets.find(a => String((a as any).deviceId) === selectedDeviceIds[0])
                locationText = single ? `${single.name}${single.location ? ` (${single.location})` : ''}` : ''
              } else if (selectedDeviceIds && selectedDeviceIds.length > 1) {
                locationText = `${selectedDeviceIds.length} assets selected`
              } else if (selectedAsset) {
                locationText = `${selectedAsset.name || ''}${selectedAsset.location ? ` (${selectedAsset.location})` : ''}` || 'No location'
              } else {
                locationText = ''
              }
              //compute AQI stats from the plotted series (`concatenatedSeries`)
              //only include points that fall within the selected From/To window
              //(use `fromTs` and `effectiveToTs` computed above).
              const rangeStart = Number.isFinite(Number(fromTs)) ? Number(fromTs) : (displayDomain ? Number(displayDomain[0]) : NaN)
              const rangeEnd = Number.isFinite(Number(effectiveToTs)) ? Number(effectiveToTs) : (displayDomain ? Number(displayDomain[1]) : NaN)

              const aqiVals = (concatenatedSeries || [])
                .filter((p: any) => {
                  const t = Number(p?.time)
                  if (!Number.isFinite(t)) return false
                  if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd)) {
                    return t >= rangeStart && t <= rangeEnd
                  }
                  return true
                })
                .map((p: any) => Number(p?.[displayMetric]))
                .filter((v: number) => Number.isFinite(v))

              // aqiAvg/aqiMin/aqiMax computed above depending on mode

              return (
                <div>
                  {locationText && <div className="text-sm text-muted-foreground">{locationText}</div>}
                  <div className="flex items-center justify-center py-4">
                    <div className={`text-7xl font-extrabold ${category.numColor}`}>{Number.isFinite(value) ? value : 0}<span className="text-2xl ml-1">{unitForMetric(displayMetric)}</span></div>
                  </div>
                  <div className="flex justify-center mb-4">
                    <span className={`px-4 py-1 rounded-full ${category.color} ${category.text} font-medium`}>{category.label}</span>
                  </div>
                  <div className="px-4">
                    <div className="relative h-4 rounded-full overflow-hidden shadow-inner">
                      <div className="absolute inset-0 flex">
                        <div className="h-4" style={{ width: '25%', backgroundColor: '#4ade80' }} />
                        <div className="h-4" style={{ width: '25%', backgroundColor: '#f6c34d' }} />
                        <div className="h-4" style={{ width: '25%', backgroundColor: '#f97316' }} />
                        <div className="h-4" style={{ width: '25%', backgroundColor: '#ef4444' }} />
                      </div>
                      <div
                        className="absolute top-0 -translate-y-1/2"
                        style={{ left: `calc(${percent}% - 10px)`, top: '50%' }}
                      >
                        <div className="w-5 h-5 rounded-full border-4 border-white bg-yellow-400 shadow-lg" />
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-2">
                      <span>{rangeLabels[0]}</span>
                      <span>{rangeLabels[1]}</span>
                      <span>{rangeLabels[2]}</span>
                      <span>{rangeLabels[3]}</span>
                    </div>
                    <div className="flex justify-between text-[10px] sm:text-xs text-muted-foreground mt-1 gap-0.5">
                      {(() => {
                        const labelsByMetric: Record<MetricKey, [string, string, string, string, string, string]> = {
                          Temperature: ['Cool','C','Moderate','M','Warm','W'],
                          Humidity: ['Dry','D','Comfortable','C','Humid','H'],
                          Pressure: ['Low','L','Normal','N','High','H'],
                          AQI: ['Good','G','Moderate','M','Poor','P'],
                          PM2_5: ['Good','G','Moderate','M','Poor','P'],
                          PM10: ['Good','G','Moderate','M','Poor','P'],
                          CO: ['Good','G','Moderate','M','Poor','P'],
                          NO2: ['Good','G','Moderate','M','Poor','P'],
                          O3: ['Good','G','Moderate','M','Poor','P'],
                          SO2: ['Good','G','Moderate','M','Poor','P'],
                        }
                        const L = labelsByMetric[displayMetric]
                        return (
                          <>
                            <span className="text-foreground font-medium"><span className="inline max-[999px]:inline min-[1000px]:hidden min-[1200px]:inline">{L[0]}</span><span className="hidden min-[1000px]:inline min-[1200px]:hidden">{L[1]}</span></span>
                            <span className="text-foreground font-medium"><span className="inline max-[999px]:inline min-[1000px]:hidden min-[1200px]:inline">{L[2]}</span><span className="hidden min-[1000px]:inline min-[1200px]:hidden">{L[3]}</span></span>
                            <span className="text-foreground font-medium"><span className="inline max-[999px]:inline min-[1000px]:hidden min-[1200px]:inline">{L[4]}</span><span className="hidden min-[1000px]:inline min-[1200px]:hidden">{L[5]}</span></span>
                            <span className="text-foreground font-medium"><span className="inline max-[999px]:inline min-[1000px]:hidden min-[1200px]:inline">{displayMetric === 'Temperature' ? 'Hot' : displayMetric === 'Humidity' ? 'V H' : displayMetric === 'Pressure' ? 'Very High' : 'Unhealthy'}</span><span className="hidden min-[1000px]:inline min-[1200px]:hidden">{displayMetric === 'Temperature' ? 'H' : displayMetric === 'Humidity' ? 'VH' : displayMetric === 'Pressure' ? 'VH' : 'UH'}</span></span>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                  <div className="border-t mt-4 pt-3 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      {/* <div className="text-center min-w-[64px] sm:min-w-[90px] flex-1">
                        <div className="font-medium text-foreground">Value</div>
                      </div> */}
                      <div className="text-center min-w-[64px] sm:min-w-[90px] flex-1">
                        <div className="font-medium text-foreground">Last Updated</div>
                        <div className="mt-1">
                          {lastUpdated ? (
                            (() => {
                              const mins = Math.floor((Date.now() - lastUpdated.getTime()) / 60000)
                              return mins === 0 ? 'Just now' : `${mins} min ago`
                            })()
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                      <div className="text-center min-w-[60px] sm:min-w-[80px] flex-1">
                        <div className="font-medium text-foreground">Min</div>
                        <div className="mt-1 text-muted-foreground">{Number.isFinite(aqiMin) ? (Math.round(aqiMin * 10) / 10) : '—'}</div>
                      </div>
                      
                      <div className="text-center min-w-[60px] sm:min-w-[80px] flex-1">
                        <div className="font-medium text-foreground">Avg</div>
                        <div className="mt-1">{Number.isFinite(aqiAvg) ? (Math.round(aqiAvg * 10) / 10) : '—'}</div>
                      </div>
                      
                      <div className="text-center min-w-[60px] sm:min-w-[80px] flex-1">
                        <div className="font-medium text-foreground">Max</div>
                        <div className="mt-1 text-muted-foreground">{Number.isFinite(aqiMax) ? (Math.round(aqiMax * 10) / 10) : '—'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>
  <Card className="lg:col-span-3">
          <CardHeader className="pb-2 flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </div>
              Pollutants Trends
            </CardTitle>
            <div className="relative flex items-center gap-2">
              {/* Multi-select dropdown */}
              <div className="relative">
                {/* Inline controls: hide on very small screens (<=520px) */}
                <div className="flex items-center gap-2 flex-nowrap whitespace-nowrap max-[520px]:hidden">
                <button
                  onClick={() => setShowMetricDropdown(!showMetricDropdown)}
                  className="w-28 h-7 rounded-md border border-gray-300 bg-background px-2 text-xs flex items-center gap-2 hover:bg-muted/50"
                >
                  <span>
                    {selectedMetrics.length === 0
                      ? "Select metrics"
                      : selectedMetrics.length === allMetrics.length
                      ? "All selected"
                      : `${selectedMetrics.length} selected`}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {/* Asset multi-select dropdown (for multi-asset charts) */}
                <div className="relative">
                  <button
                    onClick={() => setShowAssetDropdown(v => !v)}
                    className="h-7 rounded-md border border-gray-300 bg-background px-2 text-xs flex items-center gap-2 hover:bg-muted/50 truncate"
                  >
                    <span className="truncate max-w-[120px]">{selectedDeviceIds.length === 0 ? 'All Assets' : `${selectedDeviceIds.length} assets`}</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {showAssetDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowAssetDropdown(false)} />
                      <div className="absolute right-0 mt-1 w-44 bg-background border border-gray-300 rounded-md shadow-lg z-20 py-1 max-h-64 overflow-y-auto overflow-x-hidden">
                        <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Select assets</div>
                        <div className="px-2 py-1 flex gap-2">
                          <button
                            onClick={() => setSelectedDeviceIds([])}
                            className="flex-1 text-center text-xs py-1 hover:bg-muted/50 rounded"
                          >All Assets</button>
                          <button
                            onClick={() => setSelectedDeviceIds([])}
                            className="flex-1 text-center text-xs py-1 hover:bg-muted/50 rounded"
                          >Clear</button>
                          <button
                            onClick={() => {
                              // Only apply when there are at least 2 devices selected
                              if (!selectedDeviceIds || selectedDeviceIds.length < 2) return
                              setAppliedDeviceIds([...selectedDeviceIds])
                              setShowAssetDropdown(false)
                            }}
                            disabled={!selectedDeviceIds || selectedDeviceIds.length < 2}
                            className={`flex-1 text-center text-xs py-1 rounded ${(!selectedDeviceIds || selectedDeviceIds.length < 2) ? 'bg-gray-200 text-gray-500' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                          >Apply</button>
                        </div>
                        {assets.map(asset => {
                          const devId = String((asset as any).deviceId ?? '')
                          if (!devId) return null
                          const checked = selectedDeviceIds.includes(devId)
                          return (
                            <label key={devId} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted/50 cursor-pointer">
                              <input type="checkbox" checked={checked} onChange={(e) => {
                                setSelectedDeviceIds(prev => e.target.checked ? [...prev, devId] : prev.filter(d => d !== devId))
                              }} />
                              <span className="truncate">{asset.name || devId}</span>
                            </label>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
                {/* Toggle for multi-asset view: show average only or all lines */}
                {selectedDeviceIds.length > 1 && (
                  <button
                    onClick={() => setShowAverageOnly(v => !v)}
                    aria-label={showAverageOnly ? 'Show All Lines' : 'Show Average Only'}
                    className="h-8 w-8 rounded-md border border-gray-300 bg-background p-1 flex items-center justify-center hover:bg-muted/50"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 12l6-6 4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
                {/* Apply button moved into dropdown for privacy and explicit fetch */}
                </div>

                {/* Compact icon for very small screens: show metric + asset selectors inside dropdown */}
                <div className="hidden max-[520px]:inline-flex relative">
                  <button
                    aria-label="Selections"
                    onClick={() => setShowCompactSelector(v => !v)}
                    className="p-2 rounded-md border border-gray-300 hover:bg-muted/30 flex items-center justify-center h-8"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {showCompactSelector && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowCompactSelector(false)} />
                      <div className="absolute right-0 mt-1 w-64 bg-background border border-gray-300 rounded-md shadow-lg z-20 py-2">
                        <div className="px-3 pb-2">
                          <div className="text-xs text-muted-foreground font-medium mb-1">Metrics</div>
                          <div className="border rounded p-1 max-h-40 overflow-y-auto">
                            <button
                              onClick={toggleSelectAll}
                              className="w-full px-2 py-1 text-sm text-left hover:bg-muted/50 flex items-center gap-2"
                            >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                                selectedMetrics.length === allMetrics.length ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                              }`}>
                                {selectedMetrics.length === allMetrics.length && (
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </div>
                              <span className="font-medium">Select all</span>
                            </button>
                            {allMetrics.map((metric) => (
                              <button
                                key={metric}
                                onClick={() => toggleMetric(metric)}
                                className="w-full px-2 py-1 text-sm text-left hover:bg-muted/50 flex items-center gap-2"
                              >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                                  selectedMetrics.includes(metric) ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                                }`}>
                                  {selectedMetrics.includes(metric) && (
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  )}
                                </div>
                                <span>{metricLabel(metric)}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="px-3 pb-2">
                          <div className="text-xs text-muted-foreground font-medium mb-1">Assets</div>
                          <div className="border rounded p-1 max-h-40 overflow-y-auto">
                            <div className="px-1 py-1 flex gap-2">
                              <button
                                onClick={() => setSelectedDeviceIds([])}
                                className={`flex-1 text-center text-xs py-1 rounded ${selectedDeviceIds.length === 0 ? 'bg-blue-500 text-white' : 'hover:bg-muted/50'}`}
                              >All Assets</button>
                              <button
                                onClick={() => setSelectedDeviceIds([])}
                                className="flex-1 text-center text-xs py-1 hover:bg-muted/50 rounded"
                              >Clear</button>
                            </div>
                            {assets.map(asset => {
                              const devId = String((asset as any).deviceId ?? '')
                              if (!devId) return null
                              const checked = selectedDeviceIds.includes(devId)
                              return (
                                <label key={devId} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-muted/50 cursor-pointer">
                                  <input type="checkbox" checked={checked} onChange={(e) => {
                                    setSelectedDeviceIds(prev => e.target.checked ? [...prev, devId] : prev.filter(d => d !== devId))
                                  }} />
                                  <span className="truncate">{asset.name || devId}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                        {selectedDeviceIds.length > 1 && (
                          <div className="px-3 pb-3">
                            <button
                              onClick={() => setShowAverageOnly(v => !v)}
                              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm hover:bg-muted/50"
                            >{showAverageOnly ? 'Show All Lines' : 'Show Average Only'}</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {showMetricDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-10 border border-gray-300"
                      onClick={() => setShowMetricDropdown(false)}
                    />
                    <div className="absolute right-0 mt-1 w-44 bg-background border border-gray-400 rounded-md shadow-lg z-20 py-1">
                      <button
                        onClick={toggleSelectAll}
                        className="w-full px-3 py-2 text-sm text-left hover:bg-muted/50 flex items-center gap-2"
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                          selectedMetrics.length === allMetrics.length ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                        }`}>
                          {selectedMetrics.length === allMetrics.length && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <span className="font-medium">Select all</span>
                      </button>
                      {allMetrics.map((metric) => (
                        <button
                          key={metric}
                          onClick={() => toggleMetric(metric)}
                          className="w-full px-3 py-2 text-sm text-left hover:bg-muted/50 flex items-center gap-2"
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                            selectedMetrics.includes(metric) ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                          }`}>
                            {selectedMetrics.includes(metric) && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <span>{metricLabel(metric)}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {/* Range, date, refresh group: visible above 1100px only */}
              {/* Compact options for large screens: show icon dropdown instead of inline controls */}
              <div className="hidden min-[1101px]:flex items-center gap-3">
                <div className="relative inline-block">
                  <button
                    aria-label="More options"
                    onClick={() => setShowMoreOptions((v) => !v)}
                    className="p-2 rounded-md border border-gray-300 hover:bg-muted/30"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                      {showMoreOptions && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowMoreOptions(false)} />
                      <div className="absolute right-0 mt-1 z-20 w-60 rounded-md border bg-background p-2 shadow-lg">
                        <div className="grid grid-cols-1 gap-3">
                            <div className="flex flex-col items-start gap-1 w-full">
                              <label className="text-xs text-muted-foreground">From</label>
                              <input
                                type="datetime-local"
                                value={fromDateTime}
                                onChange={(e) => setFromDateTime(e.target.value)}
                                className="h-9 px-2 text-xs border border-gray-300 rounded w-full"
                              />
                            </div>
                            <div className="flex flex-col items-start gap-1 w-full">
                              <label className="text-xs text-muted-foreground flex items-center gap-1">
                                <span>To</span>
                                {toDateIsLive && selectedDeviceIds.length <= 1 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300">
                                    Current time
                                  </span>
                                )}
                              </label>
                              <input
                                type="datetime-local"
                                value={toDateTime}
                                onFocus={() => setToDateIsLive(false)}
                                onChange={(e) => {
                                  setToDateIsLive(false)
                                  setLiveEndMs(null)
                                  setToDateTime(e.target.value)
                                }}
                                className={`h-9 px-2 text-xs border border-gray-300 rounded w-full ${toDateIsLive ? 'bg-muted cursor-not-allowed' : ''}`}
                              />
                              {selectedDeviceIds.length <= 1 && (
                                <button
                                  type="button"
                                  onClick={() => setToDateIsLive((v) => !v)}
                                  className={`mt-1 inline-flex items-center rounded px-2 py-0.5 text-[10px] border ${toDateIsLive ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-muted text-muted-foreground border-border'}`}
                                >
                                  {toDateIsLive ? 'Current time: ON' : 'Current time: OFF'}
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-col gap-3">
                                    {/* <div className="text-xs text-muted-foreground">Use the Assets selector next to Metrics to choose assets</div> */}
                            <button
                              aria-label="Refresh data"
                              onClick={() => { handleManualRefresh(); setShowMoreOptions(false) }}
                              disabled={aggLoading}
                              className={`w-full p-2 rounded-md border border-gray-300 hover:bg-muted/30 ${aggLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <svg
                                  className={aggLoading ? "animate-spin" : ""}
                                  width="18"
                                  height="18"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                <span className="text-sm">Refresh</span>
                              </div>
                            </button>
                          </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <button
                aria-label="Toggle bar/line chart"
                onClick={() => setShowChart((s) => (s === "line" ? "bar" : "line"))}
                className={`p-2 rounded-md border border-gray-300 hover:bg-muted/30 ${
                  showChart === "bar" ? "bg-muted/50" : "bg-transparent"
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="12" width="4" height="8" rx="1" fill="currentColor" />
                  <rect x="10" y="7" width="4" height="13" rx="1" fill="currentColor" />
                  <rect x="17" y="3" width="4" height="17" rx="1" fill="currentColor" />
                </svg>
              </button>
              {/* Compact options button: visible at <= 1100px */}
              <div className="relative inline-block min-[1101px]:hidden">
                <button
                  aria-label="More options"
                  onClick={() => setShowMoreOptions((v) => !v)}
                  className="p-2 rounded-md border hover:bg-muted/30"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {showMoreOptions && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowMoreOptions(false)} />
                    <div className="absolute right-0 mt-1 z-20 w-60 rounded-md border bg-background p-2 shadow-lg">
                    <div className="mb-2 flex flex-col gap-2">
                      {/* From Date-Time (stacked) */}
                      <div className="flex flex-col items-start gap-1">
                        <label className="text-xs text-muted-foreground">From</label>
                        <input
                          type="datetime-local"
                          value={fromDateTime}
                          onChange={(e) => setFromDateTime(e.target.value)}
                          className="h-8 px-2 text-xs border rounded w-full"
                        />
                      </div>
                      <div className="flex flex-col items-start gap-1">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <span>To</span>
                          {toDateIsLive && selectedDeviceIds.length <= 1 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300">
                              Following current time
                            </span>
                          )}
                        </label>
                        <input
                          type="datetime-local"
                          value={toDateTime}
                          onFocus={() => setToDateIsLive(false)}
                          onChange={(e) => {
                            setToDateIsLive(false)
                            setLiveEndMs(null)
                            setToDateTime(e.target.value)
                          }}
                          className={`h-8 px-2 text-xs border rounded w-full ${toDateIsLive ? 'bg-muted cursor-not-allowed' : ''}`}
                        />
                        {selectedDeviceIds.length <= 1 && (
                          <button
                            type="button"
                            onClick={() => setToDateIsLive((v) => !v)}
                            className={`mt-1 inline-flex items-center rounded px-2 py-0.5 text-[10px] border ${toDateIsLive ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-muted text-muted-foreground border-border'}`}
                          >
                            {toDateIsLive ? 'Current time: ON' : 'Current time: OFF'}
                          </button>
                        )}
                      </div>
                      {/* <div className="text-xs text-muted-foreground">Use the Assets selector next to Metrics to choose assets</div> */}
                    </div> 
                      {/* Removed small-screen 'Pick date' popover per UI change request */}
                      <button
                        aria-label="Refresh data"
                        onClick={() => { handleManualRefresh(); setShowMoreOptions(false) }}
                        disabled={aggLoading}
                        className={`w-full p-2 rounded-md border hover:bg-muted/30 ${aggLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <svg
                            className={aggLoading ? "animate-spin" : ""}
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className="text-sm">Refresh</span>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          {isSpanTooLarge && (
            <div className="mb-2 px-2">
              <Alert>
                <AlertTitle>Select Max for one month</AlertTitle>
                <AlertDescription>Please select a range no larger than 30 days.</AlertDescription>
              </Alert>
            </div>
          )}
          <CardContent className="space-y-4 pl-2 pr-4 pb-4">
            {/* Chart rendering (moved to dynamically-loaded client renderer) */}
            <DynamicChartRenderer
              selectedDeviceIds={selectedDeviceIds}
              multiAssetSeries={multiAssetSeries}
              multiAssetTicks={multiAssetTicks}
              multiAssetDomain={multiAssetDomain}
              showChart={showChart}
              showAverageOnly={showAverageOnly}
              assets={assets}
              multiAggLoading={multiAggLoading}
              aggLoading={aggLoading}
              displaySeries={displaySeries}
              concatenatedSeries={concatenatedSeries}
              tickIndices={tickIndices}
              barDomain={barDomain}
              metricColors={metricColors}
              selectedMetrics={selectedMetrics}
              isNarrow={isNarrow}
              CustomTick={CustomTick}
              CustomTickIndexed={CustomTickIndexed}
              CustomTooltip={CustomTooltip}
            />
            {/* Custom legend below the chart/ticks */}
            {(selectedDeviceIds && selectedDeviceIds.length > 1 && multiAssetSeries && multiAssetSeries.length) ? (
              <div className={"flex flex-wrap items-center justify-center gap-3 text-xs " + (showChart === 'bar' ? 'mt-4' : 'mt-3')}>
                {showAverageOnly ? (
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#6b7280' }} />
                    <span className="text-muted-foreground">Average</span>
                  </div>
                ) : (
                  <>
                    {selectedDeviceIds.map((devId, idx) => {
                      const asset = assets.find(a => String((a as any).deviceId) === devId)
                      const location = asset ? (asset.location ?? 'No location').split(',')[0]?.trim() || 'No location' : ''
                      const label = asset ? `${asset.name || devId} (${location})` : devId
                      const color = ['#8b5cf6','#FF6B6B','#FFB86B','#FFD56B','#6BCBFF','#6BFF95','#C56BFF','#FF9999','#3B82F6','#60A5FA'][idx % 10]
                      return (
                        <div key={devId} className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-muted-foreground">{label} · {metricLabel((selectedMetrics && selectedMetrics.length ? selectedMetrics[0] : aqiMetric) as any)}</span>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            ) : (
              displaySeries.length > 0 && (
                <div className={"flex flex-wrap items-center justify-center gap-3 text-xs " + (showChart === 'bar' ? 'mt-4' : 'mt-3')}>
                  {selectedMetrics.map((m) => (
                    <div key={m} className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: metricColors[m] }} />
                      <span className="text-xs text-muted-foreground">
                        {metricLabel(m)} <span className="text-[10px] text-muted-foreground">· {unitForMetric(String(m))}</span>
                      </span>
                    </div>
                  ))}
                  {/* Single-asset details intentionally omitted from the legend to keep it focused on metrics */}
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>
      {/* Live Map */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Live Map</CardTitle>
        </CardHeader>
        <CardContent>
          {/*
            The map uses demo coordinates unless an AppKey is configured in Settings
            and your backend provides lat/lng. If a Google Maps key isn't set,
            the component shows a friendly placeholder instead of the map.
          */}
          <div className="relative h-[60vh] w-full rounded border overflow-hidden">
              {mapsKey ? (
              <AeropureMap devices={mapDevices} assets={assets} heatmap={false} wind={false} showLabels={true} devicesWithAqi={devicesWithReadings} apiKey={mapsKey} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted">
                <div className="text-center">
                  <div className="text-sm font-semibold">Google Maps unavailable</div>
                  <div className="text-xs text-muted-foreground">Add a Maps API key in Settings to enable the map.</div>
                </div>
              </div>
            )}
            {isLoadingMap ? (
              <div className="pointer-events-none absolute left-3 top-3 rounded bg-background/80 px-2 py-1 text-xs shadow">
                Loading map…
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {/* Panels below maps */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Assets Status Overview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Assets Status Overview</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const items = (assetsResp?.items ?? []) as ApiAsset[]
              const inferStatus = (a: ApiAsset): 'online' | 'offline' | 'alert' | 'inactive' => {
                // detectAssetState may return additional states; normalize to supported set
                const raw = String(detectAssetState(a) || '').toLowerCase()
                if (raw === 'online') return 'online'
                if (raw === 'offline') return 'offline'
                if (raw === 'alert') return 'alert'
                if (raw === 'inactive' || raw === 'paused') return 'inactive'
                return 'offline'
              }
              // Normalize statuses across all items: use inferred status
              const normalized = items.map((a) => ({ id: a._id, status: inferStatus(a) }))

              // Compute counts from normalized statuses (use full set, not the sliced display list)
              const counts = normalized.reduce(
                (acc, x) => {
                  acc.total++
                  if (x.status === 'online') acc.online++
                  else if (x.status === 'offline') acc.offline++
                  else if (x.status === 'alert') acc.alerts++
                  else if (x.status === 'inactive') acc.inactive++
                  return acc
                },
                { online: 0, offline: 0, alerts: 0, inactive: 0, total: 0 },
              )

              // Build donut slices from counts. Include Inactive when present.
              const donut: { name: string; value: number; color: string }[] = [
                { name: 'Online', value: counts.online, color: '#22c55e' },
                { name: 'Offline', value: counts.offline, color: '#f97316' },
                { name: 'Alerts', value: counts.alerts, color: '#ef4444' },
              ]
              if (counts.inactive > 0) donut.push({ name: 'Inactive', value: counts.inactive, color: '#94a3b8' })

              const onlinePct = counts.total ? Math.round((counts.online / counts.total) * 100) : 0

              // Trend sparkline: show the online percentage over the last 7 days (backend historical snapshot not available here)
                          // If we have a computed 24h trend, show hourly points; otherwise show no trend (remove demo fallback)
                          const trend = assetOnlineTrend24 && assetOnlineTrend24.length > 0 ? assetOnlineTrend24 : []

              // Map assets -> display rows. Keep the same normalization for each displayed asset.
              const displayAssets = items
                .filter(a => !searchQuery || a.name?.toLowerCase().includes(searchQuery.toLowerCase()) || a.location?.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((a) => {
                  const inferred = inferStatus(a)
                  const normalizedStatus = inferred
                  const label = inferred === 'online' ? 'Online' : inferred === 'offline' ? 'Offline' : 'Alert'
                  return {
                    _id: a._id,
                    deviceId: (a as any).deviceId ?? (a as any).deviceID ?? (a as any).id ?? null,
                    name: a.name ?? '—',
                    city: (a.location ?? '—').split(',')[0]?.trim() || '—',
                    // efficiency removed
                    status: normalizedStatus as 'online' | 'offline' | 'alert' | 'inactive',
                    statusLabel: label,
                    type: a.type ?? null,
                  }
                })


              // Small tooltip for 24h mini-trend: show count and percent for the hovered point
              const SmallTrendTooltip = ({ active, payload }: any & { total?: number }) => {
                const total = items.length || 0
                if (!active || !payload || !payload.length) return null
                const data = payload[0].payload
                const timeStr = new Date(data.t).toLocaleTimeString([], { hour: '2-digit', hour12: true })
                const pct = Number.isFinite(Number(data.v)) ? Number(data.v) : null
                const count = (pct != null && total) ? Math.round((pct / 100) * total) : null
                return (
                  <div className="rounded-lg border bg-background p-2 shadow-lg text-xs">
                    <div className="font-semibold mb-1">{timeStr}</div>
                    {count != null && <div className="text-sm font-medium">{count} assets online</div>}
                    {pct != null && <div className="text-muted-foreground mt-1">{pct}% uptime</div>}
                  </div>
                )
              }

              // Status -> border color mapping (include explicit 'inactive')
              const statusBorder = (s?: string) =>
                s === 'online' ? 'border-emerald-500' : s === 'offline' || s === 'inactive' ? 'border-rose-500' : 'border-amber-500'

              // Status -> pill color mapping (include explicit 'inactive')
              const statusPill = (s?: string) =>
                s === 'online'
                  ? 'bg-emerald-100 text-emerald-700'
                  : s === 'offline' || s === 'inactive'
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-amber-100 text-amber-800'
              return (
                <div className="space-y-4">
                  {/* Top mini charts */}
                  <div className="flex items-start gap-6 flex-wrap md:flex-nowrap overflow-hidden">
                    <div className="flex flex-col items-center">
                      <div className="text-xs text-muted-foreground mb-1">Status Distribution</div>
                      <div className="relative h-28 w-28">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={donut} dataKey="value" innerRadius={34} outerRadius={55} strokeWidth={0}>
                              {donut.map((d, i) => (
                                <Cell key={i} fill={d.color} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                          <div className="text-xl font-semibold">{onlinePct}%</div>
                          <div className="text-xs text-muted-foreground">Online</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-muted-foreground mb-1">24h Trend</div>
                      <div className="h-32 w-full overflow-hidden">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trend} margin={{ left: 0, right: 8, top: 5, bottom: 5 }}>
                            <defs>
                              <linearGradient id="as-trend" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis
                              dataKey="t"
                              type="number"
                              domain={["dataMin", "dataMax"]}
                              tickCount={isNarrow ? 4 : 5}
                              tick={{ fontSize: 10 }}
                              tickMargin={4}
                              tickFormatter={(v: number) => {
                                try {
                                  return new Date(v).toLocaleTimeString([], { hour: '2-digit', hour12: true })
                                } catch (e) {
                                  return String(v)
                                }
                              }}
                            />
                            <YAxis hide domain={[0, 100]} />
                            <ChartTooltip content={<SmallTrendTooltip />} />
                            <Area type="monotone" dataKey="v" stroke="#22c55e" fill="url(#as-trend)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                  {/* Asset list */}
                  <div className="space-y-3 max-h-80 overflow-y-auto">
                    {assetsLoading && (
                      <div className="text-xs text-muted-foreground">Loading assets…</div>
                    )}
                    {!assetsLoading && !displayAssets.length && (
                      <div className="text-xs text-muted-foreground">No assets found.</div>
                    )}
                    {displayAssets.map((a) => (
                      <div key={a._id} className={`rounded-xl border border-border p-3 pl-4 ${'border-l-4'} ${statusBorder(a.status)}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <div className="h-6 w-6 rounded-md border flex items-center justify-center text-muted-foreground">
                              {/* simple device icon */}
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M8 20h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            </div>
                            <div className="font-medium">{a.name}{a.city ? ` (${a.city})` : ''}</div>
                          </div>
                    <div className={`px-2 py-1 rounded-full text-xs ${statusPill(a.status)}`}>{a.statusLabel}</div>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                          {/* <div className="flex items-center gap-1 truncate">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v20" stroke="currentColor" strokeWidth="1.5"/><path d="M5 12h14" stroke="currentColor" strokeWidth="1.5"/></svg>
                            <span className="shrink-0 text-foreground">Status</span>
                            <span className="truncate">{a.statusLabel}</span>
                          </div> */}
                          {/* Efficiency removed */}
                          <div className="flex items-center justify-between">
  <div className="flex items-center gap-0.5 flex-1 min-w-0">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2l7 7-7 13-7-13 7-7z" stroke="currentColor" strokeWidth="1.5"/>
    </svg>

    <span className="shrink-0 text-foreground">Location</span>

    {/* Full single-line location */}
    <span className="whitespace-nowrap overflow-visible">
      {a.city}
    </span>
  </div>
</div>
{/* Uptime bar for last 24h: show online/offline segments based on actual data timestamps */}
        <div className="col-span-3 mt-2">
                {(() => {
                      try {
                      const H = 60 * 60 * 1000
                      // Use current time (uptimeBarNow updates every 5 mins) - NO future time
                      const end = uptimeBarNow
                      const start = end - 24 * H
                                const totalDuration = end - start
                                const rawSegments = perAssetSegments24?.[a._id] ?? null
                                // Clamp segments to current time - don't show future status
                                const segments = rawSegments ? rawSegments
                                  .map(seg => ({
                                    ...seg,
                                    start: Math.max(seg.start, start),
                                    end: Math.min(seg.end, end)
                                  }))
                                  .filter(seg => seg.end > seg.start && seg.start < end && seg.end > start)
                                  : null
                                // fixed label count (show date + hour)
                                const labelCount = 3
                                const labelTimes = Array.from({ length: labelCount }, (_, i) => start + (i * totalDuration) / Math.max(1, labelCount - 1))

                                return (
                                  <div className="w-full">
                                    {segments ? (
                                      <>
                                        <div className="w-full bg-slate-100 rounded overflow-hidden relative" style={{ height: 14 }}>
                                          <div style={{ display: 'flex', height: '100%' }}>
                                            {segments.map((seg, idx) => {
                                              const duration = seg.end - seg.start
                                              const widthPct = (duration / totalDuration) * 100
                                              return (
                                                <Tooltip key={idx}>
                                                  <TooltipTrigger asChild>
                                                    <div 
                                                      aria-hidden 
                                                      style={{ 
                                                        width: `${widthPct}%`, 
                                                        background: seg.online ? '#22c55e' : '#ef4444', 
                                                        minWidth: 1, 
                                                        height: '100%' 
                                                      }}
                                                      onClick={() => {
                                                        if (isMobile) {
                                                          setMobileUptimeInfo({ assetId: a._id, seg })
                                                        }
                                                      }}
                                                    />
                                                  </TooltipTrigger>
                                                  <TooltipContent sideOffset={4}>
                                                    <div className="text-xs">
                                                      <div className="font-medium">
                                                        {new Date(seg.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                                                        {' → '}
                                                        {new Date(seg.end).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                                                      </div>
                                                      <div className="text-[12px] text-muted-foreground">
                                                        Status: {seg.online ? 'Online' : 'Offline'}
                                                      </div>
                                                      <div className="text-[12px] text-muted-foreground">
                                                        Duration: {Math.round(duration / 60000)} min
                                                      </div>
                                                    </div>
                                                  </TooltipContent>
                                                </Tooltip>
                                              )
                                            })}
                                          </div>
                                        </div>

                                        {isMobile && mobileUptimeInfo?.assetId === a._id && (
                                          <div className="mt-2 rounded-md border bg-white text-xs shadow-sm p-2 space-y-1">
                                            <div className="font-medium">
                                              {new Date(mobileUptimeInfo.seg.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                                              {' → '}
                                              {new Date(mobileUptimeInfo.seg.end).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                                            </div>
                                            <div className="text-[11px] text-muted-foreground">Status: {mobileUptimeInfo.seg.online ? 'Online' : 'Offline'}</div>
                                            <div className="text-[11px] text-muted-foreground">Duration: {Math.round((mobileUptimeInfo.seg.end - mobileUptimeInfo.seg.start) / 60000)} min</div>
                                            <button
                                              className="mt-1 inline-flex items-center rounded px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-[10px] font-medium text-slate-700"
                                              onClick={() => setMobileUptimeInfo(null)}
                                            >Close</button>
                                          </div>
                                        )}

                                        <div className="mt-1 mb-2 text-[10px] text-muted-foreground" style={{ position: 'relative', height: 36 }}>
                                          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                            {labelTimes.map((ts, idx) => {
                                              const dateStr = new Date(ts).toLocaleString([], { month: 'short', day: 'numeric' })
                                              const timeStr = new Date(ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', hour12: true })
                                              // clamp label positions to avoid overflowing card edges (6%..94%)
                                              const rawPct = (idx / Math.max(1, labelCount - 1)) * 100
                                              const leftPct = Math.min(94, Math.max(6, Math.round(rawPct)))
                                              return (
                                                <div key={idx} style={{ position: 'absolute', left: `${leftPct}%`, transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'none', width: 'max-content', maxWidth: '30%' }}>
                                                  <div style={{ fontSize: 11, lineHeight: '12px' }}>{dateStr}</div>
                                                  <div style={{ fontSize: 11, lineHeight: '12px', color: 'var(--muted-foreground, #6b7280)' }}>{timeStr}</div>
                                                </div>
                                              )
                                            })}
                                          </div>
                                        </div>
                                      </>
                                    ) : (
                                      // show a neutral skeleton while segment data is not yet loaded
                                      <>
                                        <div className="w-full bg-slate-100 rounded overflow-hidden relative" style={{ height: 14 }}>
                                          <div style={{ display: 'flex', height: '100%' }}>
                                            {Array.from({ length: 24 }).map((_, i) => (
                                              <div key={i} aria-hidden style={{ flex: '1 1 0%', background: '#eaeaea', minWidth: 0, height: '100%' }} />
                                            ))}
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )
                              } catch (e) {
                                return null
                              }
                            })()}
                          </div>
                          
                        </div>
                        {/* IonRain device controls - only show when device is online and type is IonRain */}
                        {a.type === 'IonRain' && a.status === 'online' && a.deviceId && (() => {
                          const currentStatus = ionRainSupplyStatus[a.deviceId] ?? '-'
                          const isOn = currentStatus === 'ON'
                          const isLoading = !!ionRainCommandLoading[a.deviceId]
                          return (
                            <div className="mt-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">Supply Status:</span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isOn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{currentStatus}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Control:</span>
                                {isOn ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isLoading}
                                    className={`h-7 px-3 text-xs ${isLoading ? 'opacity-60 cursor-not-allowed bg-muted text-muted-foreground' : 'bg-red-600 hover:bg-red-700 text-white hover:text-white border-red-600 hover:border-red-700'}`}
                                    onClick={() => !isLoading && handleIonRainPowerToggle(a.deviceId, false)}
                                  >
                                    {isLoading ? (
                                      <span className="inline-flex items-center gap-2">
                                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                        Turning Off
                                      </span>
                                    ) : 'Turn Off'}
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isLoading}
                                    className={`h-7 px-3 text-xs ${isLoading ? 'opacity-60 cursor-not-allowed bg-muted text-muted-foreground' : 'bg-green-600 hover:bg-green-700 text-white hover:text-white border-green-600 hover:border-green-700 '}`}
                                    onClick={() => !isLoading && handleIonRainPowerToggle(a.deviceId, true)}
                                  >
                                    {isLoading ? (
                                      <span className="inline-flex items-center gap-2">
                                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                        Turning On
                                      </span>
                                    ) : 'Turn On'}
                                  </Button>
                                )}
                              </div>
                              {/* Real-time supply fault display */}
                              {ionRainRealTimeFault[a.deviceId] != null && (() => {
                                const { message, isOk } = getFaultMessage(ionRainRealTimeFault[a.deviceId])
                                const bgColor = isOk ? 'bg-green-600' : 'bg-amber-600'
                                
                                return (
                                  <div className="mt-2">
                                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${bgColor} text-white text-xs font-semibold shadow-sm`}>
                                      <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="shrink-0"
                                      >
                                        {isOk ? (
                                          <>
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                                            <path d="M8 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                          </>
                                        ) : (
                                          <>
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                                            <path d="M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                            <circle cx="12" cy="16" r="1" fill="currentColor" />
                                          </>
                                        )}
                                      </svg>
                                      <span className="tracking-wide">{message}</span>
                                    </div>
                                  </div>
                                )
                              })()}
                              {(ionRainCommandLog[a.deviceId]?.length ?? 0) > 0 && (
                                <div className="mt-2 rounded border bg-muted/30 p-2">
                                  <div className="mb-1 text-xs font-medium text-foreground">Command status</div>
                                  <div className="max-h-24 overflow-auto space-y-1">
                                    {ionRainCommandLog[a.deviceId]!.slice(-5).map((entry, idx) => (
                                      <div key={idx} className="text-[11px] text-muted-foreground">
                                        <span className="text-foreground">[{new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}]</span> {entry.message}
                                        {entry.status ? <span className="ml-1 text-foreground">({entry.status})</span> : null}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })()}
                        {/* Last active (from recent reading) - only show for offline assets */}
                        {a.status === 'offline' && (() => {
                          const entry = lastActiveMap?.[a._id]
                          
                          // Helper function to format timestamp
                          const formatTimestamp = (parsedTs: number) => {
                            try {
                              const date = new Date(parsedTs)
                              return date.toLocaleString('en-US', {
                                timeZone: 'Asia/Karachi',
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true
                              })
                            } catch (e) {
                              // Fallback to UTC if timezone formatting fails
                              const date = new Date(parsedTs)
                              return date.toUTCString()
                            }
                          }

                          // First try: use data from lastActiveMap
                          if (entry && (entry.receivedAt || entry.ts)) {
                            // Prefer numeric timestamp for reliable parsing
                            let parsedTs = Number(entry.ts)
                            // Fallback: try parsing receivedAt string if ts is not available
                            if (!Number.isFinite(parsedTs) && entry.receivedAt) {
                              const p = Date.parse(String(entry.receivedAt))
                              parsedTs = Number.isFinite(p) ? p : NaN
                            }
                            
                            if (Number.isFinite(parsedTs)) {
                              return (
                                <div className="mt-2 text-xs text-muted-foreground">Last active: {formatTimestamp(parsedTs)}</div>
                              )
                            }
                          }

                          // Second try: use fallback data timestamp from individual device API
                          const fallbackTimestamp = fallbackDataTimestamps[a._id]
                          if (fallbackTimestamp) {
                            const parsed = Date.parse(fallbackTimestamp)
                            if (Number.isFinite(parsed)) {
                              return (
                                <div className="mt-2 text-xs text-muted-foreground">Last active: {formatTimestamp(parsed)}</div>
                              )
                            }
                          }

                          return <div className="mt-2 text-xs text-muted-foreground">Last active: -</div>
                        })()}
                        {/* Note area can be added if backend provides summary */}
                      </div>
                    ))}
                  </div>
                  <div className="pt-2">
                    <Button asChild className="w-full bg-[#60A5FA] hover:bg-[#3B82F6]">
                      <Link href="/assets">View All Assets</Link>
                    </Button>
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>
        {/* Bulk Operations */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bulk Operations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <Button variant="outline">Firmware Update</Button>
              <Button variant="outline">Assign to Group</Button>
              <Button variant="outline">Reboot Selected</Button>
              <div className="text-xs text-muted-foreground">Tip: Select devices on the map to enable these actions.</div>
            </div>
          </CardContent>
        </Card>
        {/* Alerts & Notifications */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Alerts & Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-rose-500" />
                <div>
                  PM2.5 exceeded threshold on Device A
                  <div className="text-xs text-muted-foreground">2 min ago</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-amber-500" />
                <div>
                  Firmware update scheduled for 5 devices
                  <div className="text-xs text-muted-foreground">1 hour ago</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-sky-500" />
                <div>
                  New device registered in Group East
                  <div className="text-xs text-muted-foreground">Today 09:14</div>
                </div>
              </div>
              <div className="pt-2">
                <Button size="sm" variant="outline">View all</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}