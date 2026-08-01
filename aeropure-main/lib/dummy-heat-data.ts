/**
 * Dummy heat map test data
 * Used for testing heat map functionality with multiple devices and overlapping zones
 */

import type { StationReading } from "@/components/iot/use-station-data"
import type { AssetMarker } from "@/lib/iot-types"

/**
 * Test station readings with varied AQI levels and wind conditions
 * Based on real device locations from the system
 */
export const DUMMY_STATION_READINGS: StationReading[] = [
  // Device 1: Test Tower 09 - Islamabad
  {
    _id: "68fa131b8d40801558e68145",
    deviceID: 1,
    receivedAt: new Date().toISOString(),
    airHumidity: 45.35,
    airQualityIndex: 125, // Unhealthy for Sensitive - Orange
    airTemperature: 25.89,
    atmosPressure: 953.5,
    rainfall: 0.0,
    valueCO: 3200,
    valueNO2: 35,
    valueO3: 42,
    valuePM_10: 85,
    valuePM_2_5: 68,
    valueSO2: 70,
    versionNo: "V1.0",
    windDir: 135.0, // SE wind
    windSpeed: 9  // HIGH WIND - Strong elongated oval extending SE
  },
  
  // Device 2: Clock Tower - Islamabad F10
  {
    _id: "68f8c3b68d40801558e67b99",
    deviceID: 2,
    receivedAt: new Date().toISOString(),
    airHumidity: 48.2,
    airQualityIndex: 30, // Unhealthy - Red
    airTemperature: 26.5,
    atmosPressure: 952.8,
    rainfall: 0.0,
    valueCO: 3600,
    valueNO2: 45,
    valueO3: 52,
    valuePM_10: 110,
    valuePM_2_5: 88,
    valueSO2: 82,
    versionNo: "V1.0",
    windDir: 140.0, // SE wind
    windSpeed: 3.2  // Light breeze - oval shape
  },
  
  // Device 3: Smog Remover - Lahore EME
  {
    _id: "68f740454ef88e5eba2c9115",
    deviceID: 3,
    receivedAt: new Date().toISOString(),
    airHumidity: 52.1,
    airQualityIndex: 195, // Unhealthy - Red
    airTemperature: 28.8,
    atmosPressure: 951.2,
    rainfall: 0.0,
    valueCO: 4200,
    valueNO2: 58,
    valueO3: 65,
    valuePM_10: 135,
    valuePM_2_5: 105,
    valueSO2: 95,
    versionNo: "V1.0",
    windDir: 199, 
    windSpeed: 8.5  // Strong wind - elongated oval
  },
  
  // Device 4: Iron Tower - Islamabad E11
  {
    _id: "68f73f624ef88e5eba2c9114",
    deviceID: 4,
    receivedAt: new Date().toISOString(),
    airHumidity: 242.8,
    airQualityIndex: 98, // Moderate - Yellow
    airTemperature: 25.2,
    atmosPressure: 954.0,
    rainfall: 0.0,
    valueCO: 2800,
    valueNO2: 28,
    valueO3: 35,
    valuePM_10: 72,
    valuePM_2_5: 58,
    valueSO2: 55,
    versionNo: "V1.0",
    windDir: 120.0, // ESE wind
    windSpeed: 9.8  // Light breeze
  },
  
  // Device 5: PF ESP - Islamabad FAST
  {
    _id: "68f736b84ef88e5eba2c9113",
    deviceID: 5,
    receivedAt: new Date().toISOString(),
    airHumidity: 40.5,
    airQualityIndex: 30, // Moderate - Yellow
    airTemperature: 24.5,
    atmosPressure: 955.2,
    rainfall: 0.0,
    valueCO: 2400,
    valueNO2: 22,
    valueO3: 30,
    valuePM_10: 62,
    valuePM_2_5: 48,
    valueSO2: 45,
    versionNo: "V1.0",
    windDir: 110.0, // ESE wind
    windSpeed: 2.1  // Light breeze
  },
  
  // Device 6: Smog Tower - Nust Islamabad
  {
    _id: "68f729fd4ef88e5eba2c9112",
    deviceID: 6,
    receivedAt: new Date().toISOString(),
    airHumidity: 43.8,
    airQualityIndex: 88, // Moderate - Yellow
    airTemperature: 25.8,
    atmosPressure: 953.8,
    rainfall: 0.0,
    valueCO: 2650,
    valueNO2: 25,
    valueO3: 32,
    valuePM_10: 68,
    valuePM_2_5: 52,
    valueSO2: 50,
    versionNo: "V1.0",
    windDir: 270.0, // W wind (West direction)
    windSpeed: 13.2  // HIGH WIND - Strong elongated oval extending West
  },

  // ADDITIONAL Device 7: Near FAST (within 500m of Device 5)
  {
    _id: "test-nearby-001",
    deviceID: 7,
    receivedAt: new Date().toISOString(),
    airHumidity: 41.2,
    airQualityIndex: 142, // Unhealthy for Sensitive - Orange
    airTemperature: 25.2,
    atmosPressure: 954.5,
    rainfall: 0.0,
    valueCO: 3300,
    valueNO2: 38,
    valueO3: 45,
    valuePM_10: 92,
    valuePM_2_5: 72,
    valueSO2: 68,
    versionNo: "V1.0",
    windDir: 115.0, // ESE wind
    windSpeed: 2.8  // Light breeze - OVERLAP TEST with Device 5
  },

  // ADDITIONAL Device 8: Near Nust (within 500m of Device 6)
  {
    _id: "test-nearby-002",
    deviceID: 8,
    receivedAt: new Date().toISOString(),
    airHumidity: 44.5,
    airQualityIndex: 118, // Unhealthy for Sensitive - Orange
    airTemperature: 26.1,
    atmosPressure: 953.2,
    rainfall: 0.0,
    valueCO: 3100,
    valueNO2: 32,
    valueO3: 40,
    valuePM_10: 80,
    valuePM_2_5: 65,
    valueSO2: 62,
    versionNo: "V1.0",
    windDir: 125.0, // SE wind
    windSpeed: 1.8  // Light breeze - OVERLAP TEST with Device 6
  }
]

