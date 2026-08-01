/**
 * Heat Map Utilities
 * Mathematical functions for generating dynamic, wind-adaptive heat maps
 */

export type HeatPoint = {
  location: { lat: number; lng: number }
  weight: number
}

export type DeviceHeatZone = {
  deviceId: number
  lat: number
  lng: number
  aqi: number
  windSpeed: number
  windDir: number
  radius: number
  points: HeatPoint[]
}

/**
 * Convert AQI value to heat map weight
 * AQI range: 0-500+ → Weight range: 0.1-5.0
 */
export function aqiToWeight(aqi: number): number {
  const normalizedAqi = Math.min(Math.max(aqi, 0), 500)
  return 0.1 + (normalizedAqi / 500) * 4.9
}

/**
 * Get color based on AQI value (aligned with dashboard criteria)
 */
export function aqiToColor(aqi: number): string {
  if (aqi <= 50) return '#22c55e'      // Green - Good
  if (aqi <= 100) return '#f59e0b'     // Amber - Moderate
  if (aqi <= 150) return '#fb923c'     // Orange - Poor
  return '#ef4444'                      // Red - Unhealthy
}

/**
 * Calculate dynamic radius based on AQI level
 * Higher AQI = larger pollution spread radius
 */
export function calculateRadius(aqi: number): number {
  const MIN_RADIUS = 50   // meters (minimum spread)
  const MAX_RADIUS = 500  // meters (maximum spread)
  const normalizedAqi = Math.min(aqi, 300) / 300
  return MIN_RADIUS + (normalizedAqi * (MAX_RADIUS - MIN_RADIUS))
}

/**
 * Calculate ellipse elongation factor based on wind speed
 * Low wind = circular, high wind = elongated oval
 */
export function calculateElongation(windSpeed: number): number {
  if (windSpeed < 2) return 1.0       // Circular (calm)
  if (windSpeed < 5) return 1.5       // Slight oval (light breeze)
  if (windSpeed < 10) return 2.5      // Moderate oval (moderate wind)
  return Math.min(4.0, 1.5 + windSpeed / 5) // Strong oval (strong wind)
}

/**
 * Convert meters to latitude degrees
 */
export function metersToLatDegrees(meters: number): number {
  return meters / 111320
}

/**
 * Convert meters to longitude degrees at given latitude
 */
export function metersToLngDegrees(meters: number, latitude: number): number {
  return meters / (111320 * Math.cos((latitude * Math.PI) / 180))
}

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in kilometers
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371 // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Wind bearing helpers
 * The API commonly reports wind direction as "from" (meteorological): 0 = North, 90 = East.
 * For plotting pollutant dispersion we need the "to" bearing (where the wind is going):
 *   toBearing = (fromBearing + 180) % 360
 * Additionally, many map math routines expect an angle where 0 points East and positive angles
 * rotate toward North (so that dx = cos(angle)*dist, dy = sin(angle)*dist). The helper below
 * converts a "to" bearing (0=North,90=East) into that math-friendly radian angle.
 */
export function windFromToToDeg(windFromDeg: number): number {
  return ((windFromDeg % 360) + 360 + 180) % 360
}

export function bearingToAngleRad(bearingToDeg: number): number {
  // Convert navigation bearing (0=North, 90=East) to radian used by x=cos, y=sin math:
  // angleRad = (90 - bearing) * PI/180
  return ((90 - bearingToDeg) * Math.PI) / 180
}

/**
 * Generate elliptical heat points around a device
 * Pollution spreads IN the wind direction (narrow at device, widening downwind)
 * 
 * @param centerLat - Device latitude
 * @param centerLng - Device longitude
 * @param majorAxis - Major axis length in meters (wind-direction axis)
 * @param minorAxis - Minor axis length in meters (perpendicular axis)
 * @param windDir - Wind direction in degrees (0=North, 90=East, etc.)
 * @param weight - Heat map weight for these points
 * @param steps - Number of points to generate around ellipse
 */
