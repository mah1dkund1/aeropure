import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function GET() {
  try {
    const c = await cookies()
    // Prefer cookie (set from Settings). Fallback to env if not set.
    const fromCookie = c.get("maps_key")?.value || null
    const fromEnv = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || null
    const mapsKey = fromCookie || fromEnv
    return NextResponse.json({ mapsKey })
  } catch {
    const fromEnv = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || null
    return NextResponse.json({ mapsKey: fromEnv }, { status: 200 })
  }
}
