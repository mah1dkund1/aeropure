"use client"

import useSWR from "swr"

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Request failed: ${r.status}`)
    return r.json()
  })

export function useApi<T = any>(url: string | null, refreshInterval: number = 30000) {
  const { data, error, isLoading, mutate } = useSWR<T>(url, fetcher, {
    refreshInterval, // Auto-refresh every 30 seconds by default
    revalidateOnFocus: true, // Refresh when window regains focus
    revalidateOnReconnect: true, // Refresh when network reconnects
    dedupingInterval: 2000, // Dedupe requests within 2 seconds
  })
  return { data, error, isLoading, mutate }
}
