import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    // Forwarrd query string (?search=...) to upsream
    const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL 
    const url = new URL(`${BACKEND_BASE_URL}/assets`)
    const incoming = new URL(req.url)
    incoming.searchParams.forEach((v, k) => url.searchParams.set(k, v))

    const upstream = await fetch(url.toString(), {
      // Avoid Next fetch caching for fresh data
      cache: "no-store",
      headers: { Accept: "application/json" },
    })

    // Try to parse JSON even if status is non-2xx
    const data = await upstream
      .json()
      .catch(() => ({ error: true, message: "Invalid JSON from upstream" }))

    return NextResponse.json(data, {
      status: upstream.ok ? 200 : upstream.status || 502,
      headers: {
        "Cache-Control": "no-store",
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: true, message: err?.message || "Upstream request failed" },
      { status: 502 },
    )
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || ""

    let body: BodyInit | undefined
    let headers: HeadersInit | undefined
    // Attempt to extract a device id from the incoming request for duplicate-check
    let incomingDeviceId: number | undefined

    if (contentType.includes("application/json")) {
      const json = await req.json()
      // read device id candidate from json
      const candidate = json?.id ?? json?.deviceId ?? json?.deviceID
      if (candidate !== undefined && candidate !== null) {
        const n = typeof candidate === "number" ? candidate : Number(candidate)
        if (!isNaN(n)) incomingDeviceId = n
      }
      body = JSON.stringify(json)
      headers = { "Content-Type": "application/json", Accept: "application/json" }
    } else {
      // Treat as multipart/form-data or urlencoded
      const incoming = await req.formData()
      // extract device id from form fields if present
      const cand = incoming.get("id") ?? incoming.get("deviceId") ?? incoming.get("deviceID")
      if (cand !== null && cand !== undefined) {
        const cstr = typeof cand === "string" ? cand : (cand instanceof File ? undefined : String(cand))
        if (cstr) {
          const n = Number(cstr)
          if (!isNaN(n)) incomingDeviceId = n
        }
      }
      const form = new FormData()
      for (const [key, value] of incoming.entries()) {
        if (value instanceof File) {
          form.append(key, value)
        } else {
          form.append(key, value as string)
        }
      }
      body = form
      headers = { Accept: "application/json" }
    }

    // Server-side duplicate check: if incomingDeviceId present, query upstream assets and refuse if exists
    const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL 
    if (incomingDeviceId !== undefined) {
      try {
        // request many items to increase chance of finding matches
        const listResp = await fetch(`${BACKEND_BASE_URL}/assets?pageSize=10000`, { cache: "no-store", headers: { Accept: "application/json" } })
        const listJson = await listResp.json().catch(() => ({}))
        const items = Array.isArray(listJson?.items) ? listJson.items : Array.isArray(listJson) ? listJson : (listJson?.data ?? listJson?.items ?? [])
        const exists = (items || []).some((it: any) => {
          const cand = it?.deviceID ?? it?.deviceId ?? it?.id
          const n = typeof cand === "number" ? cand : Number(cand)
          return !isNaN(n) && Number(n) === Number(incomingDeviceId)
        })
        if (exists) {
          return NextResponse.json({ error: true, message: `Asset already exists for device id ${incomingDeviceId}` }, { status: 400 })
        }
      } catch (er) {
        // on failure to validate, continue and let upstream decide. Do not block create.
      }
    }

    const upstream = await fetch(`${BACKEND_BASE_URL}/assets`, {
      method: "POST",
      body,
      headers,
    })

    const data = await upstream
      .json()
      .catch(() => ({ error: true, message: "Invalid JSON from upstream" }))

    return NextResponse.json(data, {
      status: upstream.ok ? upstream.status : upstream.status || 502,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: true, message: err?.message || "Upstream POST failed" },
      { status: 502 },
    )
  }
}
