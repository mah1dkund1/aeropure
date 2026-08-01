"use client"
import { useMemo, useRef, useState, useEffect } from "react"
import { useIsMobile } from '@/hooks/use-mobile'
import { GoogleMap, HeatmapLayer, OverlayView, Marker, MarkerClusterer, Polyline, useJsApiLoader, Circle } from "@react-google-maps/api"
import type { DemoDevice } from "@/lib/demo-data"
import type { AssetMarker } from "@/lib/iot-types"
import type { HeatPoint } from "@/lib/heatmap-utils"
import { aqiToColor, calculateElongation, metersToLatDegrees, metersToLngDegrees, windFromToToDeg, bearingToAngleRad } from "@/lib/heatmap-utils"
import { USE_DUMMY_HEAT_DATA } from "@/lib/dummy-heat-data"

// Inform TS that google is prrovided by the Maps script at runtime
declare const google: any

const containerStyle = { width: "100%", height: "100%" }

// Windy API key for wind particles overlay (client-side). 
const WINDY_API_KEY = process.env.NEXT_PUBLIC_WINDY_API_KEY || ""

export type MapProps = {
  devices: DemoDevice[]
  heatmap?: boolean
  heatmapPoints?: HeatPoint[] // Dynamic heat map points
  heatmapPointsByBucket?: { green: HeatPoint[]; yellow: HeatPoint[]; orange: HeatPoint[]; red: HeatPoint[] }
  devicesWithAqi?: Array<{ deviceId: number; lat: number; lng: number; aqi: number; windSpeed: number; windDir: number; color: string; radius: number }>
  wind?: boolean
  windArrows?: boolean
  showLabels?: boolean
  apiKey?: string
  mapTypeId?: string
  onMapReady?: (map: google.maps.Map) => void
  onSelectDevice?: (device: DemoDevice) => void
  assets?: AssetMarker[]
  onSelectAsset?: (asset: AssetMarker) => void
  // Panel props
  openPanel?: "search" | "layers" | "station" | null
  onSetOpenPanel?: (panel: "search" | "layers" | "station" | null) => void
  children?: React.ReactNode
}

// Wrapper to prevent calling the Maps loader without an API key.

export function AeropureMap(props: MapProps) {
  const { apiKey } = props

  // If no API key, render a friendly placeholder and DO NOT mount the loader.
  if (!apiKey) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md border bg-muted">
        <div className="text-center">
          <div className="text-sm font-semibold">Google Maps unavailable</div>
          <div className="text-xs text-muted-foreground">Add a Maps API key in Settings to enable the map.</div>
          <div className="mt-2 text-xs">
            <a href="/settings" className="text-blue-600 hover:underline">Open Settings</a>
          </div>
        </div>
      </div>
    )
  }

  // Key is present: mount the inner component that uses the loader.
  return <AeropureMapInner {...props} />
}