export function generateEllipsePoints(
  centerLat: number,
  centerLng: number,
  majorAxis: number,
  minorAxis: number,
  windDir: number,
  weight: number,
  steps: number = 32
): HeatPoint[] {
  const points: HeatPoint[] = []
  
  // The API reports windDir as meteorological "from" degrees (0=North,90=East).
  // Convert to "to" bearing (where wind is going) and then to the math angle used
  // by our coordinate conversions (angle where 0 points East and increasing angles
  // rotate toward North so dx = cos(angle)*dist, dy = sin(angle)*dist).
  const toBearing = windFromToToDeg(windDir)
  // Invert orientation so elongated axis points opposite to wind arrow
  const oppositeBearing = (toBearing + 180) % 360
  const orientationRad = bearingToAngleRad(oppositeBearing)
  
  // Generate points around the ellipse
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    
    // Parametric ellipse equation
    const x = majorAxis * Math.cos(angle)
    const y = minorAxis * Math.sin(angle)
    
  // Rotate by orientation angle (math angle where x=cos, y=sin)
  const xRotated = x * Math.cos(orientationRad) - y * Math.sin(orientationRad)
  const yRotated = x * Math.sin(orientationRad) + y * Math.cos(orientationRad)
    
    // Convert meters to lat/lng offsets
    const latOffset = metersToLatDegrees(yRotated)
    const lngOffset = metersToLngDegrees(xRotated, centerLat)
    
    points.push({
      location: { lat: centerLat + latOffset, lng: centerLng + lngOffset },
      weight: weight
    })
  }
  
  return points
}

/**
 * Generate concentric rings of points for device heat zone
 * For high wind: Creates directional plume extending from device
 * For low wind: Creates circular/elliptical area around device
 */
export function generateDeviceHeatZone(
  centerLat: number,
  centerLng: number,
  baseRadius: number,
  aqi: number,
  windSpeed: number,
  windDir: number,
  rings: number = 5
): HeatPoint[] {
  const points: HeatPoint[] = []
  const elongation = calculateElongation(windSpeed)
  const baseWeight = aqiToWeight(aqi)
  
  // High wind (>6 m/s): Create directional plume extending from device
  if (windSpeed > 6) {
    // Convert from "from" bearing to "to" and then invert so plume
    // extends opposite to the displayed wind arrow direction.
    const toBearing = windFromToToDeg(windDir)
    const oppositeToBearing = (toBearing + 180) % 360
    const windDirRad = bearingToAngleRad(oppositeToBearing)

    // Generate plume extending opposite to wind direction (relative to arrow)
    for (let segment = 0; segment <= rings; segment++) {
      const distanceFraction = segment / rings
      
      // Distance from device (0 to baseRadius * elongation)
      const distance = baseRadius * elongation * distanceFraction
      
      // Width increases with distance (narrow at device, wider downwind)
      const plumeWidth = baseRadius * (0.3 + 0.7 * distanceFraction)
      
  // Weight decreases with distance; keep edges much lighter to avoid map-wide saturation
  const distanceFalloff = Math.exp(-2 * distanceFraction * distanceFraction)
  const segmentWeight = baseWeight * (0.1 + 0.9 * distanceFalloff)
      
      // Center point of this segment
  // Using math angle: dx = cos(rad)*dist (east), dy = sin(rad)*dist (north)
  const segmentLatOffset = metersToLatDegrees(distance * Math.sin(windDirRad))
  const segmentLngOffset = metersToLngDegrees(distance * Math.cos(windDirRad), centerLat)
      const segmentLat = centerLat + segmentLatOffset
      const segmentLng = centerLng + segmentLngOffset
      
  // Generate points across the width of the plume at this distance (reduced for performance)
  const pointsAcrossWidth = Math.max(4, Math.floor(6 * (1 + distanceFraction)))
      
      for (let w = 0; w < pointsAcrossWidth; w++) {
        const widthFraction = (w / (pointsAcrossWidth - 1)) - 0.5 // -0.5 to 0.5
        const perpDist = plumeWidth * widthFraction
        
        // Perpendicular to wind direction
  // Perpendicular offsets: rotate by +90deg (math angle + PI/2)
  const perpLatOffset = metersToLatDegrees(perpDist * Math.cos(windDirRad))
  const perpLngOffset = metersToLngDegrees(-perpDist * Math.sin(windDirRad), centerLat)
        
        // Weight decreases from center to edges of plume
        const edgeFalloff = Math.exp(-8 * widthFraction * widthFraction)
        const pointWeight = segmentWeight * edgeFalloff
        
        points.push({
          location: {
            lat: segmentLat + perpLatOffset,
            lng: segmentLng + perpLngOffset
          },
          weight: pointWeight
        })
      }
    }
    
    // Add concentrated source point at device
    points.push({
      location: { lat: centerLat, lng: centerLng },
      weight: baseWeight * 1.5 // Strong source
    })
    
  } else {
    // Low wind: Generate concentric rings (original behavior)
    for (let ring = 0; ring <= rings; ring++) {
      const radiusFraction = ring / rings
      const currentRadius = baseRadius * radiusFraction
      const majorAxis = currentRadius * elongation
      const minorAxis = currentRadius
      
  // Weight decreases from center (stronger) to edge (weaker)
  const distanceFalloff = Math.exp(-2 * radiusFraction * radiusFraction)
  const ringWeight = baseWeight * (0.1 + 0.9 * distanceFalloff)
      
  // Fewer points for performance; still increase slightly toward outer rings
  const pointsInRing = Math.max(8, Math.floor(12 + ring * 3))
      
      const ringPoints = generateEllipsePoints(
        centerLat,
        centerLng,
        majorAxis,
        minorAxis,
        windDir,
        ringWeight,
        pointsInRing
      )
      
      points.push(...ringPoints)
    }
    
    // Add center point with maximum weight
    points.push({
      location: { lat: centerLat, lng: centerLng },
      weight: baseWeight * 1.2
    })
  }
  
  return points
}

