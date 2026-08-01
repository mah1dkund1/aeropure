export type Reading = {
  receivedAt: string
  airQualityIndex?: number
  valuePM_2_5?: number
  valuePM_10?: number
  valueCO?: number
  valueNO2?: number
  valueO3?: number
  valueSO2?: number
  deviceID?: number | string
}

export type AggregateOptions = {
  start: number // ms incclusive
  end: number // ms exclusive
  binMs: number // e.g., 2h in ms
  maxPerBin: number // e.g., 50
  deviceID?: number | string
}

export type AggregatedPoint = {
  time: number // avg timestamp (ms)
  AQI: number | null
  PM2_5: number | null
  PM10: number | null
  CO: number | null
  NO2: number | null
  O3: number | null
  SO2: number | null
  readingCount?: number // number of readings averaged in this point
  // environmental sensors
  Temperature?: number | null
  Humidity?: number | null
  Pressure?: number | null
}

function mean(nums: number[]): number | null {
  const arr = nums.filter((n) => Number.isFinite(n))
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

export function aggregateReadings(readings: Reading[], opts: AggregateOptions) {
  const { start, end, binMs, maxPerBin, deviceID } = opts
  const filtered = readings.filter((r) => {
    if (deviceID != null && String(r.deviceID) !== String(deviceID)) return false
    const t = new Date(r.receivedAt).getTime()
    return t >= start && t < end
  })

  console.log(`[Aggregate] Input: ${readings.length} readings, Filtered: ${filtered.length} readings`)
  console.log(`[Aggregate] Window: ${new Date(start).toISOString()} to ${new Date(end).toISOString()}`)
  console.log(`[Aggregate] Bin size: ${binMs}ms (${binMs / (60 * 60 * 1000)} hours)`)

  // Ensure ascending by time
  filtered.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())

  // If the requested window is 24 hours or less, return each reading as a point
  // (do NOT average into larger buckets). This preserves minute-resolution
  // and allows the frontend to plot every reading within the 24h window.
  if (end - start <= 24 * 60 * 60 * 1000) {
  console.log(`[Aggregate] 24h window detected - aggregating readings per-2-min (weighted average) from ${filtered.length} readings`)
  const minuteMs = 2 * 60 * 1000 // 2-minute bins
    const toNum = (v?: any) => {
      if (v === undefined || v === null) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }

    // Group readings by minute bucket
    const bins = new Map<number, Reading[]>()
    for (const r of filtered) {
      const t = new Date(r.receivedAt).getTime()
      const m = Math.floor(t / minuteMs) * minuteMs
      const arr = bins.get(m) || []
      arr.push(r)
      bins.set(m, arr)
    }

    // Build continuous 2-minute-aligned points between start and end (inclusive start, exclusive end)
    // Skip empty bins so the frontend will not draw zeros; this produces gaps (line breaks) where no data exists.
    const startMin = Math.floor(start / minuteMs) * minuteMs
    const endMin = Math.ceil(end / minuteMs) * minuteMs
    const points: AggregatedPoint[] = []
    for (let t = startMin; t < endMin; t += minuteMs) {
      const group = bins.get(t) || []
      if (group.length === 0) {
        // Skip empty 2-minute bins — don't emit zero points
        continue
      }
      // compute weighted average per bin (use per-reading readingCount when available)
      const counts = group.map((r) => Number((r as any).readingCount ?? 1))
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
        time: t,
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

    // ticks left empty; frontend thins/chooses ticks
    const ticks: number[] = []
    console.log(`[Aggregate] Generated ${points.length} 2-minute-aligned points`)
    if (points.length === 0) return { start, end, ticks, points }
    // Collapse returned domain to the actual span of emitted points so the frontend
    // doesn't include long empty ranges where no data was emitted.
    const outStart = points[0].time
    const outEnd = points[points.length - 1].time
    return { start: outStart, end: outEnd, ticks, points }
  }

  // Dynamic point calculation based on number of readings
  // For < 1000 readings: max 10 points per hour
  // For >= 1000 readings: scale up smoothly
  const totalReadings = filtered.length
  const hourMs = 60 * 60 * 1000
  const windowHours = (end - start) / hourMs
  
  let pointsPerHour: number
  if (totalReadings < 1000) {
    // Low data: 5-10 points per hour (depending on readings per hour)
    const avgReadingsPerHour = totalReadings / Math.max(windowHours, 1)
    pointsPerHour = Math.max(5, Math.min(10, Math.ceil(avgReadingsPerHour / 10)))
  } else {
    // High data: scale up - more readings = more points for smoothness
    // 1000-3000 readings: 10-20 points per hour
    // 3000+ readings: 20-50 points per hour (capped at maxPerBin)
    const avgReadingsPerHour = totalReadings / Math.max(windowHours, 1)
    if (avgReadingsPerHour < 300) {
      pointsPerHour = Math.min(20, Math.ceil(avgReadingsPerHour / 15))
    } else {
      pointsPerHour = Math.min(maxPerBin, Math.ceil(avgReadingsPerHour / 20))
    }
  }
  
  pointsPerHour = Math.max(1, Math.min(pointsPerHour, maxPerBin))
  console.log(`[Aggregate] Dynamic points per hour: ${pointsPerHour} (based on ${totalReadings} total readings, ~${(totalReadings / Math.max(windowHours, 1)).toFixed(1)} per hour)`)

  // Group readings into sub-hour intervals based on calculated pointsPerHour
  const intervalMs = hourMs / pointsPerHour
  const intervalBins = new Map<number, Reading[]>()
  
  for (const r of filtered) {
    const t = new Date(r.receivedAt).getTime()
    const intervalIdx = Math.floor((t - start) / intervalMs)
    if (intervalIdx < 0 || t >= end) continue
    const arr = intervalBins.get(intervalIdx) || []
    arr.push(r)
    intervalBins.set(intervalIdx, arr)
  }

  console.log(`[Aggregate] Created ${intervalBins.size} interval bins (${pointsPerHour} per hour)`)

  // Calculate average for each interval
  const intervalAverages = new Map<number, AggregatedPoint>()
  for (const [intervalIdx, group] of intervalBins.entries()) {
    if (group.length === 0) continue
    
    const intervalStart = start + intervalIdx * intervalMs
    
    intervalAverages.set(intervalIdx, {
      time: intervalStart, // Use interval boundary for alignment
      AQI: Math.round(mean(group.map((r) => Number(r.airQualityIndex))) ?? 0),
      PM2_5: Math.round(mean(group.map((r) => Number(r.valuePM_2_5))) ?? 0),
      PM10: Math.round(mean(group.map((r) => Number(r.valuePM_10))) ?? 0),
      CO: Math.round(mean(group.map((r) => Number(r.valueCO))) ?? 0),
      NO2: Math.round(mean(group.map((r) => Number(r.valueNO2))) ?? 0),
      O3: Math.round(mean(group.map((r) => Number(r.valueO3))) ?? 0),
      SO2: Math.round(mean(group.map((r) => Number(r.valueSO2))) ?? 0),
      Temperature: Math.round(mean(group.map((r) => Number((r as any).airTemperature))) ?? 0),
      Humidity: Math.round(mean(group.map((r) => Number((r as any).airHumidity))) ?? 0),
      Pressure: Math.round(mean(group.map((r) => Number((r as any).atmosPressure))) ?? 0),
      readingCount: group.length,
    })
  }

  // Build tick positions (every 2-hour bin boundary for display)
  const tickCount = Math.ceil((end - start) / binMs) + 1
  const ticks: number[] = []
  for (let i = 0; i < tickCount; i++) {
    ticks.push(start + i * binMs)
  }

  // Create points: output all interval averages for smooth curves
  const points: AggregatedPoint[] = []
  
  // Sort by interval index to maintain chronological order
  const sortedIntervals = Array.from(intervalAverages.entries()).sort((a, b) => a[0] - b[0])
  for (const [intervalIdx, avgPoint] of sortedIntervals) {
    points.push(avgPoint)
  }

  console.log(`[Aggregate] Generated ${points.length} points from ${intervalAverages.size} interval averages`)
  if (points.length > 0) {
    console.log(`[Aggregate] First point: ${new Date(points[0].time).toISOString()}, AQI: ${points[0].AQI}`)
    console.log(`[Aggregate] Last point: ${new Date(points[points.length - 1].time).toISOString()}, AQI: ${points[points.length - 1].AQI}`)
  }

  return { start, end, ticks, points }
}

export function computeAlignedWindowFor24h(nowMs: number, anchorAtNoon = false) {
  const d = new Date(nowMs)
  if (anchorAtNoon) {
    // From 12:00 PM of the previous day to 12:00 PM today
    const end = new Date(d)
    end.setHours(12, 0, 0, 0)
    if (nowMs < end.getTime()) {
      // If it's before today's noon, use yesterday's noon as end
      end.setDate(end.getDate() - 1)
    }
    const start = new Date(end)
    start.setDate(start.getDate() - 1)
    return { start: start.getTime(), end: end.getTime() }
  }
  // Align end to nearest 2-hour boundary and go back 24h
  const end = new Date(d)
  const hour = end.getHours()
  end.setMinutes(0, 0, 0)
  end.setHours(hour - (hour % 2))
  const start = new Date(end)
  start.setHours(start.getHours() - 24)
  return { start: start.getTime(), end: end.getTime() }
}
