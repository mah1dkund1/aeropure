import { type NextRequest, NextResponse } from "next/server"
import { forwardGet } from "@/lib/iot-proxy"

export async function GET(req: NextRequest, { params }: { params: { deviceName: string } }) {
  try {
    const url = new URL(req.url)
    url.searchParams.set("deviceName", params.deviceName)
    const forwarded = new Request(url.toString(), { method: "GET" })
    // @ts-expect-error NextRequest-like
    const upstream = await forwardGet("/openapi/device/deviceName/get", forwarded)
    const json = await upstream.json()
    if (json?.code !== 0) {
      // Vendor error → return null data without demo
      return NextResponse.json({ code: 0, data: null, msg: "empty" })
    }
    return NextResponse.json(json)
  } catch {
    // Network/missing appKey → return null data instead of demo
    return NextResponse.json({ code: 0, data: null, msg: "empty" })
  }
}