/**
 * Test assets with locations matching the station readings
 * Based on real device locations with 2 additional nearby devices for overlap testing
 */
export const DUMMY_HEAT_ASSETS: AssetMarker[] = [
  // Device 1: Test Tower 09 - Islamabad
  {
    id: "68fa131b8d40801558e68145",
    name: "test tower09",
    lat: 32.123456,
    lng: 73.123456,
    location: "Islamabad, Islamabad",
    type: "test type",
    efficiency: "34",
    status: "online",
    deviceId: 1
  },
  
  // Device 2: Clock Tower - Islamabad F10
  {
    id: "68f8c3b68d40801558e67b99",
    name: "Clock Tower",
    lat: 33.6400,
    lng: 75.0000,
    location: "Islamabad, F10",
    type: "Tower",
    efficiency: "79",
    status: "online",
    deviceId: 2
  },
  
  // Device 3: Smog Remover - Lahore EME
  {
    id: "68f740454ef88e5eba2c9115",
    name: "Smog Remover",
    lat: 31.4392,
    lng: 74.2106,
    location: "Lahore, EME",
    type: "ESP",
    efficiency: "40",
    status: "online",
    deviceId: 3
  },
  
  // Device 4: Iron Tower - Islamabad E11
  {
    id: "68f73f624ef88e5eba2c9114",
    name: "Iron Tower",
    lat: 33.6992,
    lng: 72.9744,
    location: "Islamabad, E11",
    type: "Tower",
    efficiency: "70",
    status: "online",
    deviceId: 4
  },
  
  // Device 5: PF ESP - Islamabad FAST
  {
    id: "68f736b84ef88e5eba2c9113",
    name: "PF ESP",
    lat: 33.6565,
    lng: 73.0154,
    location: "Islamabad, Fast",
    type: "ESP",
    efficiency: "88",
    status: "online",
    deviceId: 5
  },
  
  // Device 6: Smog Tower - Nust Islamabad
  {
    id: "68f729fd4ef88e5eba2c9112",
    name: "Smog Tower",
    lat: 33.6442,
    lng: 72.9922,
    location: "Nust, Islamabad",
    type: "Tower",
    efficiency: "85",
    status: "online",
    deviceId: 6
  },

  // ADDITIONAL Device 7: Air Purifier Alpha - Near FAST (within 500m of Device 5 for OVERLAP TEST)
  {
    id: "test-nearby-001",
    name: "Air Purifier Alpha",
    lat: 33.6590,    // ~280m north of FAST - WILL OVERLAP with Device 5
    lng: 73.0162,
    location: "Near FAST, Islamabad",
    type: "Air Purifier",
    efficiency: "82",
    status: "online",
    deviceId: 7
  },

  // ADDITIONAL Device 8: Smog Filter Beta - Near Nust (within 500m of Device 6 for OVERLAP TEST)
  {
    id: "test-nearby-002",
    name: "Smog Filter Beta",
    lat: 33.6468,    // ~290m northeast of Nust - WILL OVERLAP with Device 6
    lng: 72.9950,
    location: "Near Nust, Islamabad",
    type: "Smog Filter",
    efficiency: "75",
    status: "online",
    deviceId: 8
  }
]

/**
 * Test configuration summary
 */