function AeropureMapInner({ 
  devices, 
  heatmap,
  heatmapPoints,
  heatmapPointsByBucket,
  devicesWithAqi,
  wind, 
  windArrows, 
  showLabels, 
  apiKey, 
  mapTypeId,
  onMapReady, 
  onSelectDevice,
  assets,
  onSelectAsset,
  openPanel,
  onSetOpenPanel,
  children 
}: MapProps) {
  const isMobile = useIsMobile()
  const defaultCenter = useMemo(() => ({ lat: 31.5204, lng: 74.3587 }), []) // Lahore default center like screenshot
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey || "",
    // Keep loader options stable across renders; include visualization up-front.
    // Do NOT load 'places' to avoid legacy API error when Places isn't enabled.
    libraries: ["visualization"],
  })

  const [map, setMap] = useState<google.maps.Map | null>(null)
  // Track initial load completeness (idle fired) to avoid blank screen before first interaction
  const initialTilesReady = useRef<boolean>(false)
  const [hovered, setHovered] = useState<DemoDevice | null>(null)
  const [hoveredAsset, setHoveredAsset] = useState<AssetMarker | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const hoverTimeout = useRef<number | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  // Track if map has been initialized to prevent resetting user's position
  const mapInitialized = useRef<boolean>(false)
  // Windy overlay refs
  const windyContainerRef = useRef<HTMLDivElement | null>(null)
  const windyApiRef = useRef<any>(null)
  const windyListenerRef = useRef<any>(null)
  const zoomListenerRef = useRef<any>(null)
  const [mapZoom, setMapZoom] = useState<number>(11)
  // Heatmap layer refs for defensive teardown
  const hmGreenRef = useRef<any>(null)
  const hmYellowRef = useRef<any>(null)
  const hmOrangeRef = useRef<any>(null)
  const hmRedRef = useRef<any>(null)
  const hmFallbackRef = useRef<any>(null)
  const heatmapLayersRef = useRef<any[]>([])
  // Track Circle overlays created for device heat zones so we can remove them on cleanup
  const circleRefs = useRef<any[]>([])
  // Map deviceId -> Circle instance for robust de-duplication
  const circleMapRef = useRef<Record<string, any>>({})

  //cleanup tracked circles and remove their listeners
  const cleanupTrackedCircles = () => {
    try {
      console.log('[cleanupTrackedCircles] Starting cleanup')
      if (Array.isArray(circleRefs.current) && circleRefs.current.length > 0) {
        console.log('[cleanupTrackedCircles] Removing', circleRefs.current.length, 'circles from circleRefs')
        circleRefs.current.forEach((c) => {
          try { c?.setMap(null) } catch {}
          try { google.maps.event.clearInstanceListeners(c) } catch {}
        })
        circleRefs.current.length = 0
      }
      // also remove any circles tracked by device id
      try {
        const m = circleMapRef.current || {}
        const keys = Object.keys(m)
        console.log('[cleanupTrackedCircles] Removing', keys.length, 'circles from circleMapRef:', keys)
        keys.forEach((k) => {
          try { m[k]?.setMap(null) } catch {}
          try { google.maps.event.clearInstanceListeners(m[k]) } catch {}
          try { delete m[k] } catch {}
        })
        try { circleMapRef.current = {} } catch {}
      } catch {}
      //also remove any extra canvas/gradient nodes
      try {
        const tryRemoveDom = () => {
          try {
            if (map && map.getDiv) {
              const mapDiv = map.getDiv()
              if (mapDiv && mapDiv.querySelectorAll) {
                const canvases = Array.from(mapDiv.getElementsByTagName('canvas'))
                console.log('[cleanupTrackedCircles] Removing', canvases.length, 'canvases')
                canvases.forEach((c) => { try { c.parentNode && c.parentNode.removeChild(c) } catch {} })
                const gradientNodes = Array.from(mapDiv.querySelectorAll('[style*="radial-gradient"],[style*="linear-gradient"],[style*="background-image"]'))
                console.log('[cleanupTrackedCircles] Removing', gradientNodes.length, 'gradient nodes')
                gradientNodes.forEach((n) => { try { n.parentNode && n.parentNode.removeChild(n) } catch {} })
                //also remove any orphaned SVG overlays that are not controls
                const svgs = Array.from(mapDiv.getElementsByTagName('svg'))
                console.log('[cleanupTrackedCircles] Found', svgs.length, 'SVGs')
                svgs.forEach((s) => {
                  try {
                    //skip only if it's clearly a control or marker
                    let el: HTMLElement | null = s as unknown as HTMLElement
                    let skip = false
                    for (let i = 0; i < 6 && el; i++) {
                      const cls = el.className && typeof el.className === 'string' ? el.className : ''
                      if (cls.includes('gmnoprint') || el.tagName === 'BUTTON' || el.tagName === 'DIV' && cls.includes('gm-')) { skip = true; break }
                      el = el.parentElement
                    }
                    if (!skip) {
                      //additional check: if it's an SVG with path elements that look like circles (no fill or specific attributes), remove it
                      const paths = s.querySelectorAll('path')
                      let isCircleLike = false
                      paths.forEach((p) => {
                        const d = p.getAttribute('d')
                        if (d && (d.includes('a') || d.includes('A'))) { // arc commands in path indicate circle/ellipse
                          isCircleLike = true
                        }
                      })
                      if (isCircleLike || paths.length > 0) { // assume any SVG with paths in overlay might be a circle
                        console.log('[cleanupTrackedCircles] Removing circle-like SVG:', s.outerHTML.substring(0, 100))
                        try { s.parentNode && s.parentNode.removeChild(s) } catch {}
                      }
                    }
                  } catch {}
                })
              }
            }
          } catch {}
        }
        //run immediate and schedule a couple retries to catch overlays recreated during render
        tryRemoveDom()
        setTimeout(tryRemoveDom, 120)
        setTimeout(tryRemoveDom, 500)
        // also clear any suppression and ensure no lingering registrations
        try { suppressOverlayRegistrationRef.current = false } catch {}
      } catch {}
    } catch (err) {
      console.debug('[HeatmapCleanup] cleanupTrackedCircles error', err)
    }
  }

  //circle visibility sync moved below where `heatmapEnabled` is declared.
  //use imperative heatmap management to avoid duplicate/react-mount issues.
  const USE_IMPERATIVE_HEATMAP = true
  const imperativeLayersRef = useRef<Record<string, any>>({})

  //determine whether assets are visible. keep this separate from heatmap control.
  const showAssets = Array.isArray(assets) && assets.length > 0
  //heatmap should be controlled solely by the `heatmap` toggle so that asset-type
  const heatmapEnabled = Boolean(heatmap)

  // sync any tracked Circle overlays visibility when the heatmap toggle changes.
  useEffect(() => {
    try {
      if (!Array.isArray(circleRefs.current) || circleRefs.current.length === 0) return
      circleRefs.current.forEach((c) => {
        try { if (typeof c.setVisible === 'function') c.setVisible(heatmapEnabled) } catch {}
      })
    } catch {}
  }, [heatmapEnabled])

  const ensureWindyLoaded = async () => {
    if (typeof window === "undefined") return
    if ((window as any).windyInit) return
    // Avoid duplicate script
    if (document.getElementById("windy-lib")) {
      // Give it a moment to finish booting
      await new Promise((res) => setTimeout(res, 50))
      return
    }
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script")
      s.id = "windy-lib"
      s.src = "https://api.windy.com/assets/map-forecast/libBoot.js"
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error("Failed to load Windy API"))
      document.body.appendChild(s)
    })
  }

  // Initialize Windy overlay on top of Google Map and sync view
  const initWindy = async () => {
    if (!windyContainerRef.current || !map) return
    
    // Destroy any existing instance first to prevent accumulation
    if (windyApiRef.current) {
      destroyWindy()
      // Wait a bit for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    await ensureWindyLoaded()
    const windyInit = (window as any).windyInit as Function | undefined
    if (!windyInit) return
    // Create unique container for windy
    const containerId = "windy-overlay"
    windyContainerRef.current.id = containerId
    windyContainerRef.current.style.display = 'block'

    return new Promise<void>((resolve) => {
      try {
        windyInit(
          {
            key: WINDY_API_KEY,
            container: containerId,
            lat: map.getCenter()?.lat() ?? 30.0,
            lon: map.getCenter()?.lng() ?? 70.0,
            zoom: Math.max(4, Math.min(12, map.getZoom() ?? 6)),
            overlay: "wind",
          },
          (windyAPI: any) => {
            windyApiRef.current = windyAPI
            // Hide Windy base layers; we only want particles
            try {
              const root = windyContainerRef.current!
              const tilePane = root.querySelector('.leaflet-tile-pane') as HTMLElement
              if (tilePane) tilePane.style.display = 'none'
              const markerPane = root.querySelector('.leaflet-overlay-pane') as HTMLElement
              if (markerPane) markerPane.style.pointerEvents = 'none'
            } catch {}

            // Sync Windy view with Google Map
            const sync = () => {
              if (!map || !windyApiRef.current) return
              const c = map.getCenter()
              const z = map.getZoom()
              if (!c || z == null) return
              // Windy uses Leaflet zoom levels; keep within a reasonable range
              const targetZoom = Math.max(4, Math.min(12, z))
              try { windyApiRef.current.map.setView([c.lat(), c.lng()], targetZoom, { animate: false }) } catch {}
            }
            sync()
            // Listen on google map to keep in sync
            try {
              windyListenerRef.current = google.maps.event.addListener(map, 'idle', sync)
            } catch {}

            resolve()
          }
        )
      } catch {
        resolve()
      }
    })
  }

  const destroyWindy = () => {
    try {
      if (windyListenerRef.current) {
        google.maps.event.removeListener(windyListenerRef.current)
        windyListenerRef.current = null
      }
      if (windyApiRef.current?.map) {
        // Remove Leaflet map and all its layers
        try { 
          windyApiRef.current.map.eachLayer((layer: any) => {
            try { windyApiRef.current.map.removeLayer(layer) } catch {}
          })
          windyApiRef.current.map.remove() 
        } catch {}
      }
      windyApiRef.current = null
    } catch (e) {
      console.error('Error destroying Windy:', e)
    } finally {
      if (windyContainerRef.current) {
        // Hide immediately
        windyContainerRef.current.style.display = 'none'
        windyContainerRef.current.style.visibility = 'hidden'
        windyContainerRef.current.style.opacity = '0'
        
        // Clear all child elements
        while (windyContainerRef.current.firstChild) {
          windyContainerRef.current.removeChild(windyContainerRef.current.firstChild)
        }
        windyContainerRef.current.innerHTML = ""
        windyContainerRef.current.id = ""
        
        // Remove any canvas elements that might be lingering
        const canvases = windyContainerRef.current.querySelectorAll('canvas')
        canvases.forEach(canvas => {
          try { canvas.remove() } catch {}
        })
      }
    }
  }

  // Handle fullscreen toggle
  const toggleFullscreen = () => {
    if (!isFullscreen) {
      // Enter fullscreen
      if (mapContainerRef.current) {
        if (mapContainerRef.current.requestFullscreen) {
          mapContainerRef.current.requestFullscreen()
        } else if ((mapContainerRef.current as any).webkitRequestFullscreen) {
          ;(mapContainerRef.current as any).webkitRequestFullscreen()
        } else if ((mapContainerRef.current as any).msRequestFullscreen) {
          ;(mapContainerRef.current as any).msRequestFullscreen()
        }
      }
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen()
      } else if ((document as any).webkitExitFullscreen) {
        ;(document as any).webkitExitFullscreen()
      } else if ((document as any).msExitFullscreen) {
        ;(document as any).msExitFullscreen()
      }
    }
  }

  // Track if heatmap/wind has been initialized to avoid repositioning on data updates
  const heatmapInitialized = useRef<boolean>(false)
  const windInitialized = useRef<boolean>(false)
  // MutationObserver to aggressively remove map overlay nodes when heatmap is off
  const overlayObserverRef = useRef<MutationObserver | null>(null)
  // Suppress circle registration while we aggressively clean overlays
  const suppressOverlayRegistrationRef = useRef<boolean>(false)

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('msfullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('msfullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Handle initialization flags when heatmap/wind are toggled
  useEffect(() => {
    if (!map) return
    // If map not fully ready yet (idle not fired) defer logic
    if (!initialTilesReady.current) return
    
    // Mark as initialized when first enabled, but DON'T change zoom/position
    if (heatmap && !heatmapInitialized.current) {
      heatmapInitialized.current = true
    }
    
    if (wind && !windInitialized.current) {
      windInitialized.current = true
    }
    
    // Reset flags when both are turned off
    if (!heatmap && !wind && (heatmapInitialized.current || windInitialized.current)) {
      heatmapInitialized.current = false
      windInitialized.current = false
    }
    // Deliberately omit heatmapPoints and points from dependencies to prevent re-positioning on data updates
  }, [map, heatmap, wind])

  useEffect(() => {
    if (!map || initialTilesReady.current) return
    try {
      google.maps.event.addListenerOnce(map, 'idle', () => {
        initialTilesReady.current = true
        // In case center/zoom props were undefined, ensure current values are re-applied to avoid blank paint
        try {
          const c = map.getCenter()
          const z = map.getZoom()
          if (c) map.setCenter(c)
          if (z) map.setZoom(z)
          google.maps.event.trigger(map, 'resize')
        } catch {}
      })
    } catch {}
  }, [map])

  // No longer need map event listeners for cleanup since circles are managed imperatively

  // Mount/Unmount Windy particles when wind is toggled
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (wind) {
        // Show container before initializing
        if (windyContainerRef.current) {
          windyContainerRef.current.style.display = 'block'
          windyContainerRef.current.style.visibility = 'visible'
          windyContainerRef.current.style.opacity = '1'
        }
        await initWindy()
        if (cancelled) {
          destroyWindy()
          return
        }
      } else {
        // Immediately hide and destroy
        if (windyContainerRef.current) {
          windyContainerRef.current.style.display = 'none'
          windyContainerRef.current.style.visibility = 'hidden'
          windyContainerRef.current.style.opacity = '0'
        }
        destroyWindy()
      }
    })()
    return () => {
      cancelled = true
      // Always clean up on unmount
      destroyWindy()
    }
  }, [wind])

  // Generate broad city coverage points across major Pakistani cities
  const genCityHeatPoints = () => {
    const cities = [
      { lat: 24.8607, lng: 67.0011, radiusKm: 40 }, // Karachi
      { lat: 31.5204, lng: 74.3587, radiusKm: 30 }, // Lahore
      { lat: 33.6844, lng: 73.0479, radiusKm: 25 }, // Islamabad
      { lat: 33.5651, lng: 73.0169, radiusKm: 25 }, // Rawalpindi
      { lat: 31.4180, lng: 73.0791, radiusKm: 26 }, // Faisalabad
      { lat: 30.1978, lng: 71.4711, radiusKm: 26 }, // Multan
      { lat: 34.0151, lng: 71.5249, radiusKm: 25 }, // Peshawar
      { lat: 30.1798, lng: 66.9750, radiusKm: 24 }, // Quetta
      { lat: 25.3960, lng: 68.3578, radiusKm: 24 }, // Hyderabad
      { lat: 32.1877, lng: 74.1945, radiusKm: 22 }, // Gujranwala
      { lat: 32.4945, lng: 74.5229, radiusKm: 20 }, // Sialkot
      { lat: 27.7052, lng: 68.8574, radiusKm: 20 }, // Sukkur
      { lat: 29.3956, lng: 71.6836, radiusKm: 22 }, // Bahawalpur
    ]
    const kmToLatDeg = (km: number) => km / 110.574
    const kmToLngDeg = (km: number, lat: number) => km / (111.320 * Math.cos((lat * Math.PI) / 180))
    const havKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371
      const dLat = ((lat2 - lat1) * Math.PI) / 180
      const dLon = ((lon2 - lon1) * Math.PI) / 180
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    }
    const all: Array<{ location: any; weight: number }> = []
    for (const c of cities) {
      const stepKm = 5
      const latStep = kmToLatDeg(stepKm)
      const lngStep = kmToLngDeg(stepKm, c.lat)
      const latR = kmToLatDeg(c.radiusKm)
      const lngR = kmToLngDeg(c.radiusKm, c.lat)
      const sigma = c.radiusKm * 0.5
      for (let lat = c.lat - latR; lat <= c.lat + latR; lat += latStep) {
        for (let lng = c.lng - lngR; lng <= c.lng + lngR; lng += lngStep) {
          const d = havKm(lat, lng, c.lat, c.lng)
          if (d <= c.radiusKm) {
            const gaussian = Math.exp(-(d*d)/(2*sigma*sigma))
            const weight = 0.4 + 1.6 * gaussian
            all.push({ location: new google.maps.LatLng(lat, lng), weight })
          }
        }
      }
    }
    return all
  }

  // Use dynamic heat map points if available, otherwise fallback to city coverage
  const points = useMemo(() => {
    //compute heatmap points when the heatmap toggle is ON. 
    if (!heatmap) return [] as any[]

    //use only the provided dynamic heatmap points..
    if (heatmapPoints && heatmapPoints.length > 0) {
      if (typeof google !== 'undefined' && google?.maps?.LatLng) {
        return heatmapPoints.map(p => ({
          location: new google.maps.LatLng(p.location.lat, p.location.lng),
          weight: p.weight
        }))
      }
      return heatmapPoints
    }

    
    return [] as any[]
  }, [heatmap, heatmapPoints, mapZoom])

  // Convert bucketed points to LatLng for multiple layers rendering
  const bucketPoints = useMemo(() => {
    if (!heatmap || !heatmapPointsByBucket) return null as null | {
      green: any[]; yellow: any[]; orange: any[]; red: any[]
    }
    const convert = (arr: HeatPoint[]) => {
      let filtered = arr
      // If zoomed out, clamp to Pakistan bounds to avoid sprawling heatmap points
      const PAK_BOUNDS = { south: 23.0, north: 37.5, west: 60.0, east: 78.0 }
      if ((mapZoom ?? 0) < 7) {
        filtered = arr.filter(p => p.location.lat >= PAK_BOUNDS.south && p.location.lat <= PAK_BOUNDS.north && p.location.lng >= PAK_BOUNDS.west && p.location.lng <= PAK_BOUNDS.east)
      }
      if (typeof google !== 'undefined' && google?.maps?.LatLng) {
        return filtered.map(p => ({
          location: new google.maps.LatLng(p.location.lat, p.location.lng),
          weight: p.weight
        }))
      }
      return filtered as any[]
    }
    return {
      green: convert(heatmapPointsByBucket.green || []),
      yellow: convert(heatmapPointsByBucket.yellow || []),
      orange: convert(heatmapPointsByBucket.orange || []),
      red: convert(heatmapPointsByBucket.red || []),
    }
  }, [heatmap, heatmapPointsByBucket, mapZoom])

  // Compute heatmap radius in pixels such that the displayed radius corresponds to
  // approximately `desiredMeters` on the ground regardless of zoom level.
  const heatmapRadiusPx = useMemo(() => {
    const desiredMeters = 2000 // target footprint in meters for device spread
    const zoom = Math.max(1, Math.round(mapZoom || 11))
    const lat = defaultCenter?.lat ?? 31.52
    const metersPerPixel = 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, zoom)
    const px = Math.max(6, Math.round(desiredMeters / Math.max(1e-6, metersPerPixel)))
    // Clamp to reasonable pixel sizes to avoid extremely large/small radii
    return Math.min(180, px)
  }, [defaultCenter, mapZoom])

  const heatmapOptions = useMemo(() => ({
    radius: heatmapRadiusPx,
    dissipating: true,
    opacity: 0.6,
    gradient: [
      "rgba(34, 197, 94, 0)",
      "rgba(34, 197, 94, 0.4)",
      "rgba(34, 197, 94, 1)",
      "rgba(245, 158, 11, 1)",
      "rgba(251, 146, 60, 1)",
      "rgba(239, 68, 68, 1)",
    ],
  }), [heatmapRadiusPx])

  // Marker clusterer options: use a blue circular SVG as the cluster icon and enable zoom-on-click
  const clusterOptions = useMemo(() => {
    // Simple blue circle SVG used as background; MarkerClusterer will draw the count text over it
    const svg = `<?xml version='1.0' encoding='UTF-8'?><svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><circle cx='32' cy='32' r='30' fill='%23066bff' /><circle cx='32' cy='32' r='30' fill='rgba(6,107,255,0.12)'/></svg>`
    const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
    return {
      styles: [
        {
          url,
          height: 48,
          width: 48,
          textColor: '#ffffff',
          textSize: 14,
          anchorText: [0, 0],
        },
      ],
      zoomOnClick: true,
      maxZoom: 15,
      gridSize: 60,
      averageCenter: true,
    }
  }, [])

  // Per-bucket gradients: edges should be red; center should be device bucket color.
  const bucketGradients = useMemo(() => ({
    // Low weights (edges) map to first color; high weights (centers) to last color
    green: [
      "rgba(239, 68, 68, 0)",    // Transparent red (far edges)
      "rgba(239, 68, 68, 0.35)", // Soft red
      "rgba(251, 146, 60, 0.7)", // Orange
      "rgba(245, 158, 11, 1)",   // Yellow
      "rgba(34, 197, 94, 1)",    // Green (center)
    ],
    yellow: [
      "rgba(239, 68, 68, 0)",    // Transparent red (far edges)
      "rgba(239, 68, 68, 0.4)",  // Soft red
      "rgba(251, 146, 60, 0.85)",// Orange
      "rgba(245, 158, 11, 1)",   // Yellow (center)
    ],
    orange: [
      "rgba(239, 68, 68, 0)",    // Transparent red (far edges)
      "rgba(239, 68, 68, 0.6)",  // Red
      "rgba(251, 146, 60, 1)",   // Orange (center)
    ],
    red: [
      "rgba(239, 68, 68, 0)",    // Transparent red (far edges)
      "rgba(239, 68, 68, 1)",    // Red (center)
    ],
  }), [])

  // if heatmap effectively toggles off , forcefully detach any existing heatmap overlays. This keeps the map
  // stable and prevents the HeatmapLayer from being remounted repeatedly when toggling types.
  useEffect(() => {
    console.log('[HeatmapToggle] heatmap changed to:', heatmap)
    // When the heatmap toggle changes, defensively remove any orphaned Circle overlays
    // to avoid duplicate circles when toggling heatmap back on.
    try {
      if (Array.isArray(circleRefs.current) && circleRefs.current.length > 0) {
        circleRefs.current.forEach((c) => {
          try { c?.setMap(null) } catch {}
          try { google.maps.event.clearInstanceListeners(c) } catch {}
        })
        circleRefs.current.length = 0
      }
      // also clear per-device map
      try {
        const m = circleMapRef.current || {}
        Object.keys(m).forEach((k) => {
          try { m[k]?.setMap(null) } catch {}
          try { google.maps.event.clearInstanceListeners(m[k]) } catch {}
          try { delete m[k] } catch {}
        })
      } catch {}
    } catch (err) {
      console.debug('[HeatmapCleanup] pre-toggle Circle cleanup error', err)
    }

    // do not react to asset list changes here,asset-type filters should not control
    // whether the heatmap exists. When the heatmap toggle is turned OFF, forcefully remove any existing heatmap overlays.
    if (!heatmap) {
      try {
        // mark suppression to avoid re-registering circles while we remove overlays
        try { suppressOverlayRegistrationRef.current = true } catch {}
        // Immediately clear circleMapRef to prevent any race conditions during cleanup
        try { circleMapRef.current = {} } catch {}
        // First clear any known per-bucket refs
        try { if (hmGreenRef.current) { hmGreenRef.current.setMap(null); google.maps.event.clearInstanceListeners(hmGreenRef.current); } } catch {}
        try { if (hmYellowRef.current) { hmYellowRef.current.setMap(null); google.maps.event.clearInstanceListeners(hmYellowRef.current); } } catch {}
        try { if (hmOrangeRef.current) { hmOrangeRef.current.setMap(null); google.maps.event.clearInstanceListeners(hmOrangeRef.current); } } catch {}
        try { if (hmRedRef.current) { hmRedRef.current.setMap(null); google.maps.event.clearInstanceListeners(hmRedRef.current); } } catch {}
        try { if (hmFallbackRef.current) { hmFallbackRef.current.setMap(null); google.maps.event.clearInstanceListeners(hmFallbackRef.current); } } catch {}

        // Then remove and clear any layers we tracked in the array
        if (Array.isArray(heatmapLayersRef.current) && heatmapLayersRef.current.length > 0) {
          heatmapLayersRef.current.forEach((l) => {
            try { l?.setMap(null) } catch {}
            try { google.maps.event.clearInstanceListeners(l) } catch {}
          })
          heatmapLayersRef.current.length = 0
        }
        // Also remove any imperative layers we may have created
        try {
          const imp = imperativeLayersRef.current || {}
          Object.keys(imp).forEach((k) => {
            try { imp[k]?.setMap(null) } catch {}
            try { google.maps.event.clearInstanceListeners(imp[k]) } catch {}
            try { delete imp[k] } catch {}
          })
        } catch {}

        // Remove any Circle overlays that were created for device heat zones
        try {
          if (Array.isArray(circleRefs.current) && circleRefs.current.length > 0) {
            circleRefs.current.forEach((c) => {
              try { c?.setMap(null) } catch {}
              try { google.maps.event.clearInstanceListeners(c) } catch {}
            })
            circleRefs.current.length = 0
          }
        } catch (err) {
          console.debug('[HeatmapCleanup] Circle cleanup error', err)
        }

        // aggressively remove any lingering canvas/gradient overlays from the DOM
        if (map && map.getDiv) {
          try {
            const mapDiv = map.getDiv();
            if (mapDiv && mapDiv.querySelectorAll) {
              const beforeCanvases = Array.from(mapDiv.getElementsByTagName('canvas'))
              const beforeCount = beforeCanvases.length
              // Remove canvases (heatmap often renders to a canvas)
              beforeCanvases.forEach((c) => {
                try { c.parentNode && c.parentNode.removeChild(c) } catch {}
              })

              // Remove nodes with inline gradient/background-image styles that could be heatmap overlays
              const gradientNodes = Array.from(mapDiv.querySelectorAll('[style*=\"radial-gradient\"],[style*=\"linear-gradient\"],[style*=\"background-image\"]'))
              const gradCount = gradientNodes.length
              gradientNodes.forEach((n) => {
                try { n.parentNode && n.parentNode.removeChild(n) } catch {}
              })

              const afterCanvases = Array.from(mapDiv.getElementsByTagName('canvas'))
              console.debug('[HeatmapCleanup] canvases removed before:', beforeCount, 'after:', afterCanvases.length, 'gradients removed:', gradCount)
            }
          } catch (err) {
            console.debug('[HeatmapCleanup] DOM removal error', err)
          }
        }
        // Install a MutationObserver to catch any canvases/SVGs that are re-created
        // by Google Maps during zoom/pan while heatmap is off. Keep a reference so
        // we can disconnect it when heatmap is toggled back on.
        try {
          if (map && map.getDiv && !overlayObserverRef.current) {
            try { suppressOverlayRegistrationRef.current = true } catch {}
            const container = map.getDiv()
            const obs = new MutationObserver((mutations) => {
              try {
                mutations.forEach((m) => {
                  if (!m.addedNodes || m.addedNodes.length === 0) return
                  m.addedNodes.forEach((n) => {
                    try {
                      if (!(n instanceof HTMLElement)) return
                      if (n.tagName === 'CANVAS' || n.tagName === 'SVG') {
                        let el: HTMLElement | null = n as HTMLElement
                        let skip = false
                        for (let i = 0; i < 6 && el; i++) {
                          const cls = el.className && typeof el.className === 'string' ? el.className : ''
                          if (cls.includes('gmnoprint') || el.tagName === 'BUTTON' || (el.tagName === 'DIV' && cls.includes('gm-'))) { skip = true; break }
                          el = el.parentElement
                        }
                        if (!skip) {
                          try { n.parentNode && n.parentNode.removeChild(n) } catch {}
                        }
                      }
                    } catch {}
                  })
                })
              } catch {}
            })
            try { obs.observe(container, { childList: true, subtree: true }) } catch {}
            overlayObserverRef.current = obs
          }
        } catch {}
      } catch (err) {
        // swallow — cleanup best-effort
      }
      // keep observer active until heatmap toggles back on
      return () => {
        try { if (overlayObserverRef.current) overlayObserverRef.current.disconnect() } catch {}
        overlayObserverRef.current = null
        try { suppressOverlayRegistrationRef.current = false } catch {}
      }
    }
    // Do NOT run aggressive cleanup when heatmap is ON – it can
    // accidentally clear freshly created heatmap layers. Only clean
    // up tracked circles when heatmap is OFF.
    if (!heatmap) {
      cleanupTrackedCircles()
    }
  }, [heatmap])

  // Ensure any heatmap overlay is fully removed when unmounted
  const handleHeatmapUnmount = (layer: any) => {
    try {
      console.debug('[Heatmap] onUnmount called for layer', layer)
      if (layer && layer.setMap) {
        try { layer.setMap(null) } catch {}
      }
    } catch (err) {
      console.debug('[Heatmap] onUnmount error', err)
    }
    try {
      const i = heatmapLayersRef.current.indexOf(layer)
      if (i >= 0) heatmapLayersRef.current.splice(i, 1)
      console.debug('[Heatmap] removed layer from tracker, remaining:', heatmapLayersRef.current.length)
    } catch (err) {
      console.debug('[Heatmap] remove-from-tracker error', err)
    }
  }

  // Imperative circle manager: create/destroy Circle instances directly to prevent unwanted re-renders
  useEffect(() => {
    if (typeof google === 'undefined' || !google?.maps) return
    if (!map) return

    // Clear all existing circles first
    const clearAllCircles = () => {
      circleRefs.current.forEach((c) => {
        try { c.setMap(null) } catch {}
        try { google.maps.event.clearInstanceListeners(c) } catch {}
      })
      circleRefs.current = []
      Object.keys(circleMapRef.current).forEach((k) => {
        try { circleMapRef.current[k]?.setMap(null) } catch {}
        try { google.maps.event.clearInstanceListeners(circleMapRef.current[k]) } catch {}
        delete circleMapRef.current[k]
      })
    }

    clearAllCircles()

    // Store devicesWithAqi globally for getAssetIcon to access
    if (devicesWithAqi && devicesWithAqi.length > 0) {
      (window as any).__devicesWithAqi = devicesWithAqi
    }

    // Only create circles if heatmap is explicitly enabled
    if (heatmap && devicesWithAqi && devicesWithAqi.length > 0) {
      console.log('[ImperativeCircles] Creating', devicesWithAqi.length, 'circles')
      devicesWithAqi.forEach((device) => {
        try {
          const circle = new google.maps.Circle({
            center: { lat: device.lat, lng: device.lng },
            radius: device.radius,
            strokeColor: device.color,
            strokeOpacity: 0.4,
            strokeWeight: 2,
            fillColor: device.color,
            fillOpacity: 0.08,
            clickable: false,
            zIndex: 1,
            map: map
          })
          
          const id = String(device.deviceId ?? `${device.lat}:${device.lng}`)
          circleMapRef.current[id] = circle
          circleRefs.current.push(circle)
        } catch (err) {
          console.debug('[ImperativeCircles] Failed to create circle:', err)
        }
      })
    }

    // Cleanup function: remove all circles when effect re-runs or component unmounts
    return () => {
      clearAllCircles()
    }
  }, [map, heatmap, devicesWithAqi])

  // Imperative heatmap manager: create/destroy HeatmapLayer instances directly
  useEffect(() => {
    if (!USE_IMPERATIVE_HEATMAP) return
    if (typeof google === 'undefined' || !google?.maps || !google?.maps?.visualization) return
    if (!map) return

    const ensureLayer = (key: string, data: any[], options?: any) => {
      try {
        const existing = imperativeLayersRef.current[key]
        if (existing) {
          // update data if setData exists
          try { if (typeof existing.setData === 'function') existing.setData(data) } catch {}
          try { if (typeof existing.setOptions === 'function') existing.setOptions(options || {}) } catch {}
          // ensure it's on the map
          try { existing.setMap(map) } catch {}
          return existing
        }
        // create a new layer
        const layerOpts = Object.assign({ data: data || [], map }, options || {})
        const layer = new google.maps.visualization.HeatmapLayer(layerOpts)
        imperativeLayersRef.current[key] = layer
        return layer
      } catch (err) {
        console.debug('[HeatmapImperative] ensureLayer error', key, err)
        return null
      }
    }

    const removeAllImperative = () => {
      try {
        Object.keys(imperativeLayersRef.current).forEach((k) => {
          try { imperativeLayersRef.current[k].setMap(null) } catch {}
          try { google.maps.event.clearInstanceListeners(imperativeLayersRef.current[k]) } catch {}
          delete imperativeLayersRef.current[k]
        })
      } catch (err) { console.debug('[HeatmapImperative] removeAll error', err) }
    }

    if (!heatmap) {
      removeAllImperative()
      return
    }

    // Filter heatmap points to only include locations from devicesWithAqi (displayed assets)
    const filterPointsByDevices = (pointsArray: any[]) => {
      if (!devicesWithAqi || devicesWithAqi.length === 0) return []
      const deviceLocations = new Set(
        devicesWithAqi.map(d => `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`)
      )
      return pointsArray.filter(p => {
        const lat = p.location?.lat ? (typeof p.location.lat === 'function' ? p.location.lat() : p.location.lat) : 0
        const lng = p.location?.lng ? (typeof p.location.lng === 'function' ? p.location.lng() : p.location.lng) : 0
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
        return deviceLocations.has(key)
      })
    }

    // If bucketed points are available, create one layer per bucket; otherwise create a single layer from points
    if (bucketPoints) {
      try {
        ensureLayer('green', filterPointsByDevices(bucketPoints.green || []), { radius: heatmapRadiusPx, dissipating: true, opacity: 0.6, gradient: bucketGradients.green })
        ensureLayer('yellow', filterPointsByDevices(bucketPoints.yellow || []), { radius: heatmapRadiusPx, dissipating: true, opacity: 0.6, gradient: bucketGradients.yellow })
        ensureLayer('orange', filterPointsByDevices(bucketPoints.orange || []), { radius: heatmapRadiusPx, dissipating: true, opacity: 0.6, gradient: bucketGradients.orange })
        ensureLayer('red', filterPointsByDevices(bucketPoints.red || []), { radius: heatmapRadiusPx, dissipating: true, opacity: 0.6, gradient: bucketGradients.red })
      } catch (err) { console.debug('[HeatmapImperative] bucket ensure error', err) }
    } else if (points && points.length > 0) {
      try {
        ensureLayer('fallback', filterPointsByDevices(points), heatmapOptions)
      } catch (err) { console.debug('[HeatmapImperative] fallback ensure error', err) }
    }

    // Force a repaint so layers show immediately without user zoom
    if (heatmap && map) {
      try {
        const c = map.getCenter()
        const z = map.getZoom() ?? 11
        if (c) { try { map.setCenter(c) } catch {} }
        try { map.setZoom(z) } catch {}
        try { map.panBy(0, 0) } catch {}
        try { google.maps.event.trigger(map, 'resize') } catch {}
        try { google.maps.event.trigger(map, 'idle') } catch {}
        setTimeout(() => {
          try {
            const c2 = map.getCenter()
            const z2 = map.getZoom() ?? z
            if (c2) { try { map.setCenter(c2) } catch {} }
            try { map.setZoom(z2) } catch {}
            try { map.panBy(0, 0) } catch {}
            try { google.maps.event.trigger(map, 'resize') } catch {}
          } catch {}
        }, 150)
      } catch (err) {
        console.debug('[HeatmapImperative] immediate refresh error', err)
      }
    }

    // Trigger map refresh to ensure heatmap layers render immediately
    if (heatmap && map) {
      try {
        setTimeout(() => {
          google.maps.event.trigger(map, 'resize')
          google.maps.event.trigger(map, 'idle')
        }, 100)
      } catch (err) { console.debug('[HeatmapImperative] refresh error', err) }
    }

    return () => {
      // cleanup on effect tear-down
      removeAllImperative()
    }
  // depend on map, heatmap flag and core data only (avoid zoom/options-induced flicker)
  }, [map, heatmap, bucketPoints, points, devicesWithAqi])

  // Map options based on showLabels setting
  const mapOptions = useMemo(() => ({
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
    mapTypeId: mapTypeId || 'roadmap',
    zoomControl: true,
    gestureHandling: isFullscreen ? 'greedy' : 'cooperative',
    // Apply styles to hide labels when showLabels is FALSE (unchecked)
    styles: !showLabels ? [
      {
        featureType: "all",
        elementType: "labels",
        stylers: [{ visibility: "off" }]
      },
      {
        featureType: "poi",
        stylers: [{ visibility: "off" }]
      },
      {
        featureType: "transit",
        stylers: [{ visibility: "off" }]
      },
      {
        featureType: "road",
        elementType: "labels",
        stylers: [{ visibility: "off" }]
      }
    ] : [] // Empty array means default Google Maps styling with labels
  }), [showLabels, isFullscreen, mapTypeId])


  // Track zoom level to conditionally show small wind arrows only when zoomed in
  useEffect(() => {
    if (!map) return
    try {
      if (zoomListenerRef.current) {
        google.maps.event.removeListener(zoomListenerRef.current)
        zoomListenerRef.current = null
      }
      const l = google.maps.event.addListener(map, 'zoom_changed', () => {
        try { setMapZoom(map.getZoom() ?? 0) } catch {}
      })
      zoomListenerRef.current = l
      // Initialize state immediately
      setMapZoom(map.getZoom() ?? 0)
    } catch {}
    return () => {
      try {
        if (zoomListenerRef.current) {
          google.maps.event.removeListener(zoomListenerRef.current)
          zoomListenerRef.current = null
        }
      } catch {}
    }
  }, [map])

  // Compute hovered device's live reading (to show a Windy-like arrow only on hover when zoomed in)
  const hoveredReading = useMemo(() => {
    if (!hovered || !devicesWithAqi?.length) return null
    // Match by proximity (markers and readings share same lat/lng in generator)
    const match = devicesWithAqi.find(d => Math.abs(d.lat - hovered.lat) < 1e-4 && Math.abs(d.lng - hovered.lng) < 1e-4)
    return match || null
  }, [hovered, devicesWithAqi])
  const zoomOkForArrow = (mapZoom ?? 0) >= 13

  // Show a small arrow with every device when zoomed-in (only when heatmap is enabled)
  const deviceArrows = useMemo(() => {
    // Wind arrows permanently disabled
    return [] as Array<{
      path: Array<{ lat: number; lng: number }>
      scale: number
    }>
  }, [])
  // Use fallback particles only if wind is on but Windy overlay hasn't initialized yet
  const useFallbackParticles = wind && !windyApiRef.current
  const particles = useFallbackParticles ? makeWindParticles() : []

  return (
    <div 
      ref={mapContainerRef}
      className={`relative h-full w-full ${isFullscreen ? 'bg-black' : ''}`}
    >
      {/* Screenshot/overlay capture button - left side, always visible */}
      <div className="pointer-events-auto absolute left-3 top-14 z-30">
        <button
          aria-label="Capture map overlay"
          title="Capture map overlay"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border bg-background/90 shadow backdrop-blur hover:bg-muted"
          onClick={async () => {
            try {
              if (!map) {
                alert('Map not ready. Please try again.')
                return
              }

              // Get the map div
              const mapDiv = map.getDiv()
              if (!mapDiv) {
                alert('Map canvas not found. Please try again.')
                return
              }

              // Wait a moment for any pending tile loads
              await new Promise((resolve) => setTimeout(resolve, 300))

              // Dynamically import html2canvas
              const html2canvas = (await import('html2canvas')).default

              // Get the actual dimensions of the map
              const mapBounds = mapDiv.getBoundingClientRect()

              // Capture the map div with optimized settings for Google Maps
              const canvas = await html2canvas(mapDiv, ({
                useCORS: true,
                allowTaint: true,
                background: '#e5e7eb', // neutral gray fallback
                scale: window.devicePixelRatio || 1,
                logging: false,
                imageTimeout: 15000,
                ignoreElements: (element: Element) => {
                  // Ignore control buttons and overlays that shouldn't be in the screenshot
                  try {
                    const el = element as HTMLElement
                    if (el.classList.contains('gm-style-cc') || 
                        el.classList.contains('gm-bundled-control') ||
                        el.classList.contains('gmnoprint')) {
                      return true
                    }
                  } catch {}
                  return false
                },
                onclone: (clonedDoc: Document, clonedElement: HTMLElement) => {
                  // Force all Google Maps images to load with crossOrigin
                  const images = clonedElement.querySelectorAll('img')
                  images.forEach((img: HTMLImageElement) => {
                    if (img.src && !img.complete) {
                      img.crossOrigin = 'anonymous'
                    }
                  })
                }
              } as any))

              const dataUrl = canvas.toDataURL('image/png', 1.0)

              const id = `snap-${Date.now()}`
              ;(window as any).__AEROPURE_MAP_SNAPSHOTS = (window as any).__AEROPURE_MAP_SNAPSHOTS || []
              ;(window as any).__AEROPURE_MAP_SNAPSHOTS.push({ 
                id, 
                dataUrl, 
                name: `map-${new Date().toISOString().split('T')[0]}-${Date.now()}` 
              })

              // Trigger download
              const a = document.createElement('a')
              a.href = dataUrl
              a.download = `aeropure-map-${id}.png`
              document.body.appendChild(a)
              a.click()
              a.remove()

              console.log('[Map Capture] Successfully captured map')
              
              
            } catch (err) {
              console.error('[Map Capture] Screenshot failed:', err)
              alert('Screenshot failed. The map tiles may still be loading. Please wait a moment and try again.')
            }
          }}
        >
          {/* camera icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 7h4l2-3h6l2 3h4v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      {loadError ? (
        <div className="flex h-full w-full items-center justify-center rounded-md border bg-muted">
          <div className="text-center">
            <div className="text-sm font-semibold">Google Maps failed to load</div>
            <div className="text-xs text-muted-foreground">{String(loadError?.message || loadError)}</div>
            <div className="mt-2 text-xs">
              <button onClick={() => typeof window !== 'undefined' && window.location.reload()} className="text-blue-600 hover:underline">Retry</button>
            </div>
          </div>
        </div>
      ) : !isLoaded ? (
        <div className="h-full w-full animate-pulse rounded-md bg-muted" />
      ) : (
        <>
          {/* Windy wind particles overlay (always mounted; hidden when wind=false to avoid race conditions) */}
          <div
            ref={windyContainerRef}
            className="pointer-events-none absolute inset-0 z-10"
            aria-hidden="true"
            style={{ 
              display: wind ? 'block' : 'none',
              visibility: wind ? 'visible' : 'hidden',
              opacity: wind ? 1 : 0
            }}
          />
          <GoogleMap
            onLoad={(m) => {
              setMap(m)
              mapInitialized.current = true
              try {
                onMapReady && onMapReady(m)
              } catch {}
              // Expose map instance globally so other UI (like Export) can read center/zoom for server-side static map requests
              try {
                if (typeof window !== 'undefined') {
                  ;(window as any).__AEROPURE_MAP = m
                }
              } catch {}
              // Force tiles to load by triggering a resize event
              try {
                google.maps.event.trigger(m, 'resize')
              } catch {}
              // Nudge the camera very slightly to kick tile rendering on some browsers/keys
              try {
                const c = m.getCenter()
                const z = m.getZoom() ?? 11
                // use rAF to ensure map internal layout has completed
                requestAnimationFrame(() => {
                  try {
                    if (c) m.setCenter(c)
                    m.setZoom(z)
                    // tiny pan jiggle to force tiles in rare cases
                    m.panBy(0, 0)
                  } catch {}
                })
                // Also listen once for idle and then trigger another resize
                google.maps.event.addListenerOnce(m, 'idle', () => {
                  try { google.maps.event.trigger(m, 'resize') } catch {}
                })
              } catch {}
            }}
            mapContainerStyle={containerStyle}
            center={mapInitialized.current ? undefined : defaultCenter}
            zoom={mapInitialized.current ? undefined : 11}
            options={mapOptions}
          >
        {(!USE_IMPERATIVE_HEATMAP && heatmapEnabled && isLoaded) ? (
          bucketPoints && (
            <>
              {bucketPoints.green.length > 0 && (
                <HeatmapLayer
                  key={`hm-green-${bucketPoints.green.length}`}
                  data={bucketPoints.green}
                  options={{ radius: heatmapRadiusPx, dissipating: true, opacity: 0.6, gradient: bucketGradients.green }}
                  onLoad={(l) => {
                    try {
                      // If an older green layer exists, remove it to avoid duplicates
                      if (hmGreenRef.current && hmGreenRef.current !== l) {
                        try { hmGreenRef.current.setMap(null) } catch {}
                        try {
                          const idx = heatmapLayersRef.current.indexOf(hmGreenRef.current)
                          if (idx >= 0) heatmapLayersRef.current.splice(idx, 1)
                        } catch {}
                      }
                      hmGreenRef.current = l
                      if (!heatmapLayersRef.current.includes(l)) heatmapLayersRef.current.push(l)
                    } catch (err) { console.debug('[Heatmap] hm-green onLoad error', err) }
                  }}
                  onUnmount={handleHeatmapUnmount}
                />
              )}
              {bucketPoints.yellow.length > 0 && (
                <HeatmapLayer
                  key={`hm-yellow-${bucketPoints.yellow.length}`}
                  data={bucketPoints.yellow}
                  options={{ radius: heatmapRadiusPx, dissipating: true, opacity: 0.6, gradient: bucketGradients.yellow }}
                  onLoad={(l) => {
                    try {
                      if (hmYellowRef.current && hmYellowRef.current !== l) {
                        try { hmYellowRef.current.setMap(null) } catch {}
                        try {
                          const idx = heatmapLayersRef.current.indexOf(hmYellowRef.current)
                          if (idx >= 0) heatmapLayersRef.current.splice(idx, 1)
                        } catch {}
                      }
                      hmYellowRef.current = l
                      if (!heatmapLayersRef.current.includes(l)) heatmapLayersRef.current.push(l)
                    } catch (err) { console.debug('[Heatmap] hm-yellow onLoad error', err) }
                  }}
                  onUnmount={handleHeatmapUnmount}
                />
              )}
              {bucketPoints.orange.length > 0 && (
                <HeatmapLayer
                  key={`hm-orange-${bucketPoints.orange.length}`}
                  data={bucketPoints.orange}
                  options={{ radius: heatmapRadiusPx, dissipating: true, opacity: 0.6, gradient: bucketGradients.orange }}
                  onLoad={(l) => {
                    try {
                      if (hmOrangeRef.current && hmOrangeRef.current !== l) {
                        try { hmOrangeRef.current.setMap(null) } catch {}
                        try {
                          const idx = heatmapLayersRef.current.indexOf(hmOrangeRef.current)
                          if (idx >= 0) heatmapLayersRef.current.splice(idx, 1)
                        } catch {}
                      }
                      hmOrangeRef.current = l
                      if (!heatmapLayersRef.current.includes(l)) heatmapLayersRef.current.push(l)
                    } catch (err) { console.debug('[Heatmap] hm-orange onLoad error', err) }
                  }}
                  onUnmount={handleHeatmapUnmount}
                />
              )}
              {bucketPoints.red.length > 0 && (
                <HeatmapLayer
                  key={`hm-red-${bucketPoints.red.length}`}
                  data={bucketPoints.red}
                  options={{ radius: heatmapRadiusPx, dissipating: true, opacity: 0.6, gradient: bucketGradients.red }}
                  onLoad={(l) => {
                    try {
                      if (hmRedRef.current && hmRedRef.current !== l) {
                        try { hmRedRef.current.setMap(null) } catch {}
                        try {
                          const idx = heatmapLayersRef.current.indexOf(hmRedRef.current)
                          if (idx >= 0) heatmapLayersRef.current.splice(idx, 1)
                        } catch {}
                      }
                      hmRedRef.current = l
                      if (!heatmapLayersRef.current.includes(l)) heatmapLayersRef.current.push(l)
                    } catch (err) { console.debug('[Heatmap] hm-red onLoad error', err) }
                  }}
                  onUnmount={handleHeatmapUnmount}
                />
              )}
            </>
          )
          || (points.length > 0 ? (
                <HeatmapLayer
                  key={`hm-fallback-${points.length}`}
                  data={points}
                  options={heatmapOptions}
                  onLoad={(l) => {
                    try {
                      if (hmFallbackRef.current && hmFallbackRef.current !== l) {
                        try { hmFallbackRef.current.setMap(null) } catch {}
                        try {
                          const idx = heatmapLayersRef.current.indexOf(hmFallbackRef.current)
                          if (idx >= 0) heatmapLayersRef.current.splice(idx, 1)
                        } catch {}
                      }
                      hmFallbackRef.current = l
                      if (!heatmapLayersRef.current.includes(l)) heatmapLayersRef.current.push(l)
                    } catch (err) { console.debug('[Heatmap] hm-fallback onLoad error', err) }
                  }}
                  onUnmount={handleHeatmapUnmount}
                />
              ) : null)
        ) : null}

        {/* Device heat zone circles are now managed imperatively via useEffect, not declaratively rendered here */}

        {/* Devices cluster */}
        <MarkerClusterer options={clusterOptions as any}>
          {(clusterer) => (
            <>
              {devices.map((d) => {
                // Check if we have real-time AQI data for this device
                const deviceWithAqi = devicesWithAqi?.find(dwa => {
                  // Match by location since devices might not have deviceId
                  return Math.abs(dwa.lat - d.lat) < 0.0001 && Math.abs(dwa.lng - d.lng) < 0.0001
                })
                
                return (
                  <Marker
                    key={d.deviceName}
                    clusterer={clusterer}
                    position={{ lat: d.lat, lng: d.lng }}
                    title={`${d.deviceName} • ${d.pollutant} ${d.value}`}
                    icon={deviceWithAqi ? getMarkerIconWithAqi(d, deviceWithAqi.aqi, deviceWithAqi.color) : getMarkerIcon(d)}
                    onClick={() => {
                      try { onSelectDevice && onSelectDevice(d) } catch {}
                      // Also show info panel on tap/click (improves mobile usability)
                      setHovered(d)
                    }}
                    onMouseOver={() => {
                      if (hoverTimeout.current) window.clearTimeout(hoverTimeout.current)
                      setHovered(d)
                    }}
                    onMouseOut={() => {
                      if (hoverTimeout.current) window.clearTimeout(hoverTimeout.current)
                      hoverTimeout.current = window.setTimeout(() => setHovered((curr) => (curr?.deviceName === d.deviceName ? null : curr)), 150)
                    }}
                  />
                )
              })}
            </>
          )}
        </MarkerClusterer>

        {/* Assets cluster */}
        {assets && assets.length > 0 ? (
          <MarkerClusterer options={clusterOptions as any}>
            {(clusterer) => (
              <>
                {assets.map((a) => (
                  <Marker
                    key={a.id}
                    clusterer={clusterer}
                    position={{ lat: a.lat, lng: a.lng }}
                    title={`${a.name}${a.location ? " • " + a.location : ""}`}
                    icon={getAssetIcon(a, mapZoom)}
                    onClick={() => {
                      try { onSelectAsset && onSelectAsset(a) } catch {}
                      // Show asset info panel on tap/click
                      setHoveredAsset(a)
                      // On mobile, use double-click to open station panel to avoid multiple panels
                      try {
                        const now = Date.now()
                        ;(window as any).__AERO_LAST_ASSET_CLICK = (window as any).__AERO_LAST_ASSET_CLICK || {}
                        const last = (window as any).__AERO_LAST_ASSET_CLICK[a.id] || 0
                        if ((now - last) < 350) {
                          // detected double-click
                          if (onSetOpenPanel) onSetOpenPanel("station")
                        }
                        (window as any).__AERO_LAST_ASSET_CLICK[a.id] = now
                      } catch {}
                    }}
                    onMouseOver={() => {
                      if (hoverTimeout.current) window.clearTimeout(hoverTimeout.current)
                      setHoveredAsset(a)
                    }}
                    onMouseOut={() => {
                      if (hoverTimeout.current) window.clearTimeout(hoverTimeout.current)
                      hoverTimeout.current = window.setTimeout(() => setHoveredAsset((curr) => (curr?.id === a.id ? null : curr)), 150)
                    }}
                  />
                ))}
              </>
            )}
          </MarkerClusterer>
        ) : null}
        {hovered ? (
          <OverlayView
            position={{ lat: hovered.lat, lng: hovered.lng }}
            mapPaneName="overlayMouseTarget"
            getPixelPositionOffset={() => ({ x: 0, y: -30 })}
          >
            <div
              className="relative -translate-x-1/2 -translate-y-full"
              onMouseEnter={() => {
                if (hoverTimeout.current) window.clearTimeout(hoverTimeout.current)
              }}
              onMouseLeave={() => {
                if (hoverTimeout.current) window.clearTimeout(hoverTimeout.current)
                hoverTimeout.current = window.setTimeout(() => setHovered(null), 150)
              }}
            >
              <div className="min-w-64 rounded-xl bg-[#0b1224] px-4 py-3 text-white shadow-lg ring-1 ring-black/20">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-sky-700/90">
                          {/* Small pollutant icon */}
                          <div className="text-sm font-semibold">{hovered.pollutant || 'AQI'}</div>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-base font-semibold leading-tight">{hovered.deviceName || (hovered.city || 'Location')}</div>
                        {hovered.city ? <div className="text-xs text-zinc-300 truncate">{hovered.city}</div> : null}
                        <div className="mt-2 flex items-center gap-3 text-xs">
                          <div className="text-zinc-300">Status:</div>
                          {hovered.status === "online" ? (
                            <div className="text-emerald-400 font-medium">Active</div>
                          ) : (
                            <div className="text-red-400 font-medium">Offline</div>
                          )}
                          <div className="ml-2 text-zinc-300">•</div>
                          <div className="text-zinc-300">{hovered.pollutant}: <span className="text-white/90 font-medium">{hovered.value} µg/m³</span></div>
                        </div>
                        {/* <div className="mt-2 text-xs text-zinc-300">Device Efficiency: <span className="text-white/90">98%</span></div> */}
                      </div>
                    </div>
              </div>
                  <div className="absolute left-1/2 top-full -mt-[2px] -translate-x-1/2 h-3 w-3 rotate-45 bg-[#0b1224] shadow-lg" />
            </div>
          </OverlayView>
        ) : null}

        {hoveredAsset ? (
          <OverlayView
            position={{ lat: hoveredAsset.lat, lng: hoveredAsset.lng }}
            mapPaneName="overlayMouseTarget"
            getPixelPositionOffset={() => ({ x: 0, y: -30 })}
          >
            <div
              className="relative -translate-x-1/2 -translate-y-full"
              onMouseEnter={() => {
                if (hoverTimeout.current) window.clearTimeout(hoverTimeout.current)
              }}
              onMouseLeave={() => {
                if (hoverTimeout.current) window.clearTimeout(hoverTimeout.current)
                hoverTimeout.current = window.setTimeout(() => setHoveredAsset(null), 150)
              }}
            >
              <div className="min-w-[280px] rounded-xl bg-[#07162a] px-4 py-3 text-white shadow-lg ring-1 ring-black/20">
                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <div className="flex h-14 w-14 items-center justify-center">
                      {/* improved arrow + speed badge */}
                      {(() => {
                        const reading = devicesWithAqi?.find(d => Math.abs(d.lat - hoveredAsset.lat) < 1e-4 && Math.abs(d.lng - hoveredAsset.lng) < 1e-4)
                        if (!reading) return <div className="text-xs text-zinc-300"></div>
                        const fromB = Number(reading.windDir || 0)
                        const toB = windFromToToDeg(fromB)
                        const barbCount = Math.max(0, Math.min(3, Math.floor((reading.windSpeed || 0) / 2)))
                        return reading.windSpeed > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="relative flex items-center justify-center rounded-lg bg-gradient-to-tr from-sky-700 to-sky-500 p-1 shadow-md" style={{ width: 48, height: 48 }}>
                              <svg width="34" height="34" viewBox="0 0 24 24" style={{ transform: `rotate(${toB}deg)` }}>
                                {/* shaft */}
                                <line x1="12" y1="20" x2="12" y2="6" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
                                {/* arrow head */}
                                <path d="M12 4 L7.5 9 L12 7 L16.5 9 Z" fill="#ffffff" />
                                {/* speed barbs */}
                                {Array.from({ length: barbCount }).map((_, i) => {
                                  const y = 18 - i * 3
                                  const len = 3 + Math.min(6, Math.round(reading.windSpeed || 0)) - i
                                  return <line key={i} x1={12} y1={y} x2={12 + len} y2={y + 2} stroke="#93c5fd" strokeWidth={1.6} strokeLinecap="round" />
                                })}
                              </svg>
                              {/* subtle inner ring */}
                              <div className="absolute inset-0 rounded-lg ring-1 ring-white/10" />
                            </div>

                            <div className="flex flex-col">
                              <div className="text-sm font-semibold text-white leading-tight">{reading.windDir != null ? Math.round(toB) + '°' : ''}</div>
                              <div className="text-[12px] text-white/90">{Number(reading.windSpeed).toFixed(1)} m/s</div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-semibold text-white leading-tight">-</div>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold leading-tight">{hoveredAsset.name}</div>
                    {hoveredAsset.location ? <div className="text-xs text-zinc-300 truncate">{hoveredAsset.location}</div> : null}
                    <div className="mt-2 flex flex-col gap-1 text-xs text-zinc-300">
                      <div>Type: <span className="text-white/90">{hoveredAsset.type ?? ''}</span></div>
                      <div>Status: <span className="text-white/90">{hoveredAsset.status === "online" ? "Online" : "Offline"}</span></div>
                      {/* <div>Efficiency: <span className="text-white/90">{hoveredAsset.efficiency != null ? hoveredAsset.efficiency + '%' : ''}</span></div> */}
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute left-1/2 top-full -mt-[2px] -translate-x-1/2 h-3 w-3 rotate-45 bg-[#0b1224] shadow-lg" />
            </div>
          </OverlayView>
        ) : null}

        {/* Per-device wind arrows (visible when zoomed-in and heatmap is enabled) */}
        {deviceArrows.map((a, i) => (
          <Polyline
            key={`device-arrow-${i}`}
            path={a.path}
            options={{
              strokeColor: "#38bdf8",
              strokeOpacity: 0.75,
              strokeWeight: 2,
              zIndex: 2,
              icons: [
                {
                  icon: {
                    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                    scale: a.scale,
                    strokeOpacity: 0.9,
                    strokeWeight: 2,
                    strokeColor: "#38bdf8",
                    fillColor: "#38bdf8",
                    fillOpacity: 1,
                  },
                  offset: "100%",
                },
              ],
            }}
          />
        ))}

        {(wind && heatmapEnabled && zoomOkForArrow && hoveredReading && hovered && hoveredReading.windSpeed > 0) ? (
          <OverlayView
            position={{ lat: hovered.lat, lng: hovered.lng }}
            mapPaneName="overlayMouseTarget"
            getPixelPositionOffset={() => ({ x: 0, y: -36 })}
          >
            <div className="pointer-events-none -translate-x-1/2 -translate-y-full">
              {/* Windy-style arrow: rotate to windDir, label with speed */}
              <div className="flex flex-col items-center gap-1">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  style={{ transform: hoveredReading.windDir != null ? `rotate(${windFromToToDeg(Number(hoveredReading.windDir))}deg)` : undefined }}
                >
                  {/* shaft */}
                  <line x1="12" y1="20" x2="12" y2="5" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" />
                  {/* arrow head */}
                  <path d="M12 3 L7.5 9 L16.5 9 Z" fill="#0ea5e9" />
                  {/* barbs scaled by speed */}
                  {Array.from({ length: Math.max(1, Math.min(4, Math.round((hoveredReading.windSpeed || 0) / 2))) }).map((_, i) => {
                    const y = 18 - i * 3
                    const len = 3 + Math.min(6, Math.round(hoveredReading.windSpeed || 0)) - i
                    return (
                      <line key={i} x1={12} y1={y} x2={12 + len} y2={y + 2} stroke="#38bdf8" strokeWidth={1.6} strokeLinecap="round" />
                    )
                  })}
                </svg>
                <div className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
                  {(() => {
                    const speedText = hoveredReading.windSpeed > 0 ? Number(hoveredReading.windSpeed).toFixed(1) + ' m/s' : '-'
                    const degText = hoveredReading.windDir != null ? Math.round(windFromToToDeg(Number(hoveredReading.windDir))) + '°' : ''
                    return degText ? `${speedText} · ${degText}` : speedText
                  })()}
                </div>
              </div>
            </div>
          </OverlayView>
        ) : null}
        {wind && particles.map((p, i) => (
          <Polyline key={`particle-${i}`} path={p} options={{ strokeColor: "#60a5fa", strokeOpacity: 0.6, strokeWeight: 1 }} />
        ))}
          </GoogleMap>

          {/* Wind legend */}
          {wind ? (
            <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md border bg-background/85 px-2 py-1 text-xs shadow">
              Wind particles
            </div>
          ) : null}


          {/* Heat map AQI legend */}
          {heatmapEnabled && heatmapPoints && heatmapPoints.length > 0 ? (
            <div className="pointer-events-none absolute left-3 bottom-44 z-20 rounded-lg border bg-background/90 px-3 py-2 shadow-lg backdrop-blur hidden md:block">
              <div className="text-xs font-semibold mb-2">Air Quality Index</div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: '#22c55e' }} />
                  <span>0-50 Good</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: '#f59e0b' }} />
                  <span>51-100 Moderate</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: '#fb923c' }} />
                  <span>101-150 Poor</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: '#ef4444' }} />
                  <span>151+ Unhealthy</span>
                </div>
              </div>
              {devicesWithAqi && devicesWithAqi.length > 0 ? (
                <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                  {devicesWithAqi.length} device{devicesWithAqi.length !== 1 ? 's' : ''} active
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Map controls - bottom left */}
          <div className="pointer-events-auto absolute bottom-16 left-3 z-10 flex flex-col gap-2">
            <div className="flex flex-col rounded-xl border bg-background/90 shadow backdrop-blur">
              <button
                aria-label="Zoom in"
                className="p-2 hover:bg-muted first:rounded-t-xl"
                onClick={() => map && map.setZoom(Math.min(21, (map.getZoom() || 10) + 1))}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="11" width="18" height="2" fill="currentColor" />
                  <rect x="11" y="3" width="2" height="18" fill="currentColor" />
                </svg>
              </button>
              <div className="h-px bg-border" />
              <button
                aria-label="Zoom out"
                className="p-2 hover:bg-muted"
                onClick={() => map && map.setZoom(Math.max(3, (map.getZoom() || 10) - 1))}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="11" width="18" height="2" fill="currentColor" />
                </svg>
              </button>
              <div className="h-px bg-border" />
              <button
                aria-label="Recenter"
                className="p-2 hover:bg-muted last:rounded-b-xl"
                onClick={() => map && map.panTo(defaultCenter)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </div>
          </div>

          {/* Maximize button - top right */}
          <button
            onClick={toggleFullscreen}
            className="pointer-events-auto absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-background/90 shadow backdrop-blur hover:bg-muted"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" stroke="currentColor" strokeWidth="2" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 4h6v6M10 20H4v-6" stroke="currentColor" strokeWidth="2" />
                <path d="M20 4l-7 7M4 20l7-7" stroke="currentColor" strokeWidth="2" />
              </svg>
            )}
          </button>

          {/* Option icons - right side */}
          {onSetOpenPanel && (
            <div className="pointer-events-auto absolute right-3 top-16 z-20 flex flex-col gap-3">
              <button
                aria-label="Search"
                onClick={() => onSetOpenPanel(openPanel === "search" ? null : "search")}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-white shadow ring-1 ring-white/15 hover:bg-[#60A5FA] ${openPanel === "search" ? "bg-[#60A5FA] ring-2 ring-blue-500" : "bg-[#0b1224]"}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                aria-label="Map layers"
                onClick={() => onSetOpenPanel(openPanel === "layers" ? null : "layers")}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-white shadow ring-1 ring-white/15 hover:bg-[#60A5FA] ${openPanel === "layers" ? "bg-[#60A5FA] ring-2 ring-blue-500" : "bg-[#0b1224]"}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="2" fill="none"/>
                  <path d="M21 12l-9 5-9-5" stroke="currentColor" strokeWidth="2" fill="none"/>
                </svg>
              </button>
              <button
                aria-label="Air quality station"
                onClick={() => onSetOpenPanel(openPanel === "station" ? null : "station")}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-white shadow ring-1 ring-white/15 hover:bg-[#60A5FA] ${openPanel === "station" ? "bg-[#60A5FA] ring-2 ring-blue-500" : "bg-[#0b1224]"}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </div>
          )}

          {/* Panels content passed from parent */}
          {children}
        </>
      )}
    </div>
  )
}

