import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL 

    const incoming = new URL(req.url)
    const deviceIDParam = incoming.searchParams.get("deviceID")
    if (!deviceIDParam) {
      return NextResponse.json({ error: true, message: "deviceID is required" }, { status: 400 })
    }

    const url = new URL(`${BACKEND_BASE_URL}/poll_command_status`)
    url.searchParams.set("deviceID", String(deviceIDParam))

    const upstream = await fetch(url.toString(), { cache: "no-store", headers: { Accept: "application/json" } })
    const data = await upstream.json().catch(() => ({ error: true, message: "Invalid JSON from upstream" }))

    return NextResponse.json(data, {
      status: upstream.ok ? upstream.status : upstream.status || 502,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err: any) {
    return NextResponse.json({ error: true, message: err?.message || "Upstream GET failed" }, { status: 502 })
  }
}
