import { NextRequest, NextResponse } from "next/server"
export const runtime = 'nodejs'
import { generatePDFReport } from "@/lib/reports/pdf-generator"
import { generateCSVReport } from "@/lib/reports/csv-generator"
import { generateGeoJSONReport } from "@/lib/reports/geojson-generator"
import { aggregateReadings } from "@/lib/aggregate"
import { parse } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL 
const DATA_API = `${BACKEND_BASE_URL}/data`
const USER_TIMEZONE = 'Asia/Karachi' // Default timezone for users

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const startDateTime = searchParams.get("startDateTime") || searchParams.get("startDate")
    const endDateTime = searchParams.get("endDateTime") || searchParams.get("endDate")
    const metrics = searchParams.get("metrics")?.split(",") || searchParams.get("pollutants")?.split(",") || []
    const deviceID = searchParams.get("deviceID")
    const format = searchParams.get("format") || "pdf"
    const includeMap = searchParams.get("includeMap") === "true"
    const includeCharts = searchParams.get("includeCharts") === "true"

    if (!startDateTime || !endDateTime || metrics.length === 0) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    // TIMEZONE-AWARE PARSING: Parse datetime strings assuming user's timezone (Asia/Karachi)
    // This ensures consistent interpretation on both localhost and Vercel (UTC)
    const userTimeZone = USER_TIMEZONE
    
    // Parse the naive datetime string as a Date object
    const startDateLocal = parse(startDateTime, 'yyyy-MM-dd\'T\'HH:mm', new Date())
    const endDateLocal = parse(endDateTime, 'yyyy-MM-dd\'T\'HH:mm', new Date())
    
    // Interpret these dates as being in the user's timezone and convert to UTC
    // fromZonedTime takes a date in the specified timezone and returns the equivalent UTC date
    const fromTs = fromZonedTime(startDateLocal, userTimeZone).getTime()
    const toTs = fromZonedTime(endDateLocal, userTimeZone).getTime()

    // LIMIT: Maximum 30 days (1 month)
    const maxSpanMs = 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
    const spanMs = toTs - fromTs
    if (spanMs > maxSpanMs) {
      return NextResponse.json({ 
        error: "Report period cannot exceed 30 days. Please select a shorter date range." 
      }, { status: 400 })
    }
    if (spanMs <= 0) {
      return NextResponse.json({ 
        error: "Invalid date range. End date must be after start date." 
      }, { status: 400 })
    }

    console.log(`[Export GET] Requested range (${userTimeZone}): ${startDateTime} to ${endDateTime}`)
    console.log(`[Export GET] UTC range: ${new Date(fromTs).toISOString()} to ${new Date(toTs).toISOString()}`)
    console.log(`[Export GET] Device filter: ${deviceID || 'all'}`)

    // Fetch time-filtered data with buffer (same as aggregate API)
    const bufferMs = 60 * 60 * 1000 // 1 hour buffer
    const fetchStart = new Date(fromTs - bufferMs).toISOString()
    const fetchEnd = new Date(toTs + bufferMs).toISOString()
    
    const fetchUrl = deviceID 
      ? `${DATA_API}?deviceID=${deviceID}&start=${fetchStart}&end=${fetchEnd}&limit=50000`
      : `${DATA_API}?start=${fetchStart}&end=${fetchEnd}&limit=50000`
    
    console.log(`[Export GET] Fetching data from ${fetchStart} to ${fetchEnd}`)
    console.log(`[Export GET] Fetch URL: ${fetchUrl}`)
    
    let getRawDataResponse = await fetch(fetchUrl, { next: { revalidate: 0 } })
    if (!getRawDataResponse.ok) throw new Error("Failed to fetch data from upstream API")
    let getRawApiData = await getRawDataResponse.json()
    let getAllRawReadings = getRawApiData?.data || []

    console.log(`[Export GET] Total raw readings fetched with time filter: ${getAllRawReadings.length}`)
    
    // FALLBACK: If we got very few or no readings with time filter, try without time filter
    // This handles cases where the upstream API doesn't properly support start/end parameters
    if (getAllRawReadings.length < 100) {
      console.log(`[Export GET] Low reading count, trying fallback fetch without time filter`)
      const fallbackUrl = deviceID 
        ? `${DATA_API}?deviceID=${deviceID}&limit=50000`
        : `${DATA_API}?limit=50000`
      
      getRawDataResponse = await fetch(fallbackUrl, { next: { revalidate: 0 } })
      if (!getRawDataResponse.ok) throw new Error("Failed to fetch data from upstream API (fallback)")
      getRawApiData = await getRawDataResponse.json()
      getAllRawReadings = getRawApiData?.data || []
      console.log(`[Export GET] Fallback fetch returned: ${getAllRawReadings.length} readings`)
    }

    console.log(`[Export GET] Total raw readings fetched: ${getAllRawReadings.length}`)
    
    // Log device breakdown
    const deviceCounts = getAllRawReadings.reduce((acc: any, r: any) => {
      if (r.deviceID) {
        acc[r.deviceID] = (acc[r.deviceID] || 0) + 1
      }
      return acc
    }, {})
    console.log(`[Export GET] Device breakdown: ${JSON.stringify(deviceCounts)}`)

    // Use the same aggregation logic as the aggregate API
    const aggregationSpanMs = toTs - fromTs
    const H = 60 * 60 * 1000
    let binMs = 2 * H
    if (aggregationSpanMs <= 24 * H) {
      binMs = 2 * 60 * 1000 // 2 minutes for <= 24h
    } else if (aggregationSpanMs <= 3 * 24 * H) {
      binMs = 5 * 60 * 1000 // 5 minutes for <= 3 days
    } else if (aggregationSpanMs <= 7 * 24 * H) {
      binMs = 1 * H // 1 hour for <= 7 days
    } else {
      binMs = 4 * H // 4 hours for > 7 days
    }

    // Aggregate using the same function as the aggregate API
    const aggregated = aggregateReadings(getAllRawReadings, {
      start: fromTs,
      end: toTs,
      binMs,
      maxPerBin: 50,
      deviceID: deviceID || undefined,
    })

    const aggregatedPoints = aggregated.points
    const labelTicks = aggregated.ticks
    
    console.log(`[Export GET] Aggregated to ${aggregatedPoints.length} points`)
    console.log(`[Export GET] Time range: ${new Date(aggregated.start).toISOString()} to ${new Date(aggregated.end).toISOString()}`)

    // For CSV: use ALL raw readings (no aggregation)
    // For PDF: use aggregated readings (for charts)
    const rawReadings = getAllRawReadings
      .filter((r: any) => {
        const ts = new Date(r.receivedAt).getTime()
        const matchesTime = ts >= fromTs && ts <= toTs
        const matchesDevice = !deviceID || String(r.deviceID) === String(deviceID)
        return matchesTime && matchesDevice
      })
      .map((r: any) => ({
        receivedAt: r.receivedAt,
        airQualityIndex: r.airQualityIndex,
        valuePM_2_5: r.valuePM_2_5,
        valuePM_10: r.valuePM_10,
        valueCO: r.valueCO,
        valueNO2: r.valueNO2,
        valueO3: r.valueO3,
        valueSO2: r.valueSO2,
        airTemperature: r.airTemperature,
        airHumidity: r.airHumidity,
        atmosPressure: r.atmosPressure,
        windDir: r.windDir,
        windSpeed: r.windSpeed,
        deviceID: r.deviceID,
      }))

    console.log(`[Export GET] Device filter: ${deviceID || 'all'}`)
    console.log(`[Export GET] Raw readings in range: ${rawReadings.length}`)
    console.log(`[Export GET] Aggregated to ${aggregatedPoints.length} points`)

    const filteredReadings = aggregatedPoints.map((p: any) => ({
      receivedAt: new Date(p.time).toISOString(),
      airQualityIndex: p.AQI,
      valuePM_2_5: p.PM2_5,
      valuePM_10: p.PM10,
      valueCO: p.CO,
      valueNO2: p.NO2,
      valueO3: p.O3,
      valueSO2: p.SO2,
      airTemperature: p.Temperature,
      airHumidity: p.Humidity,
      atmosPressure: p.Pressure,
      deviceID: deviceID || undefined,
      readingCount: p.readingCount,
    }))

    // Generate report
    let reportData: string | Buffer
    let contentType: string
    let fileExtension: string

    switch (format) {
      case "pdf":
        reportData = await generatePDFReport({
          readings: filteredReadings, // Use aggregated data for PDF charts and stats
          rawReadings: rawReadings, // Pass raw readings for data table
          metrics,
          startDateTime,
          endDateTime,
          includeMap,
          includeCharts,
          // Pass ticks and domain for proper chart alignment
          ticks: labelTicks,
          domain: [fromTs, toTs],
          // Cover page information (for GET endpoint - usually "All Assets")
          location: undefined, // GET endpoint doesn't have asset info
          assetName: deviceID ? `Asset ${deviceID}` : "All Assets",
          deviceID: deviceID || undefined,
          sensorCount: metrics.length, // Number of metrics being monitored
        })
        contentType = "application/pdf"
        fileExtension = "pdf"
        break
      case "csv":
        reportData = await generateCSVReport({ 
          readings: rawReadings, // Use ALL raw readings for CSV
          metrics, 
          startDateTime, 
          endDateTime,
          // Single-asset (GET) context
          deviceID: deviceID || undefined,
          assetName: undefined,
        })
        contentType = "text/csv"
        fileExtension = "csv"
        break
      case "geojson":
        reportData = await generateGeoJSONReport({ 
          readings: rawReadings, // Use raw readings for GeoJSON
          metrics, 
          startDateTime, 
          endDateTime,
          deviceID: deviceID || undefined,
          assetName: undefined,
        })
        contentType = "application/geo+json"
        fileExtension = "json"
        break
      default:
        return NextResponse.json({ error: "Invalid format" }, { status: 400 })
    }

    const startStr = new Date(startDateTime).toISOString().split("T")[0]
    const endStr = new Date(endDateTime).toISOString().split("T")[0]
    const filename = `aeropure-report-${startStr}-to-${endStr}.${fileExtension}`

    const responseData = typeof reportData === "string" ? new TextEncoder().encode(reportData) : new Uint8Array(reportData)

    return new NextResponse(responseData, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache",
      },
    })
  } catch (error: any) {
    console.error("[Export GET] Error:", error)
    return NextResponse.json({ error: error?.message || "Failed to generate report" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const startDateTime = body.startDateTime // datetime-local string
    const endDateTime = body.endDateTime
    const metrics = (body.metrics || "").split(",").filter(Boolean)
    
    // Support both deviceID (single, backward compat) and deviceIDs (array, multi-asset)
    const deviceID = body.deviceID
    const deviceIDs = body.deviceIDs as string[] | undefined
    const assetNames = body.assetNames as string[] | undefined
    const assetLocations = body.assetLocations as string[] | undefined
    
    const format = body.format || "pdf"
    const includeMap = Boolean(body.includeMap)
    const includeCharts = Boolean(body.includeCharts)
    // Cover page information
    const location = body.location as string | undefined
    const assetName = body.assetName as string | undefined
    // Support both single image (legacy) and multiple images (new)
    const mapImageDataUrl = body.mapImageDataUrl as string | undefined
    const mapImageDataUrls = body.mapImageDataUrls as string[] | undefined
    let backgroundImageDataUrls: string[] = []
    
    // If multiple images provided, use them; otherwise fall back to single image
    if (mapImageDataUrls && Array.isArray(mapImageDataUrls) && mapImageDataUrls.length > 0) {
      backgroundImageDataUrls = mapImageDataUrls
    } else if (mapImageDataUrl) {
      backgroundImageDataUrls = [mapImageDataUrl]
    } else if (body.backgroundImageDataUrl) {
      backgroundImageDataUrls = [body.backgroundImageDataUrl as string]
    }

    if (!startDateTime || !endDateTime || metrics.length === 0) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    // TIMEZONE-AWARE PARSING: Parse datetime strings assuming user's timezone (Asia/Karachi)
    // This ensures consistent interpretation on both localhost and Vercel (UTC)
    const userTimeZone = USER_TIMEZONE
    
    // Parse the naive datetime string as a Date object
    const startDateLocal = parse(startDateTime, 'yyyy-MM-dd\'T\'HH:mm', new Date())
    const endDateLocal = parse(endDateTime, 'yyyy-MM-dd\'T\'HH:mm', new Date())
    
    // Interpret these dates as being in the user's timezone and convert to UTC
    // fromZonedTime takes a date in the specified timezone and returns the equivalent UTC date
    const fromTs = fromZonedTime(startDateLocal, userTimeZone).getTime()
    const toTs = fromZonedTime(endDateLocal, userTimeZone).getTime()

    // LIMIT: Maximum 30 days (1 month)
    const maxSpanMs = 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
    const requestSpanMs = toTs - fromTs
    if (requestSpanMs > maxSpanMs) {
      return NextResponse.json({ 
        error: "Report period cannot exceed 30 days. Please select a shorter date range." 
      }, { status: 400 })
    }
    if (requestSpanMs <= 0) {
      return NextResponse.json({ 
        error: "Invalid date range. End date must be after start date." 
      }, { status: 400 })
    }

    // Determine which devices to fetch
    const targetDeviceIDs = deviceIDs && deviceIDs.length > 0 ? deviceIDs : (deviceID ? [deviceID] : [])

    console.log(`[Export POST] Requested range (${userTimeZone}): ${startDateTime} to ${endDateTime}`)
    console.log(`[Export POST] UTC range: ${new Date(fromTs).toISOString()} to ${new Date(toTs).toISOString()}`)
    console.log(`[Export POST] Device filter: ${targetDeviceIDs.length > 0 ? targetDeviceIDs.join(', ') : 'all'}`)

    // Fetch time-filtered data with buffer (same as aggregate API)
    const bufferMs = 60 * 60 * 1000 // 1 hour buffer
    const fetchStart = new Date(fromTs - bufferMs).toISOString()
    const fetchEnd = new Date(toTs + bufferMs).toISOString()
    
    // For multiple deviceIDs, we need to fetch data for all of them
    // The API doesn't support multiple deviceID parameters, so we fetch all data and filter later
    // OR we could make multiple API calls and merge the results
    let allReadings: any[] = []
    
    if (targetDeviceIDs.length === 1) {
      // Single device - use existing logic
      const fetchUrl = `${DATA_API}?deviceID=${targetDeviceIDs[0]}&start=${fetchStart}&end=${fetchEnd}&limit=50000`
      
      console.log(`[Export POST] Fetching data from ${fetchStart} to ${fetchEnd}`)
      console.log(`[Export POST] Fetch URL: ${fetchUrl}`)
      
      let dataResponse = await fetch(fetchUrl, { next: { revalidate: 0 } })
      if (!dataResponse.ok) throw new Error("Failed to fetch data from upstream API")
      let apiData = await dataResponse.json()
      allReadings = apiData?.data || []

      console.log(`[Export POST] Total raw readings fetched with time filter: ${allReadings.length}`)
      
      // FALLBACK: If we got very few or no readings with time filter, try without time filter
      if (allReadings.length < 100) {
        console.log(`[Export POST] Low reading count, trying fallback fetch without time filter`)
        const fallbackUrl = `${DATA_API}?deviceID=${targetDeviceIDs[0]}&limit=50000`
        
        dataResponse = await fetch(fallbackUrl, { next: { revalidate: 0 } })
        if (!dataResponse.ok) throw new Error("Failed to fetch data from upstream API (fallback)")
        apiData = await dataResponse.json()
        allReadings = apiData?.data || []
        console.log(`[Export POST] Fallback fetch returned: ${allReadings.length} readings`)
      }
    } else if (targetDeviceIDs.length > 1) {
      // Multiple devices - fetch for each device and merge
      console.log(`[Export POST] Fetching data for ${targetDeviceIDs.length} devices`)
      
      for (const devID of targetDeviceIDs) {
        const fetchUrl = `${DATA_API}?deviceID=${devID}&start=${fetchStart}&end=${fetchEnd}&limit=50000`
        
        try {
          let dataResponse = await fetch(fetchUrl, { next: { revalidate: 0 } })
          if (!dataResponse.ok) {
            console.warn(`[Export POST] Failed to fetch data for device ${devID}`)
            continue
          }
          let apiData = await dataResponse.json()
          const readings = apiData?.data || []
          
          console.log(`[Export POST] Fetched ${readings.length} readings for device ${devID}`)
          
          // FALLBACK for this device
          if (readings.length < 100) {
            const fallbackUrl = `${DATA_API}?deviceID=${devID}&limit=50000`
            dataResponse = await fetch(fallbackUrl, { next: { revalidate: 0 } })
            if (dataResponse.ok) {
              apiData = await dataResponse.json()
              const fallbackReadings = apiData?.data || []
              console.log(`[Export POST] Fallback fetch for device ${devID}: ${fallbackReadings.length} readings`)
              allReadings.push(...fallbackReadings)
            } else {
              allReadings.push(...readings)
            }
          } else {
            allReadings.push(...readings)
          }
        } catch (err) {
          console.error(`[Export POST] Error fetching data for device ${devID}:`, err)
        }
      }
    } else {
      // No specific device - fetch all
      const fetchUrl = `${DATA_API}?start=${fetchStart}&end=${fetchEnd}&limit=50000`
      
      console.log(`[Export POST] Fetching data from ${fetchStart} to ${fetchEnd}`)
      console.log(`[Export POST] Fetch URL: ${fetchUrl}`)
      
      let dataResponse = await fetch(fetchUrl, { next: { revalidate: 0 } })
      if (!dataResponse.ok) throw new Error("Failed to fetch data from upstream API")
      let apiData = await dataResponse.json()
      allReadings = apiData?.data || []

      console.log(`[Export POST] Total raw readings fetched with time filter: ${allReadings.length}`)
      
      // FALLBACK: If we got very few or no readings with time filter, try without time filter
      if (allReadings.length < 100) {
        console.log(`[Export POST] Low reading count, trying fallback fetch without time filter`)
        const fallbackUrl = `${DATA_API}?limit=50000`
        
        dataResponse = await fetch(fallbackUrl, { next: { revalidate: 0 } })
        if (!dataResponse.ok) throw new Error("Failed to fetch data from upstream API (fallback)")
        apiData = await dataResponse.json()
        allReadings = apiData?.data || []
        console.log(`[Export POST] Fallback fetch returned: ${allReadings.length} readings`)
      }
    }

    console.log(`[Export POST] Total raw readings fetched: ${allReadings.length}`)
    
    // Log device breakdown
    const deviceCounts = allReadings.reduce((acc: any, r: any) => {
      if (r.deviceID) {
        acc[r.deviceID] = (acc[r.deviceID] || 0) + 1
      }
      return acc
    }, {})
    console.log(`[Export POST] Device breakdown: ${JSON.stringify(deviceCounts)}`)

    // Use the same aggregation logic as the aggregate API
    const aggregationSpanMs = toTs - fromTs
    const H = 60 * 60 * 1000
    let binMs = 2 * H
    if (aggregationSpanMs <= 24 * H) {
      binMs = 2 * 60 * 1000 // 2 minutes for <= 24h
    } else if (aggregationSpanMs <= 3 * 24 * H) {
      binMs = 5 * 60 * 1000 // 5 minutes for <= 3 days
    } else if (aggregationSpanMs <= 7 * 24 * H) {
      binMs = 1 * H // 1 hour for <= 7 days
    } else {
      binMs = 4 * H // 4 hours for > 7 days
    }

    // Aggregate using the same function as the aggregate API
    // For multi-asset reports, we aggregate all selected assets together
    const aggregated = aggregateReadings(allReadings, {
      start: fromTs,
      end: toTs,
      binMs,
      maxPerBin: 50,
      deviceID: targetDeviceIDs.length === 1 ? targetDeviceIDs[0] : undefined, // Only filter if single device
    })

    const aggregatedPoints = aggregated.points
    const domain = [aggregated.start, aggregated.end]
    const labelTicks = aggregated.ticks
    
    console.log(`[Export POST] Aggregated to ${aggregatedPoints.length} points`)
    console.log(`[Export POST] Time range: ${new Date(aggregated.start).toISOString()} to ${new Date(aggregated.end).toISOString()}`)

    // For CSV: use ALL raw readings (no aggregation)
    // For PDF: use aggregated readings (for charts)
    const rawReadings = allReadings
      .filter((r: any) => {
        const ts = new Date(r.receivedAt).getTime()
        const matchesTime = ts >= fromTs && ts <= toTs
        // For multi-asset, check if deviceID is in targetDeviceIDs
        const matchesDevice = targetDeviceIDs.length === 0 || targetDeviceIDs.some(id => String(r.deviceID) === String(id))
        return matchesTime && matchesDevice
      })
      .map((r: any) => ({
        receivedAt: r.receivedAt,
        airQualityIndex: r.airQualityIndex,
        valuePM_2_5: r.valuePM_2_5,
        valuePM_10: r.valuePM_10,
        valueCO: r.valueCO,
        valueNO2: r.valueNO2,
        valueO3: r.valueO3,
        valueSO2: r.valueSO2,
        airTemperature: r.airTemperature,
        airHumidity: r.airHumidity,
        atmosPressure: r.atmosPressure,
        windDir: r.windDir,
        windSpeed: r.windSpeed,
        deviceID: r.deviceID,
      }))

    console.log(`[Export POST] Raw readings in range: ${rawReadings.length}`)
    console.log(`[Export POST] Generated ${labelTicks.length} tick marks from ${aggregatedPoints.length} data points`)
    const timeSpanMs = toTs - fromTs
    console.log(`[Export POST] Span: ${(timeSpanMs / (60 * 60 * 1000)).toFixed(2)} hours`)
    if (labelTicks.length > 0) {
      console.log(`[Export POST] First tick: ${new Date(labelTicks[0]).toISOString()}`)
      console.log(`[Export POST] Last tick: ${new Date(labelTicks[labelTicks.length - 1]).toISOString()}`)
    }

    // Convert aggregated points to Reading format for PDF reports
    const aggregatedReadings = aggregatedPoints.map((p: any) => ({
      receivedAt: new Date(p.time).toISOString(),
      airQualityIndex: p.AQI,
      valuePM_2_5: p.PM2_5,
      valuePM_10: p.PM10,
      valueCO: p.CO,
      valueNO2: p.NO2,
      valueO3: p.O3,
      valueSO2: p.SO2,
      airTemperature: p.Temperature,
      airHumidity: p.Humidity,
      atmosPressure: p.Pressure,
      deviceID: deviceID || undefined,
      readingCount: p.readingCount,
    }))

    // If includeMap requested, prefer a client-provided snapshot; otherwise try to fetch a server-side static map.
    if (includeMap && backgroundImageDataUrls.length === 0) {
      try {
        const serverKey = process.env.MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.MAPS_API_KEY
        if (serverKey) {
          // Prefer explicit map center/zoom provided by client
          let centerLat = 31.5204
          let centerLng = 74.3587
          let zoom = 9

          if (body.mapCenter && typeof body.mapCenter.lat === "number" && typeof body.mapCenter.lng === "number") {
            centerLat = Number(body.mapCenter.lat)
            centerLng = Number(body.mapCenter.lng)
          }

          if (typeof body.mapZoom === "number") {
            zoom = Math.max(1, Math.min(21, Number(body.mapZoom)))
          }

          const staticW = 640
          const staticH = 400
          const scale = 2
          const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat},${centerLng}&zoom=${zoom}&size=${staticW}x${staticH}&scale=${scale}&maptype=roadmap&key=${encodeURIComponent(serverKey)}`
          try {
            const mapResp = await fetch(staticMapUrl)
            if (mapResp.ok) {
              const ab = await mapResp.arrayBuffer()
              const b64 = Buffer.from(ab).toString("base64")
              backgroundImageDataUrls.push(`data:image/png;base64,${b64}`)
              console.log("[Export POST] Fetched server-side static map for background, size bytes:", ab.byteLength)
            } else {
              console.warn("[Export POST] Server-side static map fetch failed with status", mapResp.status)
            }
          } catch (err) {
            console.warn("[Export POST] Error fetching server-side static map:", err)
          }
        }
      } catch (err) {
        console.warn("[Export POST] Background static map fallback failed:", err)
      }
    }

    // If we still don't have a background image, synthesize a simple SVG basemap so the PDF isn't blank
    if (includeMap && backgroundImageDataUrls.length === 0) {
      try {
        const svgW = 1280
        const svgH = 800
        const centerLat = (body.mapCenter && Number(body.mapCenter.lat)) || 31.5204
        const centerLng = (body.mapCenter && Number(body.mapCenter.lng)) || 74.3587
        const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='${svgW}' height='${svgH}' viewBox='0 0 ${svgW} ${svgH}'>
          <defs>
            <linearGradient id='g' x1='0' x2='0' y1='0' y2='1'>
              <stop offset='0' stop-color='#f8fafc'/>
              <stop offset='1' stop-color='#eef2f7'/>
            </linearGradient>
          </defs>
          <rect width='100%' height='100%' fill='url(#g)' />
          <g stroke='#e6edf3' stroke-width='1'>
            ${Array.from({ length: 8 }).map((_, i) => `<line x1='0' y1='${Math.round((i / 8) * svgH)}' x2='${svgW}' y2='${Math.round((i / 8) * svgH)}' />`).join('')}
            ${Array.from({ length: 10 }).map((_, i) => `<line x1='${Math.round((i / 10) * svgW)}' y1='0' x2='${Math.round((i / 10) * svgW)}' y2='${svgH}' />`).join('')}
          </g>
          <g fill='#94a3b8' font-size='12' font-family='Arial,Helvetica,sans-serif'>
            <text x='12' y='20'>Approx. center: ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}</text>
          </g>
        </svg>`
        const b64svg = Buffer.from(svg).toString('base64')
        backgroundImageDataUrls.push(`data:image/svg+xml;base64,${b64svg}`)
        console.log('[Export POST] Using SVG fallback basemap as background')
      } catch (err) {
        console.warn('[Export POST] SVG fallback generation failed:', err)
      }
    }

    // When "All Assets" is selected (no deviceID), prepare per-device AQI data for individual graphs
    let perDeviceAQI: Array<{ deviceID: string; deviceName?: string; readings: any[] }> = []
    if (!deviceID) {
      // Get unique device IDs from raw readings
      const deviceIds = Array.from(new Set(rawReadings.map((r: any) => String(r.deviceID)).filter(Boolean)))
      console.log(`[Export POST] Found ${deviceIds.length} unique devices for individual AQI graphs`)
      
      // Fetch asset names from the assets API
      let assetNamesMap: Record<string, string> = {}
      try {
        const assetsResponse = await fetch(`${BACKEND_BASE_URL}/assets`, { next: { revalidate: 0 } })
        if (assetsResponse.ok) {
          const assetsData = await assetsResponse.json()
          const assets = assetsData?.items || assetsData || []
          // Build a map of deviceID -> asset name
          assets.forEach((asset: any) => {
            const assetDeviceId = String(asset.deviceId || asset.deviceID || asset.id || '')
            if (assetDeviceId && asset.name) {
              assetNamesMap[assetDeviceId] = asset.name
            }
          })
          console.log(`[Export POST] Fetched ${Object.keys(assetNamesMap).length} asset names from API`)
        } else {
          console.warn(`[Export POST] Failed to fetch assets API: ${assetsResponse.status}`)
        }
      } catch (err) {
        console.warn('[Export POST] Error fetching assets for names:', err)
      }
      
      // For each device, fetch aggregated AQI data from the API
      for (const devId of deviceIds) {
        try {
          // Use the same aggregation logic for each device
          const deviceAggregated = aggregateReadings(allReadings, {
            start: fromTs,
            end: toTs,
            binMs,
            maxPerBin: 50,
            deviceID: String(devId),
          })
          
          const devicePoints = deviceAggregated.points
          
          const deviceReadings = devicePoints.map((p: any) => ({
            receivedAt: new Date(p.time).toISOString(),
            airQualityIndex: p.AQI,
            time: p.time,
          }))
          
          // Use asset name from API if available, otherwise fallback to "Asset {id}"
          const assetName = assetNamesMap[String(devId)] || null
          const displayName = assetName ? `${assetName} (DeviceID:${devId})` : `Asset ${devId}`
          
          perDeviceAQI.push({
            deviceID: String(devId),
            deviceName: displayName,
            readings: deviceReadings,
          })
        } catch (err) {
          console.warn(`[Export POST] Error aggregating device ${devId}:`, err)
        }
      }
    }

    // Generate report based on requested format
    let reportData: string | Buffer
    let contentType: string
    let fileExtension: string

    switch (format) {
      case 'pdf':
        reportData = await generatePDFReport({
          readings: aggregatedReadings, // Use aggregated data for PDF charts and stats
          rawReadings: rawReadings, // Pass raw readings for data table
          metrics,
          startDateTime,
          endDateTime,
          includeMap,
          includeCharts,
          // Pass the client snapshots (if any) as `mapImageDataUrls`. Support both single and multiple images.
          mapImageDataUrls: backgroundImageDataUrls.length > 0 ? backgroundImageDataUrls : undefined,
          // Keep legacy single image for backward compatibility
          mapImageDataUrl: backgroundImageDataUrls.length > 0 ? backgroundImageDataUrls[0] : undefined,
          // Pass ticks and domain for proper chart alignment (same as dashboard)
          ticks: labelTicks,
          domain: [fromTs, toTs],
          // Cover page information
          location: location,
          assetName: assetName,
          deviceID: deviceID,
          sensorCount: metrics.length, // Number of metrics being monitored
          // Per-device AQI data for individual graphs (only when All Assets selected)
          perDeviceAQI: perDeviceAQI.length > 0 ? perDeviceAQI : undefined,
          // Multi-asset information
          deviceIDs: targetDeviceIDs.length > 0 ? targetDeviceIDs : undefined,
          assetNames: assetNames,
          assetLocations: assetLocations,
          isMultiAsset: targetDeviceIDs.length > 1,
        })
        contentType = 'application/pdf'
        fileExtension = 'pdf'
        break
      case 'csv':
        reportData = await generateCSVReport({ 
          readings: rawReadings, // Use ALL raw readings for CSV
          metrics, 
          startDateTime, 
          endDateTime,
          // Include asset details for both single and multi-asset exports
          deviceID: deviceID || undefined,
          assetName: assetName || undefined,
          deviceIDs: targetDeviceIDs.length > 0 ? targetDeviceIDs.map(String) : undefined,
          assetNames: assetNames || undefined,
        })
        contentType = 'text/csv'
        fileExtension = 'csv'
        break
      case 'geojson':
        reportData = await generateGeoJSONReport({ 
          readings: rawReadings, // Use raw readings for GeoJSON
          metrics, 
          startDateTime, 
          endDateTime,
          deviceID: deviceID || undefined,
          assetName: assetName || undefined,
          deviceIDs: targetDeviceIDs.length > 0 ? targetDeviceIDs.map(String) : undefined,
          assetNames: assetNames || undefined,
        })
        contentType = 'application/geo+json'
        fileExtension = 'json'
        break
      default:
        return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
    }

    const startStr = new Date(startDateTime).toISOString().split('T')[0]
    const endStr = new Date(endDateTime).toISOString().split('T')[0]
    const filename = `aeropure-report-${startStr}-to-${endStr}.${fileExtension}`

    const responseData = typeof reportData === 'string' ? new TextEncoder().encode(reportData) : new Uint8Array(reportData)

    return new NextResponse(responseData, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error: any) {
    console.error('[Export POST] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to generate report' }, { status: 500 })
  }
}
// trimmed duplicate trailing content (was accidentally duplicated)