function makeWindArrows(devices: DemoDevice[]) {
  return devices.map((d) => {
    // d.value historically held a numeric bearing; convert from "from"->"to" if needed
    const toB = windFromToToDeg(Number(d.value || 0))
    const angle = bearingToAngleRad(toB)
    const len = 0.15
    // dx = cos(angle)*len (lng), dy = sin(angle)*len (lat)
    return [
      { lat: d.lat, lng: d.lng },
      { lat: d.lat + Math.sin(angle) * len, lng: d.lng + Math.cos(angle) * len },
    ]
  })
}

function makeWindParticles() {
  // Create flowing particle trails across the regional map like in the image
  const particles = []
  const numParticles = 150
  
  // Cover broader regional area (Pakistan and surrounding regions)
  const bounds = {
    north: 37.0,
    south: 23.0, 
    east: 80.0,
    west: 60.0
  }
  
  for (let i = 0; i < numParticles; i++) {
    // Random starting position across the regional area
    const startLat = bounds.south + Math.random() * (bounds.north - bounds.south)
    const startLng = bounds.west + Math.random() * (bounds.east - bounds.west)
    
    // Wind direction simulation (generally flowing from west to east with variations)
    const baseAngle = Math.PI * 0.05 // slight northeast direction
    const variation = (Math.random() - 0.5) * Math.PI * 0.4
    const angle = baseAngle + variation
    
    const speed = 0.02 + Math.random() * 0.04
    const length = 0.5 + Math.random() * 1.0 // Longer trails for regional view
    
    // Create flowing trail of points with slight curves
    const trailPoints = []
    for (let j = 0; j < 15; j++) {
      const t = j / 14
      const curvature = Math.sin(t * Math.PI * 1.5 + i) * 0.08
      const windShift = Math.sin(t * Math.PI + i * 0.3) * 0.03
      
      trailPoints.push({
        lat: startLat + Math.cos(angle + curvature) * length * t + windShift,
        lng: startLng + Math.sin(angle + curvature) * length * t
      })
    }
    particles.push(trailPoints)
  }
  
  return particles
}

