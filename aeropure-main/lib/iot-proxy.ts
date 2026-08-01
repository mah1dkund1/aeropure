// Helper for server route handlers to talk to the upstream IoT API with the user's appKey

import { cookies } from "next/headers"
import type { NextRequest } from "next/server"

const IOT_API_BASE = process.env.IOT_API_BASE || "http://openapi.yantaisensor.com"

export function getAppKeyFromCookies() {
  // In some Next.js typings, cookies() may be inferred as a Promise; cast to any to support both
  const c = cookies() as any
  const appKey = c?.get?.("appkey")?.value
  return appKey
}

export function hasAppKey() {
  return !!getAppKeyFromCookies()
}

export function requireAppKeyOrThrow() {
  const appKey = getAppKeyFromCookies()
  if (!appKey) {
    const error = new Error("Missing appKey")
    // Mark with a special status so API routes can decide to serve demo data
    ;(error as any).status = 412
    throw error
  }
  return appKey
}

export function buildUpstreamUrl(path: string, initQuery?: URLSearchParams) {
  const appKey = requireAppKeyOrThrow()
  const url = new URL(`${IOT_API_BASE}${path}`)
  if (initQuery) {
    initQuery.forEach((v, k) => url.searchParams.set(k, v))
  }
  url.searchParams.set("appKey", appKey)
  return url
}

export async function forwardGet<T>(path: string, req: NextRequest) {
  const query = new URL(req.url).searchParams
  const url = buildUpstreamUrl(path, query)
  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" })
  return res
}

export async function forwardPut<T>(path: string, body: unknown, req: NextRequest) {
  const query = new URL(req.url).searchParams
  const url = buildUpstreamUrl(path, query)
  const res = await fetch(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return res
}

export function mapUpstreamError(code: number, msg: string) {
  // Map vendor error codes to HTTP status and concise messages
  const map: Record<number, { status: number; message: string }> = {
    1101000001: { status: 400, message: "AppKey is empty" },
    1101000002: { status: 401, message: "AppKey invalid" },
    1101000003: { status: 403, message: "AppKey not activated" },
    1101000004: { status: 403, message: "AppKey disabled" },
    500: { status: 500, message: "Invalid parameters" },
  }
  return map[code] ?? { status: 502, message: msg || "Upstream error" }
}
