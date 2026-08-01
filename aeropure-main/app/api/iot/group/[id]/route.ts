import { type NextRequest, NextResponse } from "next/server"
import { forwardGet, mapUpstreamError } from "@/lib/iot-proxy"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const url = new URL(req.url)
    url.searchParams.set("id", params.id)
    const forwarded = new Request(url.toString(), { method: "GET" })
    // @ts-expect-error NextRequest-like
    const upstream = await forwardGet("/openapi/group/get", forwarded)
    const json = await upstream.json()
    if (json?.code !== 0) {
      const { status, message } = mapUpstreamError(json?.code, json?.msg)
      return NextResponse.json({ error: message }, { status })
    }
    return NextResponse.json(json)
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: "Failed to load group detail" }, { status })
  }
}