// --- Heatmap city coverage helpers ---
type City = { name: string; lat: number; lng: number; radiusKm: number }

const PAKISTAN_CITIES: City[] = [
  { name: "Karachi", lat: 24.8607, lng: 67.0011, radiusKm: 40 },
  { name: "Lahore", lat: 31.5204, lng: 74.3587, radiusKm: 30 },
  { name: "Islamabad", lat: 33.6844, lng: 73.0479, radiusKm: 25 },
  { name: "Rawalpindi", lat: 33.5651, lng: 73.0169, radiusKm: 25 },
  { name: "Faisalabad", lat: 31.4180, lng: 73.0791, radiusKm: 26 },
  { name: "Multan", lat: 30.1978, lng: 71.4711, radiusKm: 26 },
  { name: "Peshawar", lat: 34.0151, lng: 71.5249, radiusKm: 25 },
  { name: "Quetta", lat: 30.1798, lng: 66.9750, radiusKm: 24 },
  { name: "Hyderabad", lat: 25.3960, lng: 68.3578, radiusKm: 24 },
  { name: "Gujranwala", lat: 32.1877, lng: 74.1945, radiusKm: 22 },
  { name: "Sialkot", lat: 32.4945, lng: 74.5229, radiusKm: 20 },
  { name: "Sukkur", lat: 27.7052, lng: 68.8574, radiusKm: 20 },
  { name: "Bahawalpur", lat: 29.3956, lng: 71.6836, radiusKm: 22 },
]

