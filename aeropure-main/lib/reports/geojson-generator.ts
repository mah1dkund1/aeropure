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
  latitude?: number
  longitude?: number
  readingCount?: number
}

type GeoJSONReportOptions = {
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

export async function generateGeoJSONReport(options: GeoJSONReportOptions): Promise<string> {
  const { readings, metrics, startDateTime, endDateTime, deviceID, assetName, deviceIDs, assetNames } = options

  // Build a simple deviceID -> assetName mapping from inputs
  const nameMap = new Map<string, string>()
  if (deviceIDs && deviceIDs.length > 0) {
    deviceIDs.forEach((id, idx) => {
      const name = assetNames && assetNames[idx] ? assetNames[idx] : `Asset ${id}`
      nameMap.set(String(id), name)
    })
  } else if (deviceID) {
    nameMap.set(String(deviceID), assetName || `Asset ${deviceID}`)
  }

  // Group readings by device and calculate averages
  const deviceMap = new Map<string, {
    readings: Reading[]
    lat?: number
    lng?: number
  }>()

  readings.forEach((reading) => {
    const deviceId = reading.deviceID?.toString() || "unknown"
    if (!deviceMap.has(deviceId)) {
      deviceMap.set(deviceId, {
        readings: [],
        lat: reading.latitude,
        lng: reading.longitude,
      })
    }
    deviceMap.get(deviceId)!.readings.push(reading)
  })

  // Demo coordinates for devices without location data
  const demoCoordinates = [
    { lat: 33.6844, lng: 73.0479 }, // Islamabad
    { lat: 33.7077, lng: 73.0533 }, // Near F-6
    { lat: 33.6973, lng: 73.0614 }, // Near F-7
    { lat: 33.7294, lng: 73.0931 }, // Near G-11
    { lat: 33.6507, lng: 73.1617 }, // Near H-13
  ]

  // Build GeoJSON features
  const features = Array.from(deviceMap.entries()).map(([deviceId, data], index) => {
    const { readings: deviceReadings, lat, lng } = data
    
    // Use actual coordinates if available, otherwise use demo coordinates
    const coordinates = lat !== undefined && lng !== undefined
      ? [lng, lat]
      : [
          demoCoordinates[index % demoCoordinates.length].lng,
          demoCoordinates[index % demoCoordinates.length].lat,
        ]

    // Calculate averages for selected metrics
    const properties: Record<string, any> = {
      deviceId,
      assetName: nameMap.get(deviceId) || undefined,
      readingsCount: deviceReadings.length,
      startDate: startDateTime,
      endDate: endDateTime,
    }

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

    metrics.forEach((metric) => {
      const key = columnMap[metric]
      if (key) {
        const values = deviceReadings
          .map((r) => Number(r[key]))
          .filter((v) => !isNaN(v) && v !== null && v !== undefined)
        
        if (values.length > 0) {
          const avg = values.reduce((a, b) => a + b, 0) / values.length
          const min = Math.min(...values)
          const max = Math.max(...values)
          
          properties[`${metric}_avg`] = Math.round(avg * 100) / 100
          properties[`${metric}_min`] = Math.round(min * 100) / 100
          properties[`${metric}_max`] = Math.round(max * 100) / 100
        }
      }
    })

    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates,
      },
      properties,
    }
  })

  const geoJSON = {
    type: "FeatureCollection",
    metadata: {
      title: "Aeropure Air Quality Report",
      description: "Geographic distribution of air quality measurements",
      dateRange: {
        start: new Date(startDateTime).toLocaleString('en-US', { timeZone: 'Asia/Karachi', hour12: true }),
        end: new Date(endDateTime).toLocaleString('en-US', { timeZone: 'Asia/Karachi', hour12: true }),
      },
      generated: new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi', hour12: true }),
      totalReadings: readings.length,
      totalDevices: deviceMap.size,
      metrics,
      assets: (() => {
        if (deviceIDs && deviceIDs.length > 0) {
          return deviceIDs.map((id, idx) => ({
            deviceID: String(id),
            assetName: (assetNames && assetNames[idx]) ? assetNames[idx] : `Asset ${id}`,
          }))
        }
        if (deviceID) {
          return [{ deviceID: String(deviceID), assetName: assetName || `Asset ${deviceID}` }]
        }
        // If unknown, summarize from features
        return Array.from(new Set(features.map(f => (f.properties as any).deviceId))).map(id => ({
          deviceID: String(id),
          assetName: nameMap.get(String(id)) || undefined,
        }))
      })(),
    },
    features,
  }

  return JSON.stringify(geoJSON, null, 2)
}
