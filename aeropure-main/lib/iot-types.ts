// Basic types for IoT API responses

export type ApiResponse<T> = {
  code: number
  data: T
  msg: string
}

export type Device = {
  id: number
  latitude: string | null
  longitude: string | null
  offlineTime: number | null
  onlineTime: number | null
  activeTime: number | null
  createTime: number
  state: 0 | 1
  deviceName: string
  serial: string | null
  noteName: string | null
  groupId: number | null
  onlineState: 0 | 1
}

export type DevicePage = {
  list: Device[]
  total: number
}

export type DeviceDetail = Omit<Device, "groupId"> & {
  productId?: number
}

export type TslItem = {
  id: number
  identifier: string
  productId: string
  functionName: string
  dataType: string
  elementUnit: string | null
  elementStep: string | null
  minimumValue: number | null
  maximumValue: number | null
  elementData: unknown
  createTime: number
  functionType: number
  inputData: unknown
  outputData: unknown
  callType: unknown
  eventType: unknown
  readWriteType: number
  elementState: number
}

export type LatestDataPoint = {
  time: number
  value: string | number
  name: string
}

export type LatestData = Array<Record<string, LatestDataPoint>>

// Assets (non-IoT device) markers to render on the map
export type AssetMarker = {
  id: string
  name: string
  lat: number
  lng: number
  location?: string
  type?: string
  efficiency?: string
  images?: string[]
  status?: "online" | "offline"
  deviceId?: number
}
