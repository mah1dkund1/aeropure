import AppShell from "@/components/app/shell"
import { cookies } from "next/headers"
import { LiveMap } from "@/components/map/live-map"
import { Topbar } from "@/components/app/topbar"
export default async function MapPage() {
  const c = await cookies()
  // Prefer cookie (saved via Settings). Fallback to env so manual entry isn't required.
  const mapsKey = c.get("maps_key")?.value || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null // may be null; client shows placeholder
  return (
    <AppShell>
      <Topbar title="Live Map" />
      <div className="mb-0">
        <h1 className="text-2xl font-semibold text-balance">Live Map</h1>
      </div>
      {mapsKey ? (
        <LiveMap apiKey={mapsKey} showTopbar={false} />
      ) : (
        <div className="m-3 h-[calc(100dvh-4rem)] rounded-md border bg-muted flex items-center justify-center">
          <div className="text-center">
            <div className="text-sm font-semibold">Google Maps unavailable</div>
            <div className="text-xs text-muted-foreground">Add a Maps API key in Settings to enable the map.</div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
