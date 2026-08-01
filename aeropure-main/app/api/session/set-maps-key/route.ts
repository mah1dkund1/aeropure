import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const mapsKey = (body?.mapsKey || "").toString().trim()
    if (!mapsKey) {
      return NextResponse.json({ error: "mapsKey is required" }, { status: 400 })
    }

    // Build response first and set cookie on the response (Next 15 compatible)
    const res = NextResponse.json({ ok: true })
    res.cookies.set("maps_key", mapsKey, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })
    return res
  } catch (e: any) {
    return NextResponse.json({ error: "Failed to set maps key" }, { status: 500 })
  }
}