/**
 * Generate interpolated points between two devices for overlapping zones
 * Creates smooth gradient transition from device A to device B
 */
export function generateOverlapGradient(
  device1: { lat: number; lng: number; aqi: number },
  device2: { lat: number; lng: number; aqi: number },
  steps: number = 15
): HeatPoint[] {
  const points: HeatPoint[] = []
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps // Interpolation parameter [0, 1]
    
    // Linear interpolation of position
    const lat = device1.lat + (device2.lat - device1.lat) * t
    const lng = device1.lng + (device2.lng - device1.lng) * t
    
    // Smooth interpolation of AQI using cosine interpolation for smoother transition
    const smoothT = (1 - Math.cos(t * Math.PI)) / 2
  const aqi = device1.aqi + (device2.aqi - device1.aqi) * smoothT
  // Reduce overlap contribution so it blends without flooding the map
  const weight = aqiToWeight(aqi) * 0.6
    
    // Add some width to the gradient path
    points.push({
      location: { lat, lng },
      weight: weight
    })
    
    // Add perpendicular points for width (creates a band rather than a line)
    if (i > 0 && i < steps) {
      const perpOffset = 0.0005 // Small perpendicular offset
      const angle = Math.atan2(device2.lng - device1.lng, device2.lat - device1.lat)
      const perpAngle = angle + Math.PI / 2
      
      const latOffset = Math.cos(perpAngle) * perpOffset
      const lngOffset = Math.sin(perpAngle) * perpOffset
      
      points.push({
        location: { lat: lat + latOffset, lng: lng + lngOffset },
        weight: weight * 0.7
      })
      points.push({
        location: { lat: lat - latOffset, lng: lng - lngOffset },
        weight: weight * 0.7
      })
    }
  }
  
  return points
}

/**
 * Detect device pairs that are within overlap distance
 * Returns pairs of device indices that should have gradient connections
 */
export function detectOverlappingDevices(
  devices: Array<{ lat: number; lng: number }>,
  maxDistanceKm: number = 0.5 // 500 meters default
): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  
  for (let i = 0; i < devices.length; i++) {
    for (let j = i + 1; j < devices.length; j++) {
      const distance = haversineDistance(
        devices[i].lat,
        devices[i].lng,
        devices[j].lat,
        devices[j].lng
      )
      
      if (distance <= maxDistanceKm) {
        pairs.push([i, j])
      }
    }
  }
  
  return pairs
}

/**
 * Get AQI category information
 */
export function getAqiCategory(aqi: number): {
  level: string
  color: string
  description: string
} {
  if (aqi <= 50) {
    return {
      level: 'Good',
      color: '#22c55e',
      description: 'Air quality is satisfactory'
    }
  }
  if (aqi <= 100) {
    return {
      level: 'Moderate',
      color: '#f59e0b',
      description: 'Air quality is acceptable'
    }
  }
  if (aqi <= 150) {
    return {
      level: 'Unhealthy for Sensitive Groups',
      color: '#fb923c',
      description: 'Sensitive groups may experience health effects'
    }
  }
  if (aqi <= 200) {
    return {
      level: 'Unhealthy',
      color: '#ef4444',
      description: 'Everyone may begin to experience health effects'
    }
  }
  if (aqi <= 300) {
    return {
      level: 'Very Unhealthy',
      color: '#a855f7',
      description: 'Health alert: everyone may experience serious effects'
    }
  }
  return {
    level: 'Hazardous',
    color: '#7f1d1d',
    description: 'Health warning of emergency conditions'
  }
}
