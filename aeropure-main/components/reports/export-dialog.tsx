"use client"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Download, FileText, FileSpreadsheet, Map, Loader2, Trash2 } from "lucide-react"
import { useDevices } from "@/components/iot/use-devices"
import { useAssets } from "@/components/iot/use-assets"
// heatmap generation removed from export flow; do not import heatmap generator here
import { metricLabel } from '@/lib/utils'
import { toast } from "sonner"
import { useEffect, useState } from "react"

type MetricType = "AQI" | "PM2_5" | "PM10" | "CO" | "NO2" | "O3" | "SO2" | "Temperature" | "Humidity" | "Pressure"
type ExportFormat = "pdf" | "csv" | "geojson"

export function ExportDialog() {
  const [open, setOpen] = useState(false)
  
  // Use datetime-local strings like dashboard
  const formatDateTimeLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  
  const [fromDateTime, setFromDateTime] = useState<string>(formatDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)))
  const [toDateTime, setToDateTime] = useState<string>(formatDateTimeLocal(new Date()))
  
  const [selectedMetrics, setSelectedMetrics] = useState<MetricType[]>(["AQI"]) // Only AQI selected by default
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]) // Array of deviceIds, empty means "all"
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf")
  const [includeMap, setIncludeMap] = useState(true)
  const [includeCharts, setIncludeCharts] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [mapsKey, setMapsKey] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<Array<{ id: string; dataUrl: string; name?: string }>>([])
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<string[]>([])
  const { devices } = useDevices()
  const { assets } = useAssets()

  useEffect(() => {
    // Get maps key from cookies, similar to dashboard
    const key = document.cookie.split('; ').find(row => row.startsWith('maps_key='))?.split('=')[1] || null
    setMapsKey(key)
  }, [])

  useEffect(() => {
    // When dialog opens, load any snapshots saved by the Map capture button
    if (!open) return
    try {
      const w = window as any
      const s = (w.__AEROPURE_MAP_SNAPSHOTS && Array.isArray(w.__AEROPURE_MAP_SNAPSHOTS)) ? w.__AEROPURE_MAP_SNAPSHOTS.slice().reverse() : []
      setSnapshots(s)
      if (s.length && selectedSnapshotIds.length === 0) setSelectedSnapshotIds([s[0].id])
    } catch {
      setSnapshots([])
      setSelectedSnapshotIds([])
    }
  }, [open])

  const baseMetrics: MetricType[] = ["AQI", "PM2_5", "PM10", "CO", "SO2", "NO2", "O3"]
  const senseMeshMetrics: MetricType[] = ["Temperature", "Humidity"] // Removed Pressure
  
  // Check if any selected assets or all assets include SenseMesh to show env metrics
  const hasSenseMeshInSelection = selectedAssets.length === 0 
    ? (assets || []).some((a: any) => String(a?.type).toLowerCase() === 'sensemesh')
    : selectedAssets.some(assetId => {
        const asset = assets?.find((a: any) => String(a.deviceId) === String(assetId))
        return String(asset?.type).toLowerCase() === 'sensemesh'
      })
  
  const showEnvMetrics = hasSenseMeshInSelection
  
  const availableMetrics: MetricType[] = showEnvMetrics
    ? [...baseMetrics, ...senseMeshMetrics]
    : baseMetrics

  const metrics: { value: MetricType; label: string; description: string }[] = [
    { value: "AQI" as const, label: metricLabel('AQI'), description: "Overall air quality indicator" },
    { value: "PM2_5" as const, label: metricLabel('PM2_5'), description: "Fine particulate matter (≤2.5μm)" },
    { value: "PM10" as const, label: metricLabel('PM10'), description: "Coarse particulate matter (≤10μm)" },
    { value: "CO" as const, label: metricLabel('CO'), description: "Carbon Monoxide" },
    { value: "NO2" as const, label: metricLabel('NO2'), description: "Nitrogen Dioxide" },
    { value: "O3" as const, label: metricLabel('O3'), description: "Ozone" },
    { value: "SO2" as const, label: metricLabel('SO2'), description: "Sulfur Dioxide" },
    { value: "Temperature" as const, label: metricLabel('Temperature'), description: "Air temperature (°C)" },
    { value: "Humidity" as const, label: metricLabel('Humidity'), description: "Relative humidity (%)" },
  ].filter(m => availableMetrics.includes(m.value as MetricType))

  const toggleMetric = (metric: MetricType) => {
    setSelectedMetrics((prev) =>
      prev.includes(metric) ? prev.filter((m) => m !== metric) : [...prev, metric]
    )
  }

  const toggleAllMetrics = () => {
    // "All metrics" means all available metrics
    if (selectedMetrics.length === availableMetrics.length) {
      setSelectedMetrics([])
    } else {
      setSelectedMetrics([...availableMetrics])
    }
  }

  const toggleAsset = (assetId: string) => {
    setSelectedAssets((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    )
  }

  const toggleAllAssets = () => {
    const allAssetIds = (assets || []).map((a: any) => String(a.deviceId || a.id))
    if (selectedAssets.length === allAssetIds.length) {
      setSelectedAssets([])
    } else {
      setSelectedAssets(allAssetIds)
    }
  }

  const toggleSnapshot = (id: string) => {
    setSelectedSnapshotIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    )
  }

  const deleteSnapshot = (id: string) => {
    try {
      const w = window as any
      if (w.__AEROPURE_MAP_SNAPSHOTS && Array.isArray(w.__AEROPURE_MAP_SNAPSHOTS)) {
        w.__AEROPURE_MAP_SNAPSHOTS = w.__AEROPURE_MAP_SNAPSHOTS.filter((s: any) => s.id !== id)
        setSnapshots(w.__AEROPURE_MAP_SNAPSHOTS.slice().reverse())
        setSelectedSnapshotIds(prev => prev.filter(sid => sid !== id))
        toast.success('Snapshot deleted')
      }
    } catch (err) {
      console.error('Failed to delete snapshot:', err)
      toast.error('Failed to delete snapshot')
    }
  }

  const handleExport = async () => {
    if (!fromDateTime || !toDateTime) {
      toast.error("Please select both start and end date/time")
      return
    }

    if (selectedMetrics.length === 0) {
      toast.error("Please select at least one metric")
      return
    }

    const fromTs = new Date(fromDateTime).getTime()
    const toTs = new Date(toDateTime).getTime()

    if (fromTs >= toTs) {
      toast.error("Start date/time must be before end date/time")
      return
    }

    // Check if the date range exceeds 30 days
    const maxSpanMs = 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
    const spanMs = toTs - fromTs
    if (spanMs > maxSpanMs) {
      toast.error("Report period cannot exceed 30 days. Please select a shorter date range.")
      return
    }

    setIsExporting(true)

    try {
      // If includeMap is requested, use a user-captured map snapshot (if available).
      // We no longer generate heatmap overlays client-side — only include the snapshot image.
      let backgroundImageDataUrls: string[] = []
      if (includeMap) {
        try {
          if ((window as any).__AEROPURE_MAP_SNAPSHOTS && selectedSnapshotIds.length > 0) {
            const s = (window as any).__AEROPURE_MAP_SNAPSHOTS as Array<{ id: string; dataUrl: string; name?: string }>
            backgroundImageDataUrls = selectedSnapshotIds
              .map(id => s.find(x => x.id === id)?.dataUrl)
              .filter((url): url is string => !!url)
            console.log('[Export Dialog] Using selected map snapshots for export:', selectedSnapshotIds)
            console.log('[Export Dialog] Number of images to export:', backgroundImageDataUrls.length)
          }

          if (backgroundImageDataUrls.length === 0) {
            console.log('[Export Dialog] No map snapshots found — map will not be included in the export')
            toast.info('No map snapshots found — map will not be included in the export')
          }
        } catch (err) {
          console.warn('[Export Dialog] Failed to read selected snapshots:', err)
        }
      }

      // Determine which assets to export
      const assetsToExport = selectedAssets.length === 0 
        ? (assets || []).map((a: any) => String(a.deviceId || a.id))
        : selectedAssets

      // Prepare asset names for the report
      const assetNames = assetsToExport.map(assetId => {
        const asset = assets?.find((a: any) => String(a.deviceId || a.id) === assetId)
        return asset?.name || `Asset ${assetId}`
      })
      const assetLocations = assetsToExport.map(assetId => {
        const asset = assets?.find((a: any) => String(a.deviceId || a.id) === assetId)
        return asset?.location || undefined
      })

      const body = {
        startDateTime: fromDateTime, // Send datetime-local string
        endDateTime: toDateTime,
        metrics: selectedMetrics.join(","),
        deviceIDs: assetsToExport, // Send array of device IDs
        format: exportFormat,
        includeMap,
        includeCharts,
        // Cover page information
        location: assetsToExport.length === 1
          ? (assets?.find((a: any) => String(a.deviceId) === assetsToExport[0])?.location || undefined)
          : "Multiple Locations",
        assetName: assetsToExport.length === 1
          ? assetNames[0]
          : assetNames.join(", "),
        assetNames: assetNames, // Include all asset names for multi-asset reports
        assetLocations: assetLocations,
        // Include captured snapshots (if any). No heatmap overlay will be generated.
        mapImageDataUrls: backgroundImageDataUrls.length > 0 ? backgroundImageDataUrls : undefined,
        // If the main map instance is exposed, include its current center/zoom so server can fetch a matching static map
        mapCenter: (function() {
          try {
            const m = (window as any).__AEROPURE_MAP
            if (!m) return undefined
            const c = m.getCenter()
            if (!c) return undefined
            return { lat: c.lat(), lng: c.lng() }
          } catch (e) {
            return undefined
          }
        })(),
        mapZoom: (function() {
          try {
            const m = (window as any).__AEROPURE_MAP
            if (!m) return undefined
            return m.getZoom()
          } catch (e) {
            return undefined
          }
        })(),
      }

      // NOTE: Previously we generated a minimal client-side PDF when a
      // captured map snapshot existed. That PDF only embedded the image and
      // omitted charts/readings. To ensure exports always include the full
      // report (image + charts + tables), perform server-side generation for
      // PDFs and fall back to it for consistency. Continue to POST to the
      // server and let the server-side `generatePDFReport` embed the image
      // and render charts/tables from the filtered readings.

      const response = await fetch(`/api/reports/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
        throw new Error(errorData.error || "Export failed")
      }

      // Get the blob and create a download link
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      
      // Generate filename based on format and date range
      const startStr = new Date(fromDateTime).toISOString().split("T")[0]
      const endStr = new Date(toDateTime).toISOString().split("T")[0]
      const extension = exportFormat === "geojson" ? "json" : exportFormat
      a.download = `aeropure-report-${startStr}-to-${endStr}.${extension}`
      
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success(`Report exported successfully as ${exportFormat.toUpperCase()}`)
      setOpen(false)
    } catch (error) {
      console.error("Export error:", error)
      toast.error("Failed to export report. Please try again.")
    } finally {
      setIsExporting(false)
    }
  }

  const getFormatIcon = (format: ExportFormat) => {
    switch (format) {
      case "pdf":
        return <FileText className="h-4 w-4" />
      case "csv":
        return <FileSpreadsheet className="h-4 w-4" />
      case "geojson":
        return <Map className="h-4 w-4" />
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#60A5FA] hover:bg-[#2d589e] text-white">
          <Download className="mr-2 h-4 w-4" />
          Export Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export Air Quality Report</DialogTitle>
          <DialogDescription>
            Select pollutants, date range, and export format for your report
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Asset Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Select Assets</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleAllAssets}
                className="h-8 text-xs"
              >
                {selectedAssets.length === (assets || []).length && selectedAssets.length > 0
                  ? "Deselect All"
                  : "Select All"}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto border border-gray-300 rounded-md p-3">
              {assets && assets.length > 0 ? (
                assets.map((asset: any) => {
                  const assetId = String(asset.deviceId || asset.id)
                  return (
                    <div key={assetId} className="flex items-center space-x-2 p-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50">
                      <Checkbox className="border border-gray-300"
                        id={`asset-${assetId}`}
                        checked={selectedAssets.includes(assetId)}
                        onCheckedChange={() => toggleAsset(assetId)}
                      />
                      <Label
                        htmlFor={`asset-${assetId}`}
                        className="text-sm font-normal cursor-pointer flex-1"
                      >
                        {asset.name || `Asset ${asset.deviceId}`} {asset.type ? `(${asset.type})` : ''}
                      </Label>
                    </div>
                  )
                })
              ) : (
                <div className="text-sm text-muted-foreground">No assets available</div>
              )}
            </div>
            {selectedAssets.length === 0 && (
              <p className="text-xs text-muted-foreground">No assets selected (all assets will be included)</p>
            )}
          </div>

          {/* Date/Time Range Selection */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Date & Time Range</Label>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">From Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={fromDateTime}
                  onChange={(e) => setFromDateTime(e.target.value)}
                  className="w-full border border-gray-300"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">To Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={toDateTime}
                  onChange={(e) => setToDateTime(e.target.value)}
                  className="w-full border border-gray-300"
                />
              </div>
            </div>
          </div>

          {/* Metric Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Metrics</Label>
              <Button size="sm" variant="ghost" onClick={toggleAllMetrics}>
                {(() => {
                  const allMetricsExceptPressure = availableMetrics.filter(m => m !== 'Pressure')
                  const hasAllExceptPressure = allMetricsExceptPressure.length > 0 && 
                    allMetricsExceptPressure.every(m => selectedMetrics.includes(m)) &&
                    selectedMetrics.length === allMetricsExceptPressure.length
                  return hasAllExceptPressure ? "Deselect All" : "Select All"
                })()}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              Select all metrics (except Pressure) or choose one metric at a time
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {metrics.map((metric) => (
                <div
                  key={metric.value}
                  className="flex items-start space-x-3 rounded-lg border border-gray-300 p-3 hover:bg-muted/50 cursor-pointer"
                  onClick={() => toggleMetric(metric.value)}
                >
                  <Checkbox className="border border-gray-300"
                    checked={selectedMetrics.includes(metric.value)}
                    onCheckedChange={() => toggleMetric(metric.value)}
                  />
                  <div className="flex-1 space-y-1">
                    <div className="text-sm font-medium leading-none">{metric.label}</div>
                    <p className="text-xs text-muted-foreground">{metric.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Export Format Selection */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Export Format</Label>
            <div className="grid grid-cols-3 gap-3">
              {(["pdf", "csv", "geojson"] as ExportFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => setExportFormat(format)}
                  className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 transition-all hover:bg-muted/50 ${
                    exportFormat === format ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-border"
                  }`}
                >
                  {getFormatIcon(format)}
      <span className="mt-2 text-sm font-medium uppercase">{format}</span>
                  <span className="mt-1 text-xs text-muted-foreground text-center">
                    {format === "pdf" && "Professional PDF report"}
                    {format === "csv" && "Raw data spreadsheet"}
                    {format === "geojson" && "Geographic data format"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Additional Options */}
          {exportFormat === "pdf" && (
            <div className="space-y-3">
              <Label className="text-base font-semibold">Include in Report</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-3 rounded-lg border p-3">
                  <Checkbox checked={includeMap} onCheckedChange={(checked) => setIncludeMap(checked as boolean)} />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Map Visuals</div>
                    <p className="text-xs text-muted-foreground">Include geographic distribution maps</p>
                  </div>
                </div>
                {/* Snapshot selection UI - allow user to pick a previously captured overlay snapshot */}
                {includeMap && (
                  <div className="mt-3">
                    <Label className="text-sm font-semibold">Map Snapshots (Click to select/deselect)</Label>
                    {snapshots && snapshots.length > 0 ? (
                      <div className="mt-3 p-1 flex gap-2 overflow-x-auto pb-2">
                        {snapshots.map((s) => (
                          <div key={s.id} className="relative group mt-2">
                            <button
                              onClick={() => toggleSnapshot(s.id)}
                              className={`rounded-lg border-2 overflow-hidden transition-all ${
                                selectedSnapshotIds.includes(s.id) 
                                  ? 'ring-2 ring-blue-500 border-blue-500' 
                                  : 'border-border hover:border-blue-300'
                              }`}
                              style={{ minWidth: 160, minHeight: 90 }}
                            >
                              <img src={s.dataUrl} alt={s.name || s.id} className="h-20 w-40 object-cover" />
                              {selectedSnapshotIds.includes(s.id) && (
                                <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                                  {/* <div className="bg-blue-500 text-white rounded-full px-2 py-1 text-xs font-semibold">
                                    
                                  </div> */}
                                </div>
                              )}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteSnapshot(s.id)
                              }}
                              className="absolute -top-1 -right-1 bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-700 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                              title="Delete snapshot"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-muted-foreground">No map snapshots found. Use the camera icon on the Live Map to capture the overlay.</div>
                    )}
                    {selectedSnapshotIds.length > 0 && (
                      <div className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                        {selectedSnapshotIds.length} snapshot{selectedSnapshotIds.length > 1 ? 's' : ''} selected
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center space-x-3 rounded-lg border p-3">
                  <Checkbox
                    checked={includeCharts}
                    onCheckedChange={(checked) => setIncludeCharts(checked as boolean)}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Charts & Graphs</div>
                    <p className="text-xs text-muted-foreground">Include trend charts and visualizations</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <div className="text-sm font-semibold">Export Summary</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                <strong>Assets:</strong>{" "}
                {selectedAssets.length === 0
                  ? "All Assets"
                  : selectedAssets.length === 1
                  ? assets?.find((a: any) => String(a.deviceId) === selectedAssets[0])?.name || `Asset ${selectedAssets[0]}`
                  : `${selectedAssets.length} assets selected`
                }
              </div>
              <div>
                <strong>Date Range:</strong>{" "}
                {fromDateTime && toDateTime
                  ? `${new Date(fromDateTime).toLocaleString()} - ${new Date(toDateTime).toLocaleString()}`
                  : "Not selected"}
              </div>
              <div>
                <strong>Metrics:</strong> {selectedMetrics.length} selected
                {selectedMetrics.length > 0 && ` (${selectedMetrics.map(m => metricLabel(m)).join(", ")})`}
              </div>
              <div>
                <strong>Format:</strong> {exportFormat.toUpperCase()}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || !fromDateTime || !toDateTime || selectedMetrics.length === 0}>
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
