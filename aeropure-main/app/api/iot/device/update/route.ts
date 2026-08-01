import { type NextRequest, NextResponse } from "next/server"
import { forwardPut, mapUpstreamError } from "@/lib/iot-proxy"

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const upstream = await forwardPut("/openapi/device/update", body, req)
    const json = await upstream.json()
    if (json?.code !== 0) {
      const { status, message } = mapUpstreamError(json?.code, json?.msg)
      return NextResponse.json({ error: message }, { status })
    }
    return NextResponse.json(json)
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: "Failed to update device" }, { status })
  }
}
