import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function upstreamUrl(id: string) {
  const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || "http://45.94.58.200:8001"
  return `${BACKEND_BASE_URL}/assets/${encodeURIComponent(id)}`
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const upstream = await fetch(upstreamUrl(params.id), { cache: "no-store", headers: { Accept: "application/json" } })
    const data = await upstream.json().catch(() => ({ error: true, message: "Invalid JSON from upstream" }))
    return NextResponse.json(data, { status: upstream.ok ? upstream.status : upstream.status || 502, headers: { "Cache-Control": "no-store" } })
  } catch (err: any) {
    return NextResponse.json({ error: true, message: err?.message || "Upstream GET failed" }, { status: 502 })
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const contentType = req.headers.get("content-type") || ""
    let body: BodyInit | undefined
    let headers: HeadersInit | undefined
    if (contentType.includes("application/json")) {
      const json = await req.json()
      body = JSON.stringify(json)
      headers = { "Content-Type": "application/json", Accept: "application/json" }
    } else {
      const incoming = await req.formData()
      const form = new FormData()
      for (const [key, value] of incoming.entries()) {
        if (value instanceof File) form.append(key, value, value.name)
        else form.append(key, value as string)
      }
      body = form
      headers = { Accept: "application/json" }
    }
    const upstream = await fetch(upstreamUrl(params.id), { method: "PUT", body, headers })
    const data = await upstream.json().catch(() => ({ error: true, message: "Invalid JSON from upstream" }))
    return NextResponse.json(data, { status: upstream.ok ? upstream.status : upstream.status || 502, headers: { "Cache-Control": "no-store" } })
  } catch (err: any) {
    return NextResponse.json({ error: true, message: err?.message || "Upstream PUT failed" }, { status: 502 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const upstream = await fetch(upstreamUrl(params.id), { method: "DELETE", headers: { Accept: "application/json" } })
    const data = await upstream.json().catch(() => ({}))
    return NextResponse.json(data, { status: upstream.ok ? upstream.status : upstream.status || 502, headers: { "Cache-Control": "no-store" } })
  } catch (err: any) {
    return NextResponse.json({ error: true, message: err?.message || "Upstream DELETE failed" }, { status: 502 })
  }
}
