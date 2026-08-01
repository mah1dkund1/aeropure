import type { Device, DeviceDetail, DevicePage, LatestData, TslItem } from "./iot-types"

function seededRandom(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const pollutants = [
  { key: "AQI", name: "Air Quality Index", unit: "" },
  { key: "PM2_5", name: "PM2.5", unit: "µg/m³" },
  { key: "PM10", name: "PM10", unit: "µg/m³" },
  { key: "CO2", name: "CO₂", unit: "ppm" },
  { key: "NO2", name: "NO₂", unit: "ppb" },
] as const

export function demoDevices(count = 25): DevicePage {
  const rand = seededRandom(42)
  const list: Device[] = Array.from({ length: count }).map((_, i) => {
    const on = rand() > 0.25 ? 1 : 0
    return {
      id: i + 1,
      deviceName: `Aero-${String(i + 1).padStart(3, "0")}`,
      serial: `SN-${100000 + i}`,
      noteName: null,
      latitude: (28 + rand() * 10).toFixed(6),
      longitude: (76 + rand() * 10).toFixed(6),
      offlineTime: null,
      onlineTime: null,
      activeTime: null,
      createTime: Date.now() - (i + 1) * 86400000,
      state: 1,
      groupId: (i % 3) + 1,
      onlineState: on,
    }
  })
  return { list, total: list.length }
}

export function demoDeviceDetail(name: string): DeviceDetail {
  const index = Number(/\d+/.exec(name)?.[0] ?? "1")
  const base = demoDevices(100).list[index - 1] || demoDevices(1).list[0]
  return { ...base, productId: 101 }
}

export function demoLatestData(name: string): LatestData {
  const rand = seededRandom(name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) + 7)
  const now = Date.now()
  const point: Record<string, any> = {}
  for (const p of pollutants) {
    const valueBase =
      p.key === "AQI"
        ? 45 + Math.round(rand() * 70)
        : p.key === "PM2_5"
          ? 10 + Math.round(rand() * 80)
          : p.key === "PM10"
            ? 15 + Math.round(rand() * 120)
            : p.key === "CO2"
              ? 400 + Math.round(rand() * 600)
              : 5 + Math.round(rand() * 30)
    point[p.key] = { time: now, value: valueBase, name: p.name }
  }
  return [point]
}

export function demoTsl(): TslItem[] {
  return pollutants.map((p, i) => ({
    id: i + 1,
    identifier: p.key,
    productId: "101",
    functionName: p.name,
    dataType: "float",
    elementUnit: p.unit || null,
    elementStep: "1",
    minimumValue: 0,
    maximumValue: p.key === "CO2" ? 5000 : p.key === "AQI" ? 500 : 1000,
    elementData: null,
    createTime: Date.now() - (i + 1) * 100000,
    functionType: 1,
    inputData: null,
    outputData: null,
    callType: null,
    eventType: null,
    readWriteType: 1,
    elementState: 0,
  }))
}

export function demoGroups() {
  return {
    list: [
      { id: 1, groupName: "Downtown", groupStatus: 0, createTime: Date.now() - 86400000 * 12 },
      { id: 2, groupName: "Industrial Park", groupStatus: 0, createTime: Date.now() - 86400000 * 20 },
      { id: 3, groupName: "University", groupStatus: 0, createTime: Date.now() - 86400000 * 30 },
    ],
    total: 3,
  }
}
