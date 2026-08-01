import { NextRequest, NextResponse } from "next/server"

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL 

export async function GET(req: NextRequest) {
  try {
    const url = new URL(`${BACKEND_BASE_URL}/getDevices`)
    // forward any incoming query params to upstream if present
    const incoming = new URL(req.url)
    incoming.searchParams.forEach((v, k) => url.searchParams.set(k, v))

    const upstream = await fetch(url.toString(), { cache: "no-store" })
    const data = await upstream.json().catch(() => ({}))

    return NextResponse.json(data, {
      status: upstream.ok ? upstream.status : 502,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to fetch upstream" }, { status: 500 })
  }
}