// Convert kilometers to degrees latitude
function kmToLatDeg(km: number) { return km / 110.574 }
// Convert kilometers to degrees longitude at a given latitude
function kmToLngDeg(km: number, lat: number) { return km / (111.320 * Math.cos((lat * Math.PI) / 180)) }

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Generate a grid of weighted points within the given city radius using a Gaussian falloff
function generateCityWeightedPoints(city: City, stepKm = 5, map?: google.maps.Map) {
  const points: Array<{ location: any; weight: number }> = []
  const latStep = kmToLatDeg(stepKm)
  // Use latitude at city center for consistent lng step estimation
  const lngStep = kmToLngDeg(stepKm, city.lat)
  const latRadius = kmToLatDeg(city.radiusKm)
  const lngRadius = kmToLngDeg(city.radiusKm, city.lat)
  const sigma = city.radiusKm * 0.5

  for (let lat = city.lat - latRadius; lat <= city.lat + latRadius; lat += latStep) {
    for (let lng = city.lng - lngRadius; lng <= city.lng + lngRadius; lng += lngStep) {
      const d = haversineKm(lat, lng, city.lat, city.lng)
      if (d <= city.radiusKm) {
        const gaussian = Math.exp(-(d * d) / (2 * sigma * sigma))
        const weight = 0.4 + 1.6 * gaussian // [0.4, 2.0]
        points.push({ location: new google.maps.LatLng(lat, lng), weight })
      }
    }
    // Clear any overlayMapTypes if present (defensive)
    try {
      if (map && (map as any).overlayMapTypes && typeof (map as any).overlayMapTypes.clear === 'function') {
        try { (map as any).overlayMapTypes.clear() } catch {}
      }
    } catch {}
  }
  return points
}

