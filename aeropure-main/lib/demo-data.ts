export type DemoDevice = {
  deviceName: string
  lat: number
  lng: number
  status: "online" | "offline"
  city: string
  pollutant: "AQI" | "PM2.5" | "PM10" | "SO2" | "NO2" | "O3" | "CO"
  value: number // current
}

export const DEMO_DEVICES: DemoDevice[] = [
  // Lahore cluster (main city view)
  {
    deviceName: "AP-LHR-001",
    lat: 31.5204,
    lng: 74.3587,
    status: "online",
    city: "Lahore",
    pollutant: "PM2.5",
    value: 92,
  },
  {
    deviceName: "AP-LHR-002",
    lat: 31.5214,
    lng: 74.3597,
    status: "offline",
    city: "Lahore",
    pollutant: "PM10",
    value: 160,
  },
  {
    deviceName: "AP-LHR-003",
    lat: 31.5194,
    lng: 74.3577,
    status: "online",
    city: "Lahore",
    pollutant: "NO2",
    value: 38,
  },
  {
    deviceName: "AP-LHR-004",
    lat: 31.5224,
    lng: 74.3607,
    status: "online",
    city: "Lahore",
    pollutant: "AQI",
    value: 68,
  },
  {
    deviceName: "AP-LHR-005",
    lat: 31.5184,
    lng: 74.3567,
    status: "online",
    city: "Lahore",
    pollutant: "O3",
    value: 22,
  },
  {
    deviceName: "AP-LHR-006",
    lat: 31.5234,
    lng: 74.3617,
    status: "offline",
    city: "Lahore",
    pollutant: "SO2",
    value: 14,
  },
  {
    deviceName: "AP-LHR-007",
    lat: 31.5174,
    lng: 74.3557,
    status: "online",
    city: "Lahore",
    pollutant: "PM2.5",
    value: 54,
  },
  {
    deviceName: "AP-LHR-008",
    lat: 31.5244,
    lng: 74.3627,
    status: "online",
    city: "Lahore",
    pollutant: "PM10",
    value: 112,
  },
  // Regional devices (visiblee in wind particle mode)
  {
    deviceName: "AP-KHI-001",
    lat: 24.8607,
    lng: 67.0011,
    status: "online",
    city: "Karachi",
    pollutant: "PM2.5",
    value: 88,
  },
  {
    deviceName: "AP-ISB-001",
    lat: 33.7294,
    lng: 73.0931,
    status: "online",
    city: "Islamabad",
    pollutant: "AQI",
    value: 65,
  },
  {
    deviceName: "AP-FSD-001",
    lat: 31.4504,
    lng: 73.1350,
    status: "offline",
    city: "Faisalabad",
    pollutant: "PM10",
    value: 145,
  },
  {
    deviceName: "AP-RWP-001",
    lat: 33.5651,
    lng: 73.0169,
    status: "online",
    city: "Rawalpindi",
    pollutant: "NO2",
    value: 42,
  },
  {
    deviceName: "AP-MLT-001",
    lat: 30.1575,
    lng: 71.5249,
    status: "online",
    city: "Multan",
    pollutant: "O3",
    value: 28,
  },
  {
    deviceName: "AP-GUJ-001",
    lat: 32.1877,
    lng: 74.1945,
    status: "online",
    city: "Gujranwala",
    pollutant: "SO2",
    value: 18,
  },
  {
    deviceName: "AP-PSH-001",
    lat: 34.0151,
    lng: 71.5249,
    status: "offline",
    city: "Peshawar",
    pollutant: "PM2.5",
    value: 98,
  },
  {
    deviceName: "AP-QTA-001",
    lat: 30.1798,
    lng: 66.9750,
    status: "online",
    city: "Quetta",
    pollutant: "AQI",
    value: 72,
  },
]

export const DEMO_POLLUTANTS = ["AQI", "PM2.5", "PM10", "SO2", "NO2", "O3", "CO"] as const

// Simple daily series for last 30 days
export function demoSeries(days = 30, base = 60, variance = 25) {
  const now = new Date()
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now)
    d.setDate(now.getDate() - (days - 1 - i))
    const v = Math.max(0, Math.round(base + Math.sin(i / 2) * variance + ((i * 7) % 9) - 4))
    return { date: d.toISOString().slice(0, 10), value: v }
  })
}
