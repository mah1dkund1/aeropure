"use client"
import { useMemo } from "react"
import { useStationData } from "./use-station-data"
import { useAssets } from "./use-assets"
import type { AssetMarker } from "@/lib/iot-types"
import {
  calculateRadius,
  calculateElongation,
  generateDeviceHeatZone,
  generateOverlapGradient,
  detectOverlappingDevices,
  aqiToColor,
  type HeatPoint,
  type DeviceHeatZone
} from "@/lib/heatmap-utils"
import { 
  USE_DUMMY_HEAT_DATA, 
  DUMMY_STATION_READINGS, 
  DUMMY_HEAT_ASSETS 
} from "@/lib/dummy-heat-data"


export type DeviceWithReading = {
  deviceId: number
  lat: number
  lng: number
  aqi: number
  windSpeed: number
  windDir: number
  color: string
  radius: number
}

/**
 * Hook to generate dynamic heat map data based on real-time device readings
 * Includes wind-adaptive shapes and overlapping pollution zones
 */
export function useHeatmapGenerator() {
  const { readings, isLoading: isLoadingReadings } = useStationData(100)
  const { assets, isLoading: isLoadingAssets } = useAssets()

  // Use dummy data if enabled for testing, otherwise use real data
  const activeReadings = USE_DUMMY_HEAT_DATA ? DUMMY_STATION_READINGS : readings
  const activeAssets = USE_DUMMY_HEAT_DATA ? DUMMY_HEAT_ASSETS : assets

  // Combine device readings with their locations from assets
  const devicesWithReadings = useMemo<DeviceWithReading[]>(() => {
       if (!activeReadings.length || !activeAssets.length) return []


    const deviceMap = new Map<number, DeviceWithReading>()

    // Get the latest reading for each device
        activeReadings.forEach((reading) => {

      const deviceId = Number(reading.deviceID)
      const asset = activeAssets.find((a) => Number(a.deviceId) === deviceId)


      if (!asset || !reading.airQualityIndex) return

      const aqi = Number(reading.airQualityIndex)
      const windSpeed = Number(reading.windSpeed ?? 0)
      const windDir = Number(reading.windDir ?? 0)

      // Only add if we don't have this device yet or this reading is newer
      const existing = deviceMap.get(deviceId)
      const readingTime = new Date(reading.receivedAt).getTime()
      const existingTime = existing ? new Date(activeReadings.find(r => Number(r.deviceID) === deviceId)?.receivedAt || 0).getTime() : 0

      if (!existing || readingTime > existingTime) {
        deviceMap.set(deviceId, {
          deviceId,
          lat: asset.lat,
          lng: asset.lng,
          aqi,
          windSpeed,
          windDir,
          color: aqiToColor(aqi),
          radius: calculateRadius(aqi)
        })
      }
    })

    return Array.from(deviceMap.values())
  }, [activeReadings, activeAssets])


  // Generate heat map points for all devices
  const { heatmapPoints, heatmapPointsByBucket } = useMemo(() => {
    if (!devicesWithReadings.length) return { heatmapPoints: [], heatmapPointsByBucket: { green: [], yellow: [], orange: [], red: [] } }

    // AQI bucket classifier
    const bucketOf = (aqi: number): "green" | "yellow" | "orange" | "red" => {
      if (aqi <= 50) return "green"
      if (aqi <= 100) return "yellow"
      if (aqi <= 150) return "orange"
      return "red"
    }

    const allPoints: HeatPoint[] = []
    const byBucket: { green: HeatPoint[]; yellow: HeatPoint[]; orange: HeatPoint[]; red: HeatPoint[] } = {
      green: [], yellow: [], orange: [], red: []
    }

    // Generate heat zone for each device and group by its AQI bucket
    devicesWithReadings.forEach((device) => {
      const zonePoints = generateDeviceHeatZone(
        device.lat,
        device.lng,
        device.radius,
        device.aqi,
        device.windSpeed,
        device.windDir,
        4 // fewer rings for performance
      )
      allPoints.push(...zonePoints)

      const b = bucketOf(device.aqi)
      byBucket[b].push(...zonePoints)
    })

    // Detect and generate overlapping zones
    const overlaps = detectOverlappingDevices(devicesWithReadings, 0.5) // 500m

    overlaps.forEach(([idx1, idx2]) => {
      const device1 = devicesWithReadings[idx1]
      const device2 = devicesWithReadings[idx2]

      // Generate overlap interpolation points (weight only)
      const overlapPoints = generateOverlapGradient(
        { lat: device1.lat, lng: device1.lng, aqi: device1.aqi },
        { lat: device2.lat, lng: device2.lng, aqi: device2.aqi },
        9 // fewer interpolation steps for performance
      )
      allPoints.push(...overlapPoints)

      // Push overlap points into BOTH buckets to create a visual blend between devices
      const b1 = bucketOf(device1.aqi)
      const b2 = bucketOf(device2.aqi)
      if (b1 === b2) {
        byBucket[b1].push(...overlapPoints)
      } else {
        // Slightly reduce weight when duplicating to avoid over-saturation
        const half1 = overlapPoints.map(p => ({ location: p.location, weight: p.weight * 0.7 }))
        const half2 = overlapPoints.map(p => ({ location: p.location, weight: p.weight * 0.7 }))
        byBucket[b1].push(...half1)
        byBucket[b2].push(...half2)
      }
    })

    return { heatmapPoints: allPoints, heatmapPointsByBucket: byBucket }
  }, [devicesWithReadings])

  // Generate heat zones metadata for debugging/visualization
  const heatZones = useMemo<DeviceHeatZone[]>(() => {
    return devicesWithReadings.map((device) => ({
      deviceId: device.deviceId,
      lat: device.lat,
      lng: device.lng,
      aqi: device.aqi,
      windSpeed: device.windSpeed,
      windDir: device.windDir,
      radius: device.radius,
      points: generateDeviceHeatZone(
        device.lat,
        device.lng,
        device.radius,
        device.aqi,
        device.windSpeed,
        device.windDir,
        5
      )
    }))
  }, [devicesWithReadings])

  return {
    heatmapPoints,
    heatmapPointsByBucket,
    heatZones,
    devicesWithReadings,
    overlappingPairs: useMemo(
      () => detectOverlappingDevices(devicesWithReadings, 0.5),
      [devicesWithReadings]
    ),
    isLoading: isLoadingReadings || isLoadingAssets,
    hasData: heatmapPoints.length > 0
  }
}