function generatePakistanCityHeatPoints() {
  const all: Array<{ location: any; weight: number }> = []
  for (const c of PAKISTAN_CITIES) {
    const pts = generateCityWeightedPoints(c, 5)
    all.push(...pts)
  }
  return all
}

function getMarkerIcon(d: DemoDevice): google.maps.Icon {
  const severity = getSeverity(d)
  const palette =
    severity === "good"
      ? { fill: "#22c55e", stroke: "#065f46", glow: "rgba(34,197,94,0.35)" }
      : severity === "warn"
        ? { fill: "#f59e0b", stroke: "#92400e", glow: "rgba(245,158,11,0.35)" }
        : { fill: "#ef4444", stroke: "#7f1d1d", glow: "rgba(239,68,68,0.35)" }

  const inner = getIconMarkup(d.pollutant)
  const svg = `<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'>
  <defs>
    <filter id='shadow' x='-50%' y='-50%' width='200%' height='200%'>
      <feDropShadow dx='0' dy='1' stdDeviation='1.2' flood-color='rgba(0,0,0,0.35)'/>
    </filter>
  </defs>
  <g filter='url(#shadow)'>
    <circle cx='22' cy='22' r='14' fill='${palette.fill}' stroke='${palette.stroke}' stroke-width='2' />
    <circle cx='22' cy='22' r='16' fill='${palette.glow}' />
    <g transform='translate(22,22)'>
      ${inner}
    </g>
  </g>
</svg>`
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  return {
    url,
    scaledSize: new google.maps.Size(44, 44),
    anchor: new google.maps.Point(22, 22),
  }
}

