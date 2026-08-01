import { type NextRequest, NextResponse } from "next/server"

const IOT_API_BASE = process.env.IOT_API_BASE || "http://openapi.yantaisensor.com"

// Validate appKey by calling a cheap endpoint (devices page, 1 result)
async function validateAppKey(appKey: string) {
  const url = new URL(`${IOT_API_BASE}/openapi/device/page`)
  url.searchParams.set("appKey", appKey)
  url.searchParams.set("pageNo", "1")
  url.searchParams.set("pageSize", "1")
  try {
    const res = await fetch(url.toString(), { cache: "no-store" })
    const json = await res.json().catch(() => ({}))
    return json?.code === 0
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const { appKey } = await req.json().catch(() => ({}))
  if (!appKey || typeof appKey !== "string") {
    return NextResponse.json({ ok: false, error: "appKey required" }, { status: 400 })
  }

  const ok = await validateAppKey(appKey)
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Invalid appKey" }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set("appkey", appKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return res
}