export const DUMMY_DATA_INFO = {
  totalDevices: 8,
  realDevices: 6,
  additionalTestDevices: 2,
  clusters: {
    islamabad: {
      count: 6, // Includes 4 original + 2 nearby test devices
      devices: [
        { id: 1, name: "test tower09", lat: 32.123456, lng: 73.123456, aqi: 125, color: "Orange", wind: "11.5 m/s SE", note: "HIGH WIND - Elongated oval extending SE" },
        { id: 2, name: "Clock Tower", lat: 33.6400, lng: 75.0000, aqi: 165, color: "Red" },
        { id: 4, name: "Iron Tower", lat: 33.6992, lng: 72.9744, aqi: 98, color: "Yellow" },
        { id: 5, name: "PF ESP", lat: 33.6565, lng: 73.0154, aqi: 78, color: "Yellow" },
        { id: 6, name: "Smog Tower", lat: 33.6442, lng: 72.9922, aqi: 88, color: "Yellow", wind: "13.2 m/s W", note: "HIGH WIND - Elongated oval extending West" },
        { id: 7, name: "Air Purifier Alpha (NEAR FAST)", lat: 33.6590, lng: 73.0162, aqi: 142, color: "Orange", note: "Within 500m of Device 5" },
        { id: 8, name: "Smog Filter Beta (NEAR NUST)", lat: 33.6468, lng: 72.9950, aqi: 118, color: "Orange", note: "Within 500m of Device 6" }
      ],
      overlapPairs: [
        { devices: [5, 7], distance: "~280m", note: "PF ESP + Air Purifier Alpha" },
        { devices: [6, 8], distance: "~290m", note: "Smog Tower + Smog Filter Beta" }
      ],
      expectedOverlaps: 2,
      aqiRange: [78, 165],
      colors: ["Yellow", "Orange", "Red"],
      highWindDevices: [
        { id: 1, wind: "11.5 m/s SE (135°)", shape: "Very elongated oval extending southeast" },
        { id: 6, wind: "13.2 m/s W (270°)", shape: "Very elongated oval extending west" }
      ]
    },
    lahore: {
      count: 1,
      devices: [
        { id: 3, name: "Smog Remover", lat: 31.4392, lng: 74.2106, aqi: 195, color: "Red" }
      ],
      note: "Single device with strong wind effect (8.5 m/s)",
      expectedOverlaps: 0,
      windSpeed: 8.5,
      aqiRange: [195],
      colors: ["Red"]
    }
  },
  testScenarios: [
    "✓ HIGH WIND devices (Device 1: 11.5 m/s SE, Device 6: 13.2 m/s W)",
    "✓ Elongated ovals extending IN wind direction (not opposite)",
    "✓ Device 1: Narrow at device, widening southeast",
    "✓ Device 6: Narrow at device, widening west",
    "✓ Overlap detection (2 pairs in Islamabad)",
    "✓ Device 5 (PF ESP) + Device 7 (Air Purifier Alpha): ~280m apart",
    "✓ Device 6 (Smog Tower) + Device 8 (Smog Filter Beta): ~290m apart",
    "✓ Wind-adaptive shapes (Lahore: 8.5 m/s wind)",
    "✓ AQI color range (Yellow to Red)",
    "✓ Mixed wind conditions (1.5 to 13.2 m/s)",
    "✓ Real device locations from system",
    "✓ 6 real devices + 2 test devices for overlap validation"
  ],
  deviceDetails: {
    real: [
      "1. test tower09 (Islamabad) - AQI 125 - 🌪️ HIGH WIND 11.5 m/s SE",
      "2. Clock Tower (F10) - AQI 165",
      "3. Smog Remover (Lahore EME) - AQI 195 - 🌪️ STRONG WIND 8.5 m/s E",
      "4. Iron Tower (E11) - AQI 98",
      "5. PF ESP (FAST) - AQI 78",
      "6. Smog Tower (Nust) - AQI 88 - 🌪️ HIGH WIND 13.2 m/s W"
    ],
    additional: [
      "7. Air Purifier Alpha (Near FAST) - AQI 142 - OVERLAPS with Device 5",
      "8. Smog Filter Beta (Near Nust) - AQI 118 - OVERLAPS with Device 6"
    ],
    windEffects: [
      "Device 1 (test tower09): 11.5 m/s → 3x elongation extending SE (135°)",
      "Device 6 (Smog Tower): 13.2 m/s → 4x elongation extending W (270°)",
      "Device 3 (Smog Remover): 8.5 m/s → 2x elongation extending E (90°)",
      "Pollution spreads IN the wind direction (narrow at device, widening downwind)"
    ]
  }
}

/**
 * Helper to enable/disable dummy data
 */
export const USE_DUMMY_HEAT_DATA = false // Set to false to use real API data