// Generate marker icon using real-time AQI color
function getMarkerIconWithAqi(d: DemoDevice, aqi: number, color: string): google.maps.Icon {
  // Determine stroke and glow based on color
  const colorMap: Record<string, { stroke: string; glow: string }> = {
    '#22c55e': { stroke: '#065f46', glow: 'rgba(34,197,94,0.35)' },      // Green
    '#f59e0b': { stroke: '#92400e', glow: 'rgba(245,158,11,0.35)' },     // Yellow
    '#fb923c': { stroke: '#9a3412', glow: 'rgba(251,146,60,0.35)' },     // Orange
    '#ef4444': { stroke: '#7f1d1d', glow: 'rgba(239,68,68,0.35)' },      // Red
    '#a855f7': { stroke: '#581c87', glow: 'rgba(168,85,247,0.35)' },     // Purple
    '#7f1d1d': { stroke: '#450a0a', glow: 'rgba(127,29,29,0.35)' }       // Maroon
  }
  
  const palette = colorMap[color] || { stroke: '#065f46', glow: 'rgba(34,197,94,0.35)' }

  const inner = getIconMarkup(d.pollutant)
  const svg = `<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'>
  <defs>
    <filter id='shadow' x='-50%' y='-50%' width='200%' height='200%'>
      <feDropShadow dx='0' dy='1' stdDeviation='1.2' flood-color='rgba(0,0,0,0.35)'/>
    </filter>
  </defs>
  <g filter='url(#shadow)'>
    <circle cx='22' cy='22' r='14' fill='${color}' stroke='${palette.stroke}' stroke-width='2' />
    <circle cx='22' cy='22' r='16' fill='${palette.glow}' />
    <g transform='translate(22,22)'>
      ${inner}
    </g>
  </g>
</svg>`
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  return {
    url,
    scaledSize: new google.maps.Size(44, 44),
    anchor: new google.maps.Point(22, 22),
  }
}

