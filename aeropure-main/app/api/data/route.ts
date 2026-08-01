import { NextRequest, NextResponse } from "next/server"

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL 
const UPSTREAM = `${BACKEND_BASE_URL}/data`

// Disable Next.js caching for this route since responses are too large (>2MB)
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limitParam = (searchParams.get("limit") || "100").toLowerCase()

  async function fetchUpstream(limitValue: number | string) {
    const url = `${UPSTREAM}?limit=${encodeURIComponent(String(limitValue))}`
    // Remove Next.js cache to avoid "Failed to set fetch cache" error
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Upstream error ${res.status}`)
    return res.json()
  }

  try {
    // Support special values for limit: "total" and "remaining"
    if (limitParam === "total" || limitParam === "remaining") {
      // First call to discover counts
      const probe = await fetchUpstream(1)
      const total: number | undefined = probe?.total
      const remaining: number | undefined = probe?.remaining

      if (typeof total !== "number") {
        return NextResponse.json({ error: "Upstream did not return total count" }, { status: 502 })
      }

      const wanted = limitParam === "total" ? total : Math.max(remaining ?? 0, 0)
      const data = await fetchUpstream(wanted)
      return NextResponse.json(data)
    }

    // Fallback: numeric or default value
    const numericLimit = isNaN(Number(limitParam)) ? 100 : Number(limitParam)
    const data = await fetchUpstream(numericLimit)
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to fetch" }, { status: 500 })
  }
}
