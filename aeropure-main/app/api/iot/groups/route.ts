import { type NextRequest, NextResponse } from "next/server"
import { forwardGet } from "@/lib/iot-proxy"
import { demoGroups } from "@/lib/dummy"

export async function GET(req: NextRequest) {
  try {
    const upstream = await forwardGet("/openapi/group/page", req)
    const json = await upstream.json()
    if (json?.code !== 0) {
      return NextResponse.json({ code: 0, data: demoGroups(), msg: "demo" })
    }
    return NextResponse.json(json)
  } catch {
    return NextResponse.json({ code: 0, data: demoGroups(), msg: "demo" })
  }
}
