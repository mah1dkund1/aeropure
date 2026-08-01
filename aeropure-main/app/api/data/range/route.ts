import { NextRequest, NextResponse } from 'next/server'
import { aggregateReadings } from '@/lib/aggregate'

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL 
const UPSTREAM = `${BACKEND_BASE_URL}/data`

export const dynamic = 'force-dynamic'
export const revalidate = 0

function chooseBinHours(spanMs: number) {
  const H = 60 * 60 * 1000
  if (spanMs <= 24 * H) return 2 / 60 // 2 minutes
  if (spanMs <= 3 * 24 * H) return 5 / 60 // 5 minutes
  if (spanMs <= 7 * 24 * H) return 1 // 1 hour
  return 4 // 4 hours
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const devices = Array.isArray(body?.devices) ? body.devices : []
    // Helper: format a date-like value into naive ISO `YYYY-MM-DDTHH:MM:SS` (no timezone/Z)
    const fmtNaiveIso = (v: any) => {
      try {
        let d: Date
        if (typeof v === 'number') d = new Date(Number(v))
        else if (typeof v === 'string') {
          // Accept strings like '2025-12-15T10:00:00' or with Z/ms
          const parsed = Date.parse(v)
          if (!Number.isFinite(parsed)) return String(v)
          d = new Date(parsed)
        } else if (v instanceof Date) d = v
        else return String(v)
        const pad = (n: number) => String(n).padStart(2, '0')
        const YYYY = d.getFullYear()
        const MM = pad(d.getMonth() + 1)
        const DD = pad(d.getDate())
        const hh = pad(d.getHours())
        const mm = pad(d.getMinutes())
        const ss = pad(d.getSeconds())
        return `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}`
      } catch (e) {
        return String(v)
      }
    }
    if (!devices.length) return NextResponse.json({ error: 'No devices provided' }, { status: 400 })

    // Forward request to upstream batch endpoint
    // Clean device date formats to upstream-expected naive ISO (no timezone)
    const cleanedDevices = devices.map((d: any) => ({
      deviceID: d?.deviceID ?? d?.deviceId ?? d?.id,
      start_date: fmtNaiveIso(d?.start_date ?? d?.start ?? d?.from),
      end_date: fmtNaiveIso(d?.end_date ?? d?.end ?? d?.to),
    }))
    console.debug('[data/range] Forwarding cleaned devices to upstream', { cleanedDevices })

    // Use no-store to avoid Next caching and expose the upstream body when errors happen
    const upstreamRes = await fetch(`${UPSTREAM}/range`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices: cleanedDevices }),
      cache: 'no-store',
      next: { revalidate: 0 }
    })

    let upstreamText = ''
    try {
      upstreamText = await upstreamRes.text()
    } catch (e) {
      upstreamText = ''
    }

    if (!upstreamRes.ok) {
      console.error('[data/range] Upstream non-OK', { status: upstreamRes.status, body: upstreamText })
      // Try to parse JSON body for richer message, otherwise return text
      try {
        const parsed = upstreamText ? JSON.parse(upstreamText) : undefined
        return NextResponse.json({ error: 'Upstream error', status: upstreamRes.status, body: parsed ?? upstreamText }, { status: 502 })
      } catch (e) {
        return NextResponse.json({ error: 'Upstream error', status: upstreamRes.status, body: upstreamText }, { status: 502 })
      }
    }

    let upstreamJson: any = undefined
    try {
      upstreamJson = upstreamText ? JSON.parse(upstreamText) : undefined
    } catch (e) {
      // upstream returned non-JSON but with 2xx status
      upstreamJson = upstreamText
    }
    const results = Array.isArray(upstreamJson?.results) ? upstreamJson.results : []

    // Align aggregation with the aggregate/report endpoints by using a
    // shared global window and binning parameters. This ensures the
    // per-device aggregated points match the report aggregation.
    // Compute global start/end from the original devices payload (treat as UTC)
    const parsedStarts: number[] = []
    const parsedEnds: number[] = []
    for (const d of devices) {
      const sRaw = d?.start_date ?? d?.start ?? d?.from
      const eRaw = d?.end_date ?? d?.end ?? d?.to
      const s = typeof sRaw === 'string' ? (isNaN(Date.parse(sRaw)) ? Date.parse(String(sRaw) + 'Z') : Date.parse(sRaw)) : (Number.isFinite(Number(sRaw)) ? Number(sRaw) : NaN)
      const e = typeof eRaw === 'string' ? (isNaN(Date.parse(eRaw)) ? Date.parse(String(eRaw) + 'Z') : Date.parse(eRaw)) : (Number.isFinite(Number(eRaw)) ? Number(eRaw) : NaN)
      if (Number.isFinite(s)) parsedStarts.push(s)
      if (Number.isFinite(e)) parsedEnds.push(e)
    }
    const globalStart = parsedStarts.length ? Math.min(...parsedStarts) : Date.now() - 24 * 60 * 60 * 1000
    const globalEnd = parsedEnds.length ? Math.max(...parsedEnds) : Date.now()
    const globalSpan = Math.max(1, globalEnd - globalStart)
    const globalBinHours = chooseBinHours(globalSpan)
    const globalBinMs = Math.max(1, Number(globalBinHours)) * 60 * 60 * 1000

    // Combine raw readings across devices and compute interval bins based on
    // combined density. For each interval that contains ANY reading across
    // devices we emit that time as a bin; then compute per-device averages
    // inside each bin. This mirrors the report/export behavior (which
    // aggregates across all readings) so multi-asset plots have the same
    // number of points as reports.
    const allReadings: Array<any> = []
    const byDevice: Record<string, any[]> = {}
    for (const r of results) {
      const deviceID = r?.deviceID ?? r?.deviceId ?? r?.deviceID ?? String(r?.deviceId ?? '')
      const rawData = Array.isArray(r?.data) ? r.data : []
      byDevice[String(deviceID)] = rawData
      for (const rec of rawData) {
        // ensure deviceID is set on each reading for grouping later
        const copy = { ...(rec as any), deviceID }
        allReadings.push(copy)
      }
    }

    // If there are no readings, return empty per-device series
    if (allReadings.length === 0) {
      const empty = Object.keys(byDevice).map((id) => ({ deviceID: id, start: globalStart, end: globalEnd, ticks: [], points: [] }))
      return NextResponse.json({ results: empty })
    }

    // For windows <= 24h, use 2-minute bins aligned to minute boundaries
    const hourMs = 60 * 60 * 1000
    const twoMinMs = 2 * 60 * 1000
    const windowMs = Math.max(1, globalEnd - globalStart)
    const windowHours = windowMs / hourMs

    let intervalMs: number
    let binTimes: number[] = []

    if (windowMs <= 24 * hourMs) {
      // Build 2-minute bins between aligned boundaries and keep bins that have any reading
      const startMin = Math.floor(globalStart / twoMinMs) * twoMinMs
      const endMin = Math.ceil(globalEnd / twoMinMs) * twoMinMs
      const bins = new Map<number, any[]>()
      for (const r of allReadings) {
        const t = new Date(r.receivedAt).getTime()
        const m = Math.floor(t / twoMinMs) * twoMinMs
        const arr = bins.get(m) || []
        arr.push(r)
        bins.set(m, arr)
      }
      binTimes = Array.from(bins.keys()).sort((a, b) => a - b)
      intervalMs = twoMinMs
    } else {
      // Use the same heuristic as aggregateReadings to compute pointsPerHour
      const totalReadings = allReadings.length
      let pointsPerHour: number
      if (totalReadings < 1000) {
        const avgReadingsPerHour = totalReadings / Math.max(windowHours, 1)
        pointsPerHour = Math.max(5, Math.min(10, Math.ceil(avgReadingsPerHour / 10)))
      } else {
        const avgReadingsPerHour = totalReadings / Math.max(windowHours, 1)
        if (avgReadingsPerHour < 300) {
          pointsPerHour = Math.min(20, Math.ceil(avgReadingsPerHour / 15))
        } else {
          pointsPerHour = Math.min(50, Math.ceil(avgReadingsPerHour / 20))
        }
      }
      pointsPerHour = Math.max(1, Math.min(pointsPerHour, 50))
      intervalMs = Math.floor(hourMs / pointsPerHour)

      // Bucket all readings into interval indices and keep only indices that have any reading
      const idxMap = new Map<number, any[]>()
      for (const r of allReadings) {
        const t = new Date(r.receivedAt).getTime()
        const idx = Math.floor((t - globalStart) / intervalMs)
        if (idx < 0) continue
        const arr = idxMap.get(idx) || []
        arr.push(r)
        idxMap.set(idx, arr)
      }
      const idxs = Array.from(idxMap.keys()).sort((a, b) => a - b)
      binTimes = idxs.map((i) => globalStart + i * intervalMs)
    }

    // For each device, compute averages per bin time (only when device has readings in that bin)
    const perDeviceAgg: Array<any> = []
    for (const deviceID of Object.keys(byDevice)) {
      const raw = byDevice[deviceID] || []
      // index readings by bin (for fast lookup)
      const mapByBin = new Map<number, any[]>()
      for (const r of raw) {
        const t = new Date(r.receivedAt).getTime()
        let idx: number
        if (windowMs <= 24 * hourMs) {
          idx = Math.floor(t / twoMinMs) * twoMinMs
        } else {
          idx = Math.floor((t - globalStart) / intervalMs)
        }
        const arr = mapByBin.get(idx) || []
        arr.push(r)
        mapByBin.set(idx, arr)
      }

      const points: any[] = []
      for (const bt of binTimes) {
        let group: any[] | undefined
        if (windowMs <= 24 * hourMs) {
          group = mapByBin.get(bt) || []
        } else {
          const idx = Math.floor((bt - globalStart) / intervalMs)
          group = mapByBin.get(idx) || []
        }
        if (!group || group.length === 0) continue
        const toNum = (v?: any) => {
          if (v === undefined || v === null) return null
          const n = Number(v)
          return Number.isFinite(n) ? n : null
        }
        const counts = group.map((g) => Number((g as any).readingCount ?? 1))
        const weights = counts.map((c) => (Number.isFinite(c) && c > 0 ? c : 1))
        const totalWeight = weights.reduce((a, b) => a + b, 0)
        const avg = (key: string) => {
          const sum = group.reduce((acc, r, i) => {
            const v = toNum((r as any)[key])
            return acc + (Number.isFinite(v as number) ? (v as number) * weights[i] : 0)
          }, 0)
          return totalWeight > 0 ? Math.round(sum / totalWeight) : null
        }
        points.push({
          time: bt,
          AQI: avg('airQualityIndex'),
          PM2_5: avg('valuePM_2_5'),
          PM10: avg('valuePM_10'),
          CO: avg('valueCO'),
          NO2: avg('valueNO2'),
          O3: avg('valueO3'),
          SO2: avg('valueSO2'),
          readingCount: group.length,
          Temperature: avg('airTemperature'),
          Humidity: avg('airHumidity'),
          Pressure: avg('atmosPressure'),
        })
      }

      perDeviceAgg.push({ deviceID, start: globalStart, end: globalEnd, ticks: [], points })
    }

    return NextResponse.json({ results: perDeviceAgg })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
