import { type NextRequest, NextResponse } from "next/server"
import { forwardGet } from "@/lib/iot-proxy"
import { demoLatestData } from "@/lib/dummy"

export async function GET(req: NextRequest, { params }: { params: { deviceName: string } }) {
  try {
    const url = new URL(req.url)
    url.searchParams.set("deviceName", params.deviceName)
    const forwarded = new Request(url.toString(), { method: "GET" })
    // vendor: /openapi/device/get/latest-data
    // rate limit: 5/s per IP (we rely on vendor; avoid revalidate)
    // @ts-expect-error NextRequest-like
    const upstream = await forwardGet("/openapi/device/get/latest-data", forwarded)
    const json = await upstream.json()
    if (json?.code !== 0) {
      return NextResponse.json({ code: 0, data: demoLatestData(params.deviceName), msg: "demo" })
    }
    return NextResponse.json(json)
  } catch {
    return NextResponse.json({ code: 0, data: demoLatestData(params.deviceName), msg: "demo" })
  }
}
