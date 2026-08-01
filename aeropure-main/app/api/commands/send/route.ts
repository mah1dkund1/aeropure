import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL

    let payload: any
    const ct = req.headers.get("content-type") || ""
    if (ct.includes("application/json")) {
      payload = await req.json()
    } else {
      // accept form too, coerce to json
      const form = await req.formData()
      payload = Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, typeof v === 'string' ? v : (v as File).name]))
    }

    // Normalize deviceID to number when possible
    const deviceID = payload?.deviceID != null ? Number(payload.deviceID) : undefined
    const supplySTATUS = payload?.supplySTATUS

    if (!deviceID || !supplySTATUS || !["ON", "OFF"].includes(String(supplySTATUS).toUpperCase())) {
      return NextResponse.json({ error: true, message: "deviceID and supplySTATUS (ON|OFF) are required" }, { status: 400 })
    }

    const upstream = await fetch(`${BACKEND_BASE_URL}/send_command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ deviceID, supplySTATUS }),
      // no-store to avoid caching
      cache: "no-store",
    })

    const data = await upstream.json().catch(() => ({ error: true, message: "Invalid JSON from upstream" }))

    return NextResponse.json(data, {
      status: upstream.ok ? upstream.status : upstream.status || 502,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err: any) {
    return NextResponse.json({ error: true, message: err?.message || "Upstream POST failed" }, { status: 502 })
  }
}
