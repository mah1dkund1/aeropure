import { NextRequest, NextResponse } from "next/server"
import { aggregateReadings, computeAlignedWindowFor24h, type Reading } from "@/lib/aggregate"

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL 
const UPSTREAM = `${BACKEND_BASE_URL}/data`

function parseDateOnly(s: string) {
  // Expect YYYY-MM-DD; interpret in local time at 12:00 PM to 12:00 PM next day
  const [y, m, d] = s.split("-").map((x) => Number(x))
  if (!y || !m || !d) return null
  const start = new Date(y, m - 1, d, 12, 0, 0, 0) // 12:00 PM local
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.getTime(), end: end.getTime() }
}

// Align a time range to bin boundaries. If anchorHour is provided, align end to that hour boundary first.
function alignWindow(nowMs: number, durationMs: number, binMs: number, anchorHour?: number) {
  const endDate = new Date(nowMs)
  if (typeof anchorHour === "number") {
    endDate.setHours(anchorHour, 0, 0, 0)
    if (nowMs < endDate.getTime()) {
      // if before the anchor today, use yesterday's anchor
      endDate.setDate(endDate.getDate() - 1)
    }
  } else {
    // align to nearest bin boundary at or before 'now'
    const floor = Math.floor(endDate.getTime() / binMs) * binMs
    endDate.setTime(floor)
  }
  const startDate = new Date(endDate)
  startDate.setTime(endDate.getTime() - durationMs)
  return { start: startDate.getTime(), end: endDate.getTime() }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const range = (searchParams.get("range") || "24h").toLowerCase() as "24h" | "7d" | "30d" | "total" | string
  const date = searchParams.get("date") // YYYY-MM-DD
  const start = searchParams.get("start") // timestamp
  const end = searchParams.get("end") // timestamp
  const maxPerBin = Number(searchParams.get("maxPerBin") ?? 50)
  const deviceID = searchParams.get("deviceID") || undefined

  // We allow overriding binHours but will choose sensible defaults per range.
  let binHours: number | undefined = searchParams.get("binHours") ? Number(searchParams.get("binHours")) : undefined

  // Determine time window first (we need it to fetch only relevant data)
  let startEnd: { start: number; end: number }
  const now = Date.now()
  
  // CRITICAL FIX: When explicit start/end timestamps are provided (from dashboard),
  // use them directly WITHOUT any timezone-based transformations.
  if (start && end) {
    const startNum = Number(start)
    const endNum = Number(end)
    startEnd = { start: startNum, end: endNum }
    if (binHours == null) {
      // Determine binHours based on the span
      const spanMs = endNum - startNum
      const H = 60 * 60 * 1000
      if (spanMs <= 24 * H) {
        binHours = 2 / 60 // 2 minutes for <= 24h
      } else if (spanMs <= 3 * 24 * H) {
        binHours = 5 / 60 // 5 minutes for <= 3 days
      } else if (spanMs <= 7 * 24 * H) {
        binHours = 1 // 1 hour for <= 7 days
      } else {
        binHours = 4 // 4 hours for > 7 days
      }
    }
  } else if (date) {
    const parsed = parseDateOnly(date)
    if (!parsed) return NextResponse.json({ error: "Invalid date. Use YYYY-MM-DD." }, { status: 400 })
    startEnd = parsed
    if (binHours == null) binHours = 2 // day view -> 2h bins
  } else if (range === "24h") {
    startEnd = computeAlignedWindowFor24h(now, true) // noon→noon
    if (binHours == null) binHours = 2
  } else if (range === "7d") {
    if (binHours == null) binHours = 6 // 6-hour bins across 7 days (28 bins)
    const binMs = binHours * 60 * 60 * 1000
    startEnd = alignWindow(now, 7 * 24 * 60 * 60 * 1000, binMs, 0) // anchor to midnight
  } else if (range === "30d" || range === "last-month" || range === "month") {
    if (binHours == null) binHours = 24 // daily bins across ~30 days
    const binMs = binHours * 60 * 60 * 1000
    startEnd = alignWindow(now, 30 * 24 * 60 * 60 * 1000, binMs, 0) // anchor to midnight
  } else if (range === "total") {
    // For total range, we need to fetch a sample first to determine the extent
    const probeRes = await fetch(`${UPSTREAM}?limit=1000`, { next: { revalidate: 0 } })
    if (!probeRes.ok) return NextResponse.json({ error: `Upstream error ${probeRes.status}` }, { status: 502 })
    const probeJson = await probeRes.json()
    const probeData = (probeJson?.data || []) as Reading[]
    
    const times = probeData.map((r) => new Date(r.receivedAt).getTime()).filter((t) => Number.isFinite(t))
    const minT = times.length > 0 ? Math.min(...times) : now - 30 * 24 * 60 * 60 * 1000
    const maxT = times.length > 0 ? Math.max(...times) : now
    
    if (binHours == null) binHours = 24 // default daily for large spans
    const binMs = binHours * 60 * 60 * 1000
    // Align start to bin boundary and end to boundary after maxT
    const startVal = Math.floor(minT / binMs) * binMs
    const endVal = Math.ceil(maxT / binMs) * binMs
    startEnd = { start: startVal, end: endVal }
  } else {
    // Fallback: treat as 24h rolling window aligned to 2h boundary
    if (binHours == null) binHours = 2
    const binMs = binHours * 60 * 60 * 1000
    startEnd = alignWindow(now, 24 * 60 * 60 * 1000, binMs)
  }

  // Now fetch data for the specific time range with a reasonable limit
  // Add some buffer to the time range to ensure we don't miss edge data
  const bufferMs = 60 * 60 * 1000 // 1 hour buffer
  const fetchStart = new Date(startEnd.start - bufferMs).toISOString()
  const fetchEnd = new Date(startEnd.end + bufferMs).toISOString()
  
  // Fetch with time range filter and reasonable limit
  const fetchUrl = deviceID 
    ? `${UPSTREAM}?deviceID=${deviceID}&start=${fetchStart}&end=${fetchEnd}&limit=50000`
    : `${UPSTREAM}?start=${fetchStart}&end=${fetchEnd}&limit=50000`
  
  console.log(`[Aggregate API] Fetching data from ${fetchStart} to ${fetchEnd}`)
  
  const res = await fetch(fetchUrl, { next: { revalidate: 0 } })
  if (!res.ok) return NextResponse.json({ error: `Upstream error ${res.status}` }, { status: 502 })
  const json = await res.json()
  const data = (json?.data || []) as Reading[]

  // Log unique deviceIDs with data
  const deviceCounts = data.reduce((acc, r) => {
    if (r.deviceID) {
      acc[r.deviceID] = (acc[r.deviceID] || 0) + 1
    }
    return acc
  }, {} as Record<string, number>)
  const deviceIDsWithData = Object.keys(deviceCounts)
  console.log(`[Aggregate API] Devices with data: ${deviceIDsWithData.map(id => `${id} (${deviceCounts[id]} readings)`).join(', ')} (total devices: ${deviceIDsWithData.length})`)

  const binMs = Math.max(1, Number(binHours)) * 60 * 60 * 1000

  const agg = aggregateReadings(data, {
    start: startEnd.start,
    end: startEnd.end,
    binMs,
    maxPerBin,
    deviceID,
  })

  console.log(`[Aggregate API] Range: ${range}, Total records fetched: ${data.length}, Points after aggregation: ${agg.points.length}`)
  console.log(`[Aggregate API] Using time range: ${new Date(startEnd.start).toISOString()} to ${new Date(startEnd.end).toISOString()}`)
  if (agg.points.length > 0) {
    console.log(`[Aggregate API] First point time: ${new Date(agg.points[0].time).toISOString()}`)
    console.log(`[Aggregate API] Last point time: ${new Date(agg.points[agg.points.length - 1].time).toISOString()}`)
  }

  // Build user-friendly ticks by range
  function buildLabelTicks(): number[] {
    // CRITICAL FIX: For explicit start/end (from dashboard), generate ticks
    // based on the actual timestamps without timezone interpretation
    if (start && end) {
      const spanMs = startEnd.end - startEnd.start
      const H = 60 * 60 * 1000
      const DAY = 24 * H
      
      let tickInterval: number
      let maxTicks: number
      
      if (spanMs <= 24 * H) {
        // <= 24 hours: 2-hour intervals
        tickInterval = 2 * H
        maxTicks = 12
      } else if (spanMs <= 3 * DAY) {
        // <= 3 days: 6-hour intervals
        tickInterval = 6 * H
        maxTicks = 12
      } else if (spanMs <= 7 * DAY) {
        // <= 7 days: 12-hour intervals
        tickInterval = 12 * H
        maxTicks = 14
      } else if (spanMs <= 30 * DAY) {
        // <= 30 days: 3-day intervals
        tickInterval = 3 * DAY
        maxTicks = 10
      } else {
        // > 30 days: weekly intervals
        tickInterval = 7 * DAY
        maxTicks = 10
      }
      
      const out: number[] = []
      // Align first tick to interval boundary
      const firstTick = Math.ceil(startEnd.start / tickInterval) * tickInterval
      
      for (let t = firstTick; t <= startEnd.end && out.length < maxTicks; t += tickInterval) {
        out.push(t)
      }
      
      // Always include the end timestamp if not too close to last tick
      if (out.length > 0 && (startEnd.end - out[out.length - 1]) > tickInterval * 0.3) {
        out.push(startEnd.end)
      } else if (out.length === 0) {
        // Fallback: at least show start and end
        out.push(startEnd.start, startEnd.end)
      }
      
      return out
    }
    
    // For specific date or 24h, use 2-hour bin boundaries starting from the window start
    if (date || range === "24h") {
      const twoHourMs = 2 * 60 * 60 * 1000
      const out: number[] = []
      for (let t = startEnd.start; t <= startEnd.end; t += twoHourMs) {
        out.push(t)
      }
      return out
    }
    
    // For 7d: one tick per day at midnight (UTC)
    if (range === "7d") {
      const out: number[] = []
      const dayMs = 24 * 60 * 60 * 1000
      // Use UTC date for consistency across timezones
      const startDate = new Date(startEnd.start)
      const startMidnightUTC = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
      for (let t = startMidnightUTC; t <= startEnd.end; t += dayMs) {
        if (t >= startEnd.start) out.push(t)
      }
      return out
    }
    
    // For 30d: one tick every 3 days at midnight (UTC)
    if (range === "30d" || range === "last-month" || range === "month") {
      const out: number[] = []
      const threeDayMs = 3 * 24 * 60 * 60 * 1000
      const startDate = new Date(startEnd.start)
      const startMidnightUTC = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
      for (let t = startMidnightUTC; t <= startEnd.end; t += threeDayMs) {
        if (t >= startEnd.start) out.push(t)
      }
      return out
    }
    
    // For total: determine tick interval based on data span
    const spanDays = (startEnd.end - startEnd.start) / (24 * 60 * 60 * 1000)
    let tickInterval: number
    
    if (spanDays <= 7) {
      // <= 7 days: daily ticks
      tickInterval = 24 * 60 * 60 * 1000
    } else if (spanDays <= 30) {
      // 7-30 days: every 3 days
      tickInterval = 3 * 24 * 60 * 60 * 1000
    } else if (spanDays <= 90) {
      // 30-90 days: weekly ticks
      tickInterval = 7 * 24 * 60 * 60 * 1000
    } else {
      // > 90 days: every 2 weeks
      tickInterval = 14 * 24 * 60 * 60 * 1000
    }
    
    const out: number[] = []
    const startDate = new Date(startEnd.start)
    const startMidnightUTC = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
    for (let t = startMidnightUTC; t <= startEnd.end; t += tickInterval) {
      if (t >= startEnd.start) out.push(t)
    }
    return out
  }
  const labelTicks = buildLabelTicks()

  return NextResponse.json({
    range,
    date: date ?? null,
    start: agg.start,
    end: agg.end,
    binMs,
    maxPerBin,
    ticks: labelTicks,
    points: agg.points,
  })
}
