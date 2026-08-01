import { type NextRequest, NextResponse } from "next/server"
import { forwardGet } from "@/lib/iot-proxy"

export async function GET(req: NextRequest) {
  try {
    const upstream = await forwardGet("/openapi/device/page", req)
    const json = await upstream.json()
    if (json?.code !== 0) {
      // Vendor returned error; return empty list to avoid using demo data
      return NextResponse.json({ code: 0, data: [], msg: "empty" })
    }
    return NextResponse.json(json)
  } catch (e: any) {
    // Network/missing appKey → return empty list instead of demo data
    return NextResponse.json({ code: 0, data: [], msg: "empty" })
  }
}
