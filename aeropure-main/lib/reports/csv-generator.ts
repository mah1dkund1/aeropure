type Reading = {
  receivedAt: string
  airQualityIndex?: number
  valuePM_2_5?: number
  valuePM_10?: number
  valueCO?: number
  valueNO2?: number
  valueO3?: number
  valueSO2?: number
  airTemperature?: number
  airHumidity?: number
  atmosPressure?: number
  deviceID?: number | string
  readingCount?: number
  windDir?: number
  windSpeed?: number
}

type CSVReportOptions = {
  readings: Reading[]
  metrics: string[]
  startDateTime: string
  endDateTime: string
  // Single-asset context
  deviceID?: string
  assetName?: string
  // Multi-asset context
  deviceIDs?: string[]
  assetNames?: string[]
}

export async function generateCSVReport(options: CSVReportOptions): Promise<string> {
  const { readings, metrics, startDateTime, endDateTime, deviceID, assetName, deviceIDs, assetNames } = options

  // Define all possible columns
  const columnMap: Record<string, keyof Reading> = {
    AQI: "airQualityIndex",
    PM2_5: "valuePM_2_5",
    PM10: "valuePM_10",
    CO: "valueCO",
    NO2: "valueNO2",
    O3: "valueO3",
    SO2: "valueSO2",
    Temperature: "airTemperature",
    Humidity: "airHumidity",
    Pressure: "atmosPressure",
  }

  // Detect if wind fields exist in any reading so we can include columns dynamically
  const hasWindDir = readings.some(r => r.windDir !== undefined && r.windDir !== null)
  const hasWindSpeed = readings.some(r => r.windSpeed !== undefined && r.windSpeed !== null)

  // Build CSV header
  const headers = ["Timestamp", "Device ID", ...metrics.map((p) => {
    if (p === "PM2_5") return "PM2.5 (µg/m³)"
    if (p === "PM10") return "PM10 (µg/m³)"
    if (p === "CO") return "CO (mg/m³)"
    if (p === "NO2") return "NO2 (µg/m³)"
    if (p === "O3") return "O3 (µg/m³)"
    if (p === "SO2") return "SO2 (µg/m³)"
    if (p === "AQI") return "Air Quality Index"
    if (p === "Temperature") return "Temperature (°C)"
    if (p === "Humidity") return "Humidity (%)"
    if (p === "Pressure") return "Pressure (hPa)"
    return p
  })]
  // Append wind headers when present in data
  if (hasWindDir) headers.push('Wind Direction (°)')
  if (hasWindSpeed) headers.push('Wind Speed (m/s)')

  // Build CSV rows
  const rows = readings.map((reading) => {
    const row = [
      new Date(reading.receivedAt).toLocaleString('en-US', { 
        timeZone: 'Asia/Karachi', 
        hour12: true,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      reading.deviceID?.toString() || "N/A",
    ]

    metrics.forEach((metric) => {
      const key = columnMap[metric]
      const value = key ? reading[key] : undefined
      row.push(value !== undefined && value !== null ? value.toString() : "N/A")
    })

    // Append wind fields if present
    if (hasWindDir) {
      row.push(reading.windDir !== undefined && reading.windDir !== null ? reading.windDir.toString() : 'N/A')
    }
    if (hasWindSpeed) {
      row.push(reading.windSpeed !== undefined && reading.windSpeed !== null ? reading.windSpeed.toString() : 'N/A')
    }

    return row
  })

  // Combine into CSV string
  const csvLines = [
    `# Aeropure Air Quality Report`,
    `# Date Range: ${new Date(startDateTime).toLocaleString('en-US', { timeZone: 'Asia/Karachi', hour12: true })} - ${new Date(endDateTime).toLocaleString('en-US', { timeZone: 'Asia/Karachi', hour12: true })}`,
    `# Generated: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi', hour12: true })}`,
    `# Total Readings: ${readings.length}`,
    (() => {
      // Add asset details header for single or multi-asset exports
      if (deviceIDs && deviceIDs.length > 0) {
        const pairs: string[] = deviceIDs.map((id, idx) => {
          const name = assetNames && assetNames[idx] ? assetNames[idx] : `Asset ${id}`
          return `${name} (DeviceID:${id})`
        })
        return `# Assets: ${pairs.join('; ')}`
      }
      if (deviceID) {
        const name = assetName || `Asset ${deviceID}`
        return `# Asset: ${name} (DeviceID:${deviceID})`
      }
      return `# Assets: All`
    })(),
    readings.length === 0 ? `# Note: No readings found in the selected date range. Try a different date range or check if data is available.` : ``,
    ``,
    headers.join(","),
    ...rows.map((row) => row.map((cell) => {
      // Escape cells that contain commas or quotes
      if (typeof cell === "string" && (cell.includes(",") || cell.includes('"'))) {
        return `"${cell.replace(/"/g, '""')}"`
      }
      return cell
    }).join(",")),
  ]

  const csvContent = csvLines.join("\n")
  return csvContent
}