function getSeverity(d: DemoDevice): "good" | "warn" | "bad" {
  const v = d.value ?? 0
  if (v < 50) return "good"
  if (v < 100) return "warn"
  return "bad"
}

// Vector icons similar to screenshot; centered around (0,0), about 20x20
function getIconMarkup(p: DemoDevice["pollutant"]) {
  const stroke = "#0b1020"
  const strokeWidth = 1.8
  switch (p) {
    case "PM2.5": // factory
      return `
        <g>
          <rect x='-9' y='2' width='18' height='6' rx='1.2' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
          <rect x='-7' y='-8' width='4' height='10' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
          <rect x='1' y='-5' width='4' height='7' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
          <circle cx='-5' cy='-12' r='2' fill='white' opacity='0.8' />
          <circle cx='-2' cy='-14' r='1.6' fill='white' opacity='0.6' />
          <circle cx='1' cy='-11' r='1.8' fill='white' opacity='0.7' />
        </g>`
    case "PM10": // sun
      return `
        <g>
          <circle cx='0' cy='0' r='5' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
          ${Array.from({length:8}).map((_,i)=>{ const a=(i*Math.PI)/4; const x=Math.cos(a)*9; const y=Math.sin(a)*9; const x2=Math.cos(a)*6; const y2=Math.sin(a)*6; return `<line x1='${x2.toFixed(1)}' y1='${y2.toFixed(1)}' x2='${x.toFixed(1)}' y2='${y.toFixed(1)}' stroke='${stroke}' stroke-width='${strokeWidth}' />` }).join("")}
        </g>`
    case "NO2": // thermometer
      return `
        <g>
          <rect x='-2' y='-6' width='4' height='10' rx='2' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
          <circle cx='0' cy='6' r='4' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
          <rect x='-1' y='1' width='2' height='5' fill='${stroke}' />
        </g>`
    case "O3": // leaf
      return `
        <g>
          <path d='M-6,2 C-5,-6 5,-6 6,2 C6,6 2,8 0,8 C-2,8 -6,6 -6,2 Z' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
          <path d='M-5,3 C-1,1 1,1 5,3' stroke='${stroke}' stroke-width='${strokeWidth}' fill='none' />
        </g>`
    case "SO2": // bolt
      return `
        <g>
          <path d='M-2,-8 L4,-1 L0,-1 L2,6 L-4,0 L0,0 Z' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
        </g>`
    case "CO": // wind
      return `
        <g>
          <path d='M-8,-1 C-2,-1 -2,-1 4,-1 C6,-1 7,-2 7,-3 C7,-5 5,-6 3.5,-5.5' stroke='${stroke}' stroke-width='${strokeWidth}' fill='none' stroke-linecap='round'/>
          <path d='M-6,2 C0,2 0,2 6,2 C8,2 9,1 9,0 C9,-2 7,-3 5.5,-2.5' stroke='${stroke}' stroke-width='${strokeWidth}' fill='none' stroke-linecap='round'/>
        </g>`
    case "AQI":
    default: // default leaf
      return `
        <g>
          <path d='M-5,2 C-4,-5 4,-5 5,2 C5,5 2,7 0,7 C-2,7 -5,5 -5,2 Z' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
          <path d='M-4,3 C-1,1 1,1 4,3' stroke='${stroke}' stroke-width='${strokeWidth}' fill='none' />
        </g>`
  }
}

function getAssetIcon(a: AssetMarker, zoom?: number): google.maps.Icon {
  // Get AQI from devicesWithAqi if available
  const aqiNum = a.deviceId != null ? (() => {
    const reading = (window as any).__devicesWithAqi?.find((d: any) => 
      Math.abs(d.lat - a.lat) < 1e-4 && Math.abs(d.lng - a.lng) < 1e-4
    )
    return reading?.aqi ?? NaN
  })() : NaN
  
  // Color by AQI using dashboard criteria: Good (0-50), Moderate (51-100), Poor (101-150), Unhealthy (151+)
  const tier = isFinite(aqiNum)
    ? aqiNum <= 50
      ? "good"
      : aqiNum <= 100
        ? "moderate"
        : aqiNum <= 150
          ? "poor"
          : "unhealthy"
    : "good" // default to good if no AQI data

  const palette =
    tier === "good"
      ? { fill: "#22c55e", stroke: "#065f46", glow: "rgba(34,197,94,0.35)" }      // Green
      : tier === "moderate"
        ? { fill: "#f59e0b", stroke: "#92400e", glow: "rgba(245,158,11,0.35)" }   // Amber
        : tier === "poor"
          ? { fill: "#fb923c", stroke: "#c2410c", glow: "rgba(251,146,60,0.35)" } // Orange
          : { fill: "#ef4444", stroke: "#7f1d1d", glow: "rgba(239,68,68,0.35)" }  // Red

  // Dim if offline
  const opacity = a.status === "offline" ? 0.5 : 1
  const overlay = a.status === "offline" ? "rgba(0,0,0,0.2)" : palette.glow

  // Large circular marker with internal symbol based on type
  const inner = getAssetSymbol(a.type)
  const svg = `<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'>
  <defs>
    <filter id='shadow' x='-50%' y='-50%' width='200%' height='200%'>
      <feDropShadow dx='0' dy='1.2' stdDeviation='1.6' flood-color='rgba(0,0,0,0.35)'/>
    </filter>
  </defs>
  <g filter='url(#shadow)' opacity='${opacity}'>
    <circle cx='24' cy='24' r='16' fill='${palette.fill}' stroke='${palette.stroke}' stroke-width='2.4' />
    <circle cx='24' cy='24' r='18' fill='${overlay}' />
    <g transform='translate(24,24)'>
      ${inner}
    </g>
  </g>
</svg>`
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  // Compute display size based on zoom so markers don't appear huge when zoomed out.
  // Base size corresponds to zoom 12 -> 48px. Scale linearly with zoom but clamp to reasonable range.
  const z = Number.isFinite(Number(zoom)) ? Math.max(3, Math.min(21, Number(zoom))) : 12
  const base = 48
  const size = Math.max(12, Math.min(72, Math.round(base * (z / 12))))
  const half = Math.round(size / 2)
  return {
    url,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(half, half),
  }
}

function getAssetSymbol(type?: string) {
  const t = (type || "").toLowerCase()
  const stroke = "#0b1020"
  const strokeWidth = 2
  if (t.includes("esp")) {
    // simplified ESP icon
    return `
      <g>
        <rect x='-8' y='-6' width='16' height='12' rx='2' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
        <rect x='-2' y='-10' width='4' height='6' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
      </g>`
  }
  if (t.includes("tower") || t.includes("rain")) {
    // triangular tower
    return `
      <g>
        <path d='M-8,8 L0,-10 L8,8 Z' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
        <line x1='0' y1='-6' x2='0' y2='6' stroke='${stroke}' stroke-width='${strokeWidth}' />
      </g>`
  }
  // default leaf-ish
  return `
    <g>
      <path d='M-6,3 C-5,-6 5,-6 6,3 C6,7 2,9 0,9 C-2,9 -6,7 -6,3 Z' fill='white' stroke='${stroke}' stroke-width='${strokeWidth}' />
      <path d='M-5,4 C-1,2 1,2 5,4' stroke='${stroke}' stroke-width='${strokeWidth}' fill='none' />
    </g>`
}
