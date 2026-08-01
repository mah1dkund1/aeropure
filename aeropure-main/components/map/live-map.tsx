"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { Topbar } from "@/components/app/topbar"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { AeropureMap } from "@/components/map/google-map"
import { MapFilters, useDefaultMapFilters, type MapFilterState } from "@/components/map/map-filters"
import { useDevices } from "@/components/iot/use-devices"
import { useAssets } from "@/components/iot/use-assets"
import type { AssetMarker } from "@/lib/iot-types"
import { useStationData } from "@/components/iot/use-station-data"
import { useHeatmapGenerator } from "@/components/iot/use-heatmap-generator"
import { metricLabel, unitForMetric } from "@/lib/utils"

export function LiveMap({ apiKey, showTopbar = true }: { apiKey?: string, showTopbar?: boolean }) {
  const { devices, isLoading } = useDevices()
  const { assets } = useAssets()
  const [filters, setFilters] = useState<MapFilterState>(useDefaultMapFilters())
  const [openPanel, setOpenPanel] = useState<"search" | "layers" | "station" | null>(null)
  const [selected, setSelected] = useState<any | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<AssetMarker | null>(null)
  const { latest, getLatestForDevice } = useStationData(100)
  const { heatmapPoints, heatmapPointsByBucket, devicesWithReadings, isLoading: isLoadingHeatmap } = useHeatmapGenerator()
  const mapRef = useRef<google.maps.Map | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<{
    states: any[]
    cities: any[]
    stations: any[]
    assets: AssetMarker[]
  }>({ states: [], cities: [], stations: [], assets: [] })
  // UI state for Map Controls
  const [selectedStyle, setSelectedStyle] = useState<"roadmap" | "satellite" | "terrain" | "hybrid">("roadmap")
  const [selectedPollutants, setSelectedPollutants] = useState<Set<string>>(new Set(["PM2.5", "PM10", "NO2", "AQI", "O3", "SO2", "CO", "VOCs"]))
  const [windArrows, setWindArrows] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [assetTypes, setAssetTypes] = useState<Record<string, boolean>>({
    all: true,
    "SenseMesh": false,
    "IonRain Tower": false,
    "IndusESP": false,
  })

  // Compute which assets should be shown based on the asset type toggles
  const displayedAssets = useMemo(() => {
    if (!assets || !assets.length) return []
    const anyAll = !!assetTypes.all
    if (anyAll) return assets
    const enabled = Object.keys(assetTypes).filter((k) => k !== 'all' && assetTypes[k])
    if (!enabled.length) return []
    return assets.filter((a: any) => enabled.includes(a.type))
  }, [assetTypes, assets])

  // Prefill assets list whenever the search panel opens or assets change
  useEffect(() => {
    if (openPanel === "search") {
      const ql = query.toLowerCase()
      const filteredAssets = (assets || []).filter((a) =>
        !ql || a.name.toLowerCase().includes(ql) || (a.location || "").toLowerCase().includes(ql),
      )
      setResults((r) => {
        const prev = r.assets || []
        const changed =
          prev.length !== filteredAssets.length ||
          prev.some((p, i) => p.id !== filteredAssets[i]?.id)
        return changed ? { ...r, assets: filteredAssets } : r
      })
    }
  }, [openPanel, assets, query])

  const filtered = useMemo(() => {
    return devices.filter((d) => {
      const statusOk =
        (filters.status.online && d.status === "online") || (filters.status.offline && d.status === "offline")
      const pollutantOk = selectedPollutants.size ? selectedPollutants.has(d.pollutant) : true
      // Optional: filter by asset types if you map devices to a type later
      return statusOk && pollutantOk
    })
  }, [devices, filters.status, selectedPollutants])

  // Filter devicesWithReadings to only include devices for displayed assets
  const filteredDevicesWithReadings = useMemo(() => {
    if (!devicesWithReadings || !displayedAssets) return []
    
    // Create a set of displayed asset deviceIds for fast lookup
    const displayedDeviceIds = new Set(
      displayedAssets.map((asset) => Number(asset.deviceId)).filter((id) => !isNaN(id))
    )
    
    // Only include devices whose deviceId is in the displayed assets
    return devicesWithReadings.filter((device) => 
      displayedDeviceIds.has(device.deviceId)
    )
  }, [devicesWithReadings, displayedAssets])

  return (
    <div className="relative">
      {showTopbar ? <Topbar title="Live Map" /> : null}
      <div className="mt-0 grid">
        <div className="relative h-[calc(100dvh-4rem)] rounded border">
          <AeropureMap
            devices={filtered}
            assets={displayedAssets}
            heatmap={filters.heatmap}
            heatmapPoints={filters.heatmap ? heatmapPoints : undefined}
            heatmapPointsByBucket={filters.heatmap ? heatmapPointsByBucket : undefined}
            // Only pass filtered devices that correspond to displayed assets
            devicesWithAqi={filteredDevicesWithReadings}
            wind={filters.wind}
            windArrows={windArrows}
            showLabels={showLabels}
            apiKey={apiKey}
            mapTypeId={selectedStyle}
            openPanel={openPanel}
            onSetOpenPanel={setOpenPanel}
            onMapReady={(m) => {
              mapRef.current = m
              // Initialize Places Autocomplete when map is ready and search input exists
              setTimeout(() => {
                // Skip initialization if Places library isn't enabled for the key
                if (!(window as any).google?.maps?.places) return
              }, 0)
            }}
            onSelectDevice={(d) => {
              setSelected(d)
              setOpenPanel("station")
            }}
            onSelectAsset={(a) => {
              setSelectedAsset(a)
              setOpenPanel("station")
            }}
          >
            {/* Panels */}
            {openPanel === "search" ? (
            <div className="absolute right-16 top-3 z-10 w-[360px] rounded-2xl bg-white p-3 shadow-xl ring-1 ring-black/10">
              <div className="flex items-center rounded-2xl border-2 border-blue-300 bg-white px-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
                  <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" />
                </svg>
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => {
                    const q = e.target.value
                    setQuery(q)
                    const g = (window as any).google
                    // Always filter assets list locally
                    const ql = q.toLowerCase()
                    const filteredAssets = (assets || []).filter((a) =>
                      a.name.toLowerCase().includes(ql) || (a.location || "").toLowerCase().includes(ql),
                    )

                    // Only call Places autocomplete if library is available and query is non-empty
                    if (!g?.maps?.places || !q.trim()) {
                      setResults({ states: [], cities: [], stations: [], assets: filteredAssets })
                      return
                    }

                    const svc = new g.maps.places.AutocompleteService()
                    svc.getPlacePredictions(
                      { input: q, types: ["(regions)"] },
                      (preds: any[]) => {
                        const states: any[] = []
                        const cities: any[] = []
                        const stations: any[] = []
                        for (const p of preds || []) {
                          const types: string[] = p.types || []
                          if (types.includes("administrative_area_level_1") || types.includes("administrative_area_level_2")) states.push(p)
                          else if (types.includes("locality") || types.includes("administrative_area_level_3")) cities.push(p)
                          else stations.push(p)
                        }
                        setResults({ states, cities, stations, assets: filteredAssets })
                      },
                    )
                  }}
                  placeholder="Search places or assets"
                  className="ml-2 flex-1 py-3 text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  className="ml-2 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => setOpenPanel(null)}
                >
                  ✕
                </button>
              </div>

              {/* Results list */}
              <div className="mt-3 max-h-[50vh] overflow-auto pr-1">
                {(["states","cities","stations"] as const).map((section) => {
                  const label = section === "states" ? "STATES" : section === "cities" ? "CITIES" : "STATIONS"
                  const items = (results as any)[section] as any[]
                  if (!items?.length) return null
                  return (
                    <div key={section} className="mb-3">
                      <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{label}</div>
                      <div className="rounded-lg">
                        {items.map((p) => {
                          const aqi = seededAqi(p.place_id)
                          const chip = aqiChip(aqi)
                          return (
                            <button
                              key={p.place_id}
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-muted"
                              onClick={() => {
                                const g = (window as any).google
                                if (!mapRef.current) return
                                if (!g?.maps?.places) return // places not enabled, skip panning
                                const svc = new g.maps.places.PlacesService(mapRef.current)
                                svc.getDetails({ placeId: p.place_id }, (det: any) => {
                                  const loc = det?.geometry?.location
                                  if (loc && mapRef.current) {
                                    mapRef.current.panTo(loc)
                                    mapRef.current.setZoom(12)
                                    setOpenPanel(null)
                                  }
                                })
                              }}
                            >
                              <div className="truncate pr-3 text-sm">{p.description}</div>
                              <span className={`inline-flex min-w-10 items-center justify-center rounded-md px-2 py-[2px] text-xs font-semibold ${chip.className}`}>
                                {aqi}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {/* Assets section */}
                {(results.assets?.length ?? 0) > 0 ? (
                  <div className="mb-3">
                    <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground">ASSETS</div>
                    <div className="rounded-lg">
                      {results.assets.map((a) => {
                        const reading = getLatestForDevice(a.deviceId)
                        const aqi = Number(reading?.airQualityIndex ?? NaN)
                        const chip = aqiChip(aqi)
                        return (
                          <button
                            key={a.id}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-muted"
                            onClick={() => {
                              if (!mapRef.current) return
                              mapRef.current.panTo({ lat: a.lat, lng: a.lng })
                              mapRef.current.setZoom(14)
                              setSelectedAsset(a)
                              setSelected(null)
                              setOpenPanel("station")
                            }}
                          >
                            <div className="min-w-0 pr-3">
                              <div className="truncate text-sm">{a.name}</div>
                              {a.location ? (
                                <div className="truncate text-xs text-muted-foreground">{a.location}</div>
                              ) : null}
                            </div>
                            <span className={`inline-flex min-w-10 items-center justify-center rounded-md px-2 py-[2px] text-xs font-semibold ${chip.className}`}>
                              {Number.isFinite(aqi) ? aqi : "--"}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {openPanel === "layers" ? (
            <div className="absolute right-16 top-3 z-10 w-[320px] max-h-[80vh] rounded-2xl bg-white shadow-xl ring-1 ring-black/10 overflow-hidden">
              <div className="flex items-center justify-between rounded-t-2xl bg-gray-50 px-4 py-3 sticky top-0 z-20">
                <div className="flex items-center gap-2 text-base font-semibold">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-foreground">
                    <path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="2" fill="none"/>
                    <path d="M21 12l-9 5-9-5" stroke="currentColor" strokeWidth="2" fill="none"/>
                  </svg>
                  Map Controls
                </div>
                <button className="text-muted-foreground" onClick={() => setOpenPanel(null)}>✕</button>
              </div>
              <div className="px-3 pb-3 overflow-y-auto max-h-[calc(80vh-64px)]">
                <div className="mb-1 text-xs font-medium text-muted-foreground">HEAT MAP</div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Turn on to show heat map cluster.</span>
                  <Switch
                    checked={filters.heatmap}
                    onCheckedChange={(c) => {
                      setFilters((f) => ({ ...f, heatmap: !!c }))
                    }}
                  />
                </div>
                <Separator className="my-2" />
                <div className="mb-1 text-xs font-medium text-muted-foreground">MAP VIEW STYLE</div>
                <div className="mb-4 grid grid-cols-4 gap-2">
                  {[
                    { label: "Standard", style: "roadmap", icon: standardThumb() },
                    { label: "Satellite", style: "satellite", icon: satelliteThumb() },
                    { label: "Terrain", style: "terrain", icon: terrainThumb() },
                    { label: "Transit", style: "hybrid", icon: transitThumb() },
                  ].map((s) => (
                    <button
                      key={s.style}
                      className={`flex h-16 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-xs hover:bg-muted ${selectedStyle === s.style ? "ring-2 ring-blue-500" : ""}`}
                      onClick={() => {
                        setSelectedStyle(s.style as any)
                        if (mapRef.current) mapRef.current.setMapTypeId(s.style as any)
                      }}
                      title={s.label}
                    >
                      {s.icon}
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
                <Separator className="my-2" />
                <div className="mb-1 text-xs font-medium text-muted-foreground">ASSET TYPES</div>
                <div className="mb-4 space-y-2">
                  {/* All Types toggle - default ON. Turning it on disables individual filters. */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm">All Types</span>
                    <Switch
                      checked={!!assetTypes.all}
                      onCheckedChange={(c) => {
                        if (c) {
                          // enable all, disable specific toggles
                          setAssetTypes({ all: true, "SenseMesh": false, "IonRain Tower": false, "IndusESP": false })
                        } else {
                          // turning All off leaves current specific toggles as-is (none on by default)
                          setAssetTypes((prev) => ({ ...prev, all: false }))
                        }
                      }}
                    />
                  </div>
                  {['SenseMesh', 'IonRain Tower', 'IndusESP'].map((k) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-sm">{k}</span>
                      <Switch
                        checked={!!assetTypes[k]}
                        onCheckedChange={(c) => {
                          // turning any specific type on should disable All Types
                          setAssetTypes((prev) => ({ ...prev, all: false, [k]: !!c }))
                        }}
                      />
                    </div>
                  ))}
                </div>
                <Separator className="my-2" />
                <div className="mb-1 text-xs font-medium text-muted-foreground">POLLUTANTS LEVELS</div>
                <div className="mb-3 space-y-2">
                  {[ "PM2.5", "PM10", "CO", "NO2", "SO2", "O3", "VOCs"].map((p) => (
                    <div key={p} className="flex items-center justify-between">
                      <span className="text-sm">{metricLabel(p)}</span>
                      <Switch
                        checked={selectedPollutants.has(p)}
                        onCheckedChange={(c) => setSelectedPollutants((prev) => {
                          const next = new Set(prev)
                          if (c) next.add(p)
                          else next.delete(p)
                          return next
                        })}
                      />
                    </div>
                  ))}
                </div>
                <Separator className="my-2" />
                <div className="mb-1 text-xs font-medium text-muted-foreground">PLACES</div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm">Show Labels</span>
                  <Switch checked={showLabels} onCheckedChange={(c) => setShowLabels(!!c)} />
                </div>
                <Separator className="my-2" />
                <div className="mb-1 text-xs font-medium text-muted-foreground">WEATHER CONDITIONS</div>
                <div className="mb-3 space-y-2">
                  {["Temperature", "Humidity", "Pressure", "Wind Speed", "Wind Direction"].map((w) => (
                    <div key={w} className="flex items-center justify-between">
                      <span className="text-sm">{w}</span>
                      <Switch checked={false} onCheckedChange={() => {}} />
                    </div>
                  ))}
                </div>
                <Separator className="my-2" />
                <div className="mb-1 text-xs font-medium text-muted-foreground">WIND SPEED</div>
                <div className="mb-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Particles</span>
                    <Switch 
                      checked={filters.wind} 
                      onCheckedChange={(c) => setFilters((f) => ({ ...f, wind: !!c }))} 
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Arrows</span>
                    <Switch 
                      checked={windArrows} 
                      onCheckedChange={(c) => setWindArrows(!!c)} 
                    />
                  </div>
                </div>
                <Separator className="my-2" />
                <div className="mb-1 text-xs font-medium text-muted-foreground">PLAYBACK HISTORY</div>
              </div>
            </div>
          ) : null}

          {openPanel === "station" ? (
            <div className="absolute right-2 md:right-16 top-2 md:top-3 z-40 w-[85vw] md:w-[360px] max-h-[80vh] rounded-2xl bg-white shadow-xl ring-1 ring-black/10 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="text-sm font-semibold">Air Quality Station</div>
                <button className="text-muted-foreground" onClick={() => setOpenPanel(null)}>✕</button>
              </div>
              <div className="px-3 md:px-4 pb-3 md:pb-4 overflow-y-auto max-h-[calc(80vh-64px)]">
                {selected ? (
                  <div className="space-y-4">
                    {/* Station Info */}
                    <div className="pt-2">
                      <div className="flex items-start gap-2 mb-1">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 text-green-600">
                          <path d="M12 2v3M18.364 5.636l-2.121 2.121M21 12h-3M18.364 18.364l-2.121-2.121M12 21v-3M5.636 18.364l2.121-2.121M3 12h3M5.636 5.636l2.121 2.121" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <div className="flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold">Pakistan Engineering Services (Pvt) Ltd.</div>
                            {(() => {
                              const selId = (selected as any)?.deviceId ?? (selected as any)?.deviceName ?? null
                              const anyDevices = devices as any[]
                              // Robust status resolution for station panel
                              // Priority: selectedAsset.status -> device by deviceId -> device by coords
                              let isOnline = false
                              try {
                                // If an asset is selected (opened via asset marker), use its status
                                    if (selectedAsset && typeof selectedAsset.status === 'string') {
                                      isOnline = selectedAsset.status === 'online'
                                    } else if (selId != null) {
                                      const device = anyDevices.find(d => d.deviceId === selId || d.deviceName === selId)
                                      isOnline = device?.status === 'online'
                                } else if (selected?.lat != null && selected?.lng != null) {
                                  const byLoc = devices.find(d => Math.abs(d.lat - selected.lat) < 1e-4 && Math.abs(d.lng - selected.lng) < 1e-4)
                                  isOnline = byLoc?.status === 'online'
                                }
                              } catch {}
                              return (
                                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                                  isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                                }`}>
                                  <div className={`w-1.5 h-1.5 rounded-full ${
                                    isOnline ? 'bg-green-500' : 'bg-gray-500'
                                  }`} />
                                  {isOnline ? 'Online' : 'Offline'}
                                </div>
                              )
                            })()}
                          </div>
                          <div className="text-xs text-muted-foreground">Pakistan, Punjab, Lahore, Pakistan Engineering Services (Pvt) Ltd</div>
                        </div>
                      </div>
                    </div>

                    {/* Air Quality Index (from API) */}
                    {(() => {
                      const reading = getLatestForDevice((selected as any)?.deviceId ?? (selected as any)?.deviceName)
                      const aqi = Number(reading?.airQualityIndex ?? NaN)
                      const category = aqi <= 50 
                        ? { label: "Good", cls: "bg-emerald-200 text-emerald-800", bg: "from-emerald-50 to-green-50", border: "border-emerald-200", ring: "bg-emerald-200", inner: "bg-emerald-300", icon: "text-emerald-700", value: "text-emerald-700" } 
                        : aqi <= 100 
                        ? { label: "Moderate", cls: "bg-amber-200 text-amber-900", bg: "from-amber-50 to-yellow-50", border: "border-amber-200", ring: "bg-amber-200", inner: "bg-amber-300", icon: "text-amber-700", value: "text-amber-700" }
                        : aqi <= 150
                        ? { label: "Poor", cls: "bg-orange-200 text-orange-900", bg: "from-orange-50 to-orange-50", border: "border-orange-200", ring: "bg-orange-200", inner: "bg-orange-300", icon: "text-orange-700", value: "text-orange-700" }
                        : { label: "Unhealthy", cls: "bg-red-200 text-red-800", bg: "from-red-50 to-red-50", border: "border-red-200", ring: "bg-red-200", inner: "bg-red-300", icon: "text-red-700", value: "text-red-700" }
                      return (
                        <div>
                          <div className="text-sm font-semibold mb-2">Air Quality Index</div>
                          <div className={`rounded-xl bg-gradient-to-r ${category.bg} p-4 border ${category.border}`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-12 h-12 rounded-full ${category.ring} flex items-center justify-center`}>
                                <div className={`w-10 h-10 rounded-full ${category.inner} flex items-center justify-center`}>
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={category.icon}>
                                    <circle cx="12" cy="8" r="4" fill="currentColor"/>
                                    <path d="M12 12v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                    <path d="M8 16h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                  </svg>
                                </div>
                              </div>
                              <div className="flex-1">
                                <div className={`text-2xl font-bold ${category.value}`}>{Number.isFinite(aqi) ? aqi : "--"}</div>
                                <div className={`text-xs px-2 py-0.5 rounded-full inline-block ${category.cls}`}>
                                  {Number.isFinite(aqi) ? category.label : "No Data"}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Pollutants (from API) */}
                    {(() => {
                      const r = getLatestForDevice((selected as any)?.deviceId ?? (selected as any)?.deviceName)
                      const rows: Array<[string, number | undefined]> = [
                        ["PM2.5", r?.valuePM_2_5 as any],
                        ["PM10", r?.valuePM_10 as any],
                        ["CO", r?.valueCO as any],
                        ["SO2", r?.valueSO2 as any],
                        ["NO2", r?.valueNO2 as any],
                        ["O3", r?.valueO3 as any],
                      ]
                      return (
                        <div>
                          <div className="text-sm font-semibold mb-2">Pollutants</div>
                          <div className="space-y-2">
                            {rows.map(([label, val]) => (
                              <div key={label} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-sm text-gray-600">{metricLabel(label)}</span>
                                  <span className="text-xs text-gray-500">· {unitForMetric(label)}</span>
                                </div>
                                <span className="text-sm font-semibold">{Number.isFinite(Number(val)) ? Number(val) : "--"} <span className="text-xs text-gray-500">{unitForMetric(label)}</span></span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Weather Conditions (from API) */}
                    {(() => {
                      const r = getLatestForDevice(selected?.deviceId)
                      const windDir = Number(r?.windDir)
                      const windDeg = Number.isFinite(windDir) ? Math.round(windDir) : undefined
                      return (
                        <div>
                          <div className="text-sm font-semibold mb-2">Weather Conditions</div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Temperature</span>
                              <span className="text-sm font-semibold">{r?.airTemperature ?? "--"} <span className="text-xs text-gray-500">°C</span></span>
                            </div>
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Humidity</span>
                              <span className="text-sm font-semibold">{r?.airHumidity ?? "--"} <span className="text-xs text-gray-500">%</span></span>
                            </div>
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Pressure</span>
                              <span className="text-sm font-semibold">{r?.atmosPressure ?? "--"} <span className="text-xs text-gray-500">hPa</span></span>
                            </div>
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Wind Speed</span>
                              <span className="text-sm font-semibold">{r?.windSpeed ?? "--"} <span className="text-xs text-gray-500">m/s</span></span>
                            </div>
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Wind Direction</span>
                              <span className="text-sm font-semibold flex items-center gap-1">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-blue-500">
                                  <path d="M12 2l-8 8h6v8h4v-8h6l-8-8z" fill="currentColor"/>
                                </svg>
                                {windDeg ?? "--"} <span className="text-xs text-gray-500">°</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Monitoring Device */}
                    <div>
                      <div className="text-sm font-semibold mb-2">Monitoring Device</div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                        <div>
                          <div className="text-sm font-semibold">AeroPure IndusEsp</div>
                          <button className="text-xs text-blue-600 underline">LearnMore</button>
                        </div>
                        <div className="w-16 h-12 rounded bg-gray-300 flex items-center justify-center">
                          <svg width="24" height="16" viewBox="0 0 24 16" fill="none" className="text-gray-600">
                            <rect x="2" y="2" width="20" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                            <rect x="6" y="5" width="12" height="1" fill="currentColor"/>
                            <rect x="6" y="7" width="8" height="1" fill="currentColor"/>
                            <rect x="6" y="9" width="10" height="1" fill="currentColor"/>
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Maintenance History */}
                    <div>
                      <div className="text-sm font-semibold mb-2">Maintenance History</div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Uptime:</span>
                          <span className="font-semibold">99.2%</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Last Service:</span>
                          <span className="font-semibold">3 days ago</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Total Time:</span>
                          <span className="font-semibold">2,847 hrs</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Next Service:</span>
                          <span className="font-semibold text-blue-600">In 27 days</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : selectedAsset ? (
                  <div className="space-y-4">
                    <div className="pt-2">
                      <div className="flex items-start gap-2 mb-1">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 text-green-600">
                          <path d="M12 2v3M18.364 5.636l-2.121 2.121M21 12h-3M18.364 18.364l-2.121-2.121M12 21v-3M5.636 18.364l2.121-2.121M3 12h3M5.636 5.636l2.121 2.121" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <div>
                          <div className="text-sm font-semibold">{selectedAsset.name}</div>
                          <div className="text-xs text-muted-foreground">{selectedAsset.location || ""}</div>
                        </div>
                      </div>
                    </div>

                    {/* Asset Details */}
                    <div>
                      <div className="text-sm font-semibold mb-2">Asset Details</div>
                      <div className="space-y-2">
                        {selectedAsset.type ? (
                          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                            <span className="text-sm text-gray-600">Type</span>
                            <span className="text-sm font-semibold">{selectedAsset.type}</span>
                          </div>
                        ) : null}
                        {/* {selectedAsset.efficiency ? (
                          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                            <span className="text-sm text-gray-600">Efficiency</span>
                            <span className="text-sm font-semibold">{selectedAsset.efficiency}%</span>
                          </div>
                        ) : null} */}
                        <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                          <span className="text-sm text-gray-600">Coordinates</span>
                          <span className="text-sm font-semibold">{selectedAsset.lat.toFixed(4)}, {selectedAsset.lng.toFixed(4)}</span>
                        </div>
                      </div>
                    </div>

                    {/* AQI from API */}
                    {(() => {
                      const r = getLatestForDevice(selectedAsset?.deviceId)
                      const aqi = Number(r?.airQualityIndex ?? NaN)
                      const category = aqi <= 50 ? { label: "Good", cls: "bg-emerald-200 text-emerald-800" } : aqi <= 100 ? { label: "Moderate", cls: "bg-amber-200 text-amber-900" } : { label: "Unhealthy", cls: "bg-red-200 text-red-800" }
                      return (
                        <div>
                          <div className="text-sm font-semibold mb-2">Air Quality Index</div>
                          <div className="rounded-xl bg-gradient-to-r from-orange-50 to-yellow-50 p-4 border border-orange-200">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-orange-200 flex items-center justify-center">
                                <div className="w-10 h-10 rounded-full bg-orange-300 flex items-center justify-center">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-orange-700">
                                    <circle cx="12" cy="8" r="4" fill="currentColor"/>
                                    <path d="M12 12v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                    <path d="M8 16h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                  </svg>
                                </div>
                              </div>
                              <div className="flex-1">
                                <div className="text-2xl font-bold text-orange-700">{Number.isFinite(aqi) ? aqi : "--"}</div>
                                <div className={`text-xs px-2 py-0.5 rounded-full inline-block ${category.cls}`}>
                                  {Number.isFinite(aqi) ? category.label : "No Data"}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Pollutants from API */}
                    {(() => {
                      const r = getLatestForDevice(selectedAsset?.deviceId)
                      const rows: Array<[string, number | undefined]> = [
                        ["PM2.5", r?.valuePM_2_5 as any],
                        ["PM10", r?.valuePM_10 as any],
                        ["CO", r?.valueCO as any],
                        ["SO2", r?.valueSO2 as any],
                        ["NO2", r?.valueNO2 as any],
                        ["O3", r?.valueO3 as any],
                      ]
                      return (
                        <div>
                          <div className="text-sm font-semibold mb-2">Pollutants</div>
                          <div className="space-y-2">
                            {rows.map(([label, val]) => (
                              <div key={label} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-sm text-gray-600">{metricLabel(label)}</span>
                                  <span className="text-xs text-gray-500">· {unitForMetric(label)}</span>
                                </div>
                                <span className="text-sm font-semibold">{Number.isFinite(Number(val)) ? Number(val) : "--"} <span className="text-xs text-gray-500">{unitForMetric(label)}</span></span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Weather from API */}
                    {(() => {
                      const r = getLatestForDevice(selectedAsset?.deviceId)
                      const windDir = Number(r?.windDir)
                      const windDeg = Number.isFinite(windDir) ? Math.round(windDir) : undefined
                      return (
                        <div>
                          <div className="text-sm font-semibold mb-2">Weather Conditions</div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Temperature</span>
                              <span className="text-sm font-semibold">{r?.airTemperature ?? "--"} <span className="text-xs text-gray-500">°C</span></span>
                            </div>
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Humidity</span>
                              <span className="text-sm font-semibold">{r?.airHumidity ?? "--"} <span className="text-xs text-gray-500">%</span></span>
                            </div>
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Pressure</span>
                              <span className="text-sm font-semibold">{r?.atmosPressure ?? "--"} <span className="text-xs text-gray-500">hPa</span></span>
                            </div>
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Wind Speed</span>
                              <span className="text-sm font-semibold">{r?.windSpeed ?? "--"} <span className="text-xs text-gray-500">m/s</span></span>
                            </div>
                            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm text-gray-600">Wind Direction</span>
                              <span className="text-sm font-semibold flex items-center gap-1">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-blue-500">
                                  <path d="M12 2l-8 8h6v8h4v-8h6l-8-8z" fill="currentColor"/>
                                </svg>
                                {windDeg ?? "--"} <span className="text-xs text-gray-500">°</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {selectedAsset.images?.length ? (
                      <div>
                        <div className="text-sm font-semibold mb-2">Images</div>
                        <div className="flex gap-2">
                          {selectedAsset.images.slice(0, 3).map((src, i) => (
                            <div key={i} className="w-20 h-14 rounded bg-gray-200 overflow-hidden">
                              <img src={src} alt="asset" className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Select a marker to view details.</div>
                )}
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-background/80 px-2 py-1 text-xs shadow">
              Loading devices…
            </div>
          ) : null}
          </AeropureMap>
        </div>
      </div>
    </div>
  )
}

function standardThumb() {
  return (
    <svg width="28" height="18" viewBox="0 0 28 18" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="18" rx="3" fill="#e2e8f0" />
      <path d="M2 9h24" stroke="#a3a3a3" strokeWidth="1" />
      <path d="M10 2v14" stroke="#a3a3a3" strokeWidth="1" />
      <path d="M6 4h10" stroke="#8b5cf6" strokeWidth="1.5" />
    </svg>
  )
}

function satelliteThumb() {
  return (
    <svg width="28" height="18" viewBox="0 0 28 18" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="18" rx="3" fill="#3f3f46" />
      <circle cx="7" cy="6" r="2" fill="#22c55e" />
      <rect x="12" y="3" width="10" height="5" fill="#71717a" />
      <rect x="3" y="10" width="8" height="5" fill="#52525b" />
    </svg>
  )
}

function terrainThumb() {
  return (
    <svg width="28" height="18" viewBox="0 0 28 18" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="18" rx="3" fill="#d9f99d" />
      <path d="M2 14l6-6 4 3 6-7 8 10" stroke="#166534" strokeWidth="1.5" fill="none" />
    </svg>
  )
}

function transitThumb() {
  return (
    <svg width="28" height="18" viewBox="0 0 28 18" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="18" rx="3" fill="#e2e8f0" />
      <path d="M2 6h24" stroke="#0ea5e9" strokeWidth="2" />
      <path d="M6 12h16" stroke="#f97316" strokeWidth="2" />
    </svg>
  )
}

function aqiChip(aqi: number) {
  const cls = aqi <= 50 ? "bg-green-500 text-white" : aqi <= 100 ? "bg-amber-400 text-black" : "bg-red-500 text-white"
  return { className: cls }
}

// function efficiencyChip(eff?: number) {
//   if (!Number.isFinite(eff)) return { className: "bg-gray-300 text-gray-700" }
//   // >=85 green, >=60 amber, else red
//   const cls = eff! >= 85 ? "bg-green-500 text-white" : eff! >= 60 ? "bg-amber-400 text-black" : "bg-red-500 text-white"
//   return { className: cls }
// }

// Simple deterministic AQI for demo 
function seededAqi(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997
  return 40 + (h % 80)
}
