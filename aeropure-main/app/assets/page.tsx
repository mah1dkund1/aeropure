"use client"

import AppShell from "@/components/app/shell"
import { Topbar } from "@/components/app/topbar"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Play, Pause, Square, Settings, Eye, Pencil, Trash2 } from "lucide-react"
import { useApi } from "@/components/iot/use-fetcher"
import { useAssets } from "@/components/iot/use-assets"
import { useDevices } from "@/components/iot/use-devices"
import { useToast } from '@/hooks/use-toast'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { detectAssetState, mapStateToAssetLabel } from "@/lib/asset-status"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
 
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export default function AssetsPage() {
  type AssetStatus = "Active" | "Inactive" | "Paused" | "Fault"
  type ApiAsset = {
    _id: string
    createdAt?: string
    updatedAt?: string
    efficiency?: string
    images?: string[]
    location?: string
    maintenanceHistory?: { action: string; date: string }[]
    name?: string
    stakeholder?: string
    type?: string
    lat?: string
    long?: string
    status?: string
    lastActiveAt?: string
  }

  const [country, setCountry] = useState("All")
  const [city, setCity] = useState("All")
  const [query, setQuery] = useState("")
  const [logDate, setLogDate] = useState<Date | undefined>(undefined)
  const [logTypeFilter, setLogTypeFilter] = useState<'all' | 'emergency' | 'preventive' | 'normal'>('all')
  // Filter state: selected asset types (multi) and online/offline status
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [activeAsset, setActiveAsset] = useState<ApiAsset | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteMsgOpen, setDeleteMsgOpen] = useState(false)
  const [serverMsg, setServerMsg] = useState<string | null>(null)

  // Editt sheet state
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    name: "",
    type: "",
    location: "",
    stakeholder: "",
    latitude: "",
    longitude: "",
    action: "",
    deviceId: "",
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function confirmDelete() {
    if (!activeAsset?._id) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/assets/${activeAsset._id}`, { method: "DELETE" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || json?.message || `Delete failed (${res.status})`)
      setServerMsg(json?.message || "Asset deleted")
      setServerMsgTitle('Success')
      setDeleteOpen(false)
      setActiveAsset(null)
      await mutate()
      setDeleteMsgOpen(true)
    } catch (e: any) {
      setDeleteError(e?.message || "Failed to delete asset")
    } finally {
      setDeleting(false)
    }
  }

  function openEdit(a: ApiAsset) {
    setActiveAsset(a)
    setEditForm({
      name: a.name ?? "",
      type: a.type ?? "",
      location: a.location ?? "",
      stakeholder: a.stakeholder ?? "",
      latitude: a.lat ?? "",
      longitude: a.long ?? "",
      action: "",
      // populate device id whenn available from diferent fields
      deviceId: String((a as any).deviceId ?? (a as any).deviceID ?? (a as any).id ?? ""),
    })
    setSaveError(null)
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!activeAsset?._id) return
    setSaving(true)
    setSaveError(null)
    try {
      if (!editForm.action || !editForm.action.trim()) {
        setSaveError("Please provide an action to record in maintenance history.")
        setSaving(false)
        return
      }
      // Client-side duplicate checks: deviceId and name (exclude current asset)
      try {
        // Duplicate device id: prefer numeric comparison
        if (editForm.deviceId) {
          const candidate = Number(editForm.deviceId)
          if (!isNaN(candidate)) {
            // check normalizedAssets (deviceId mapping)
            const dup = (normalizedAssets || []).some((n: any) => Number(n.deviceId) === candidate && String(n.id) !== String(activeAsset._id))
            // also check raw data items for deviceId fields
            const dup2 = (data?.items || []).some((d: any) => {
              const otherId = Number(d.deviceId ?? d.deviceID ?? d.id)
              return !isNaN(otherId) && otherId === candidate && String(d._id) !== String(activeAsset._id)
            })
            if (dup || dup2) {
              setSaveError(`An asset already exists for device id ${editForm.deviceId}. Please edit the existing asset instead.`)
              setSaving(false)
              return
            }
          }
        }

        // Duplicate name (case-insensitive)
        if (editForm.name && editForm.name.trim()) {
          const nameNorm = editForm.name.trim().toLowerCase()
          const nameDup = (data?.items || []).some((d: any) => String(d._id) !== String(activeAsset._id) && (d.name || '').trim().toLowerCase() === nameNorm)
          if (nameDup) {
            setSaveError(`An asset with the name "${editForm.name.trim()}" already exists. Choose a different name.`)
            setSaving(false)
            return
          }
        }
      } catch (e) {
        // Non-fatal; continue to server validation
      }
      // Send update as JSON. The backend expects lat/long fields in JSON for PUT/PATCH.
      const payload: any = {
        name: editForm.name,
        type: editForm.type,
        location: editForm.location,
      }
      if (editForm.stakeholder) payload.stakeholder = editForm.stakeholder
      // Use `lat` and `long` keys in JSON as required for update
      if (editForm.latitude) payload.lat = editForm.latitude
      if (editForm.longitude) payload.long = editForm.longitude
      // allow editing device id
      if (editForm.deviceId) payload.id = editForm.deviceId
      // include action to record maintenance history
      payload.action = editForm.action

      const res = await fetch(`/api/assets/${activeAsset._id}`, { method: "PUT", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || json?.message || `Update failed (${res.status})`)
      setServerMsg(json?.message || "Asset updated successfully")
      setServerMsgTitle('Success')
      setEditOpen(false)
      await mutate()
      setDeleteMsgOpen(true)
    } catch (e: any) {
      setSaveError(e?.message || "Failed to update asset")
    } finally {
      setSaving(false)
    }
  }

  // Fetch from bacckend API
  const { data, error, isLoading, mutate } = useApi<{ items: ApiAsset[]; total: number; page: number; pageSize: number }>(
    "/api/assets"
  )

  // Normalized assets (deviceId available) to display device id in table
  const { assets: normalizedAssets } = useAssets()
  const { toast } = useToast()
  const { devices: hookDevices } = useDevices()

  // deviceId dropdown options (strings)
  const [deviceIds, setDeviceIds] = useState<string[]>([])
  const [loadingDevices, setLoadingDevices] = useState(false)


  const [serverMsgTitle, setServerMsgTitle] = useState<string>("Success")

  useEffect(() => {
    let mounted = true
    // compute from the stable parts: normalizedAssets, hookDevices, data?.items
    try {
      const candidates: number[] = []
      ;(normalizedAssets || []).forEach((n: any) => {
        const v = Number(n?.deviceId)
        if (!isNaN(v)) candidates.push(v)
      })
      ;(hookDevices || []).forEach((d: any) => {
        if (typeof d === 'number') candidates.push(d)
        else {
          const v = Number(d?.deviceID ?? d?.deviceId ?? d?.id)
          if (!isNaN(v)) candidates.push(v)
        }
      })
      ;(data?.items || []).forEach((d: any) => {
        const v = Number(d.deviceId ?? d.deviceID ?? d.id)
        if (!isNaN(v)) candidates.push(v)
      })

      // Preserve order but dedupe
      const seen = new Set<number>()
      const ordered: number[] = []
      for (const v of candidates) {
        if (!seen.has(v)) {
          seen.add(v)
          ordered.push(v)
        }
      }

      // Exclude ids already used by other assets, but allow activeAsset's id
      const used = new Set<number>((data?.items || []).map((a: any) => Number(getDeviceIdFor(a))).filter((n: number) => !isNaN(n)))
      const available = ordered.filter((id) => {
        if (activeAsset && Number(getDeviceIdFor(activeAsset)) === id) return true
        return !used.has(id)
      }).map((n) => String(n))

      // Only update state if the computed list actually changed (prevent render loops)
      setDeviceIds((prev) => {
        const prevStr = prev.join(',')
        const nextStr = available.join(',')
        if (prevStr === nextStr) return prev
        return available
      })
    } catch (e) {
      // ignore
    }
    return () => { mounted = false }
  }, [normalizedAssets, hookDevices, data?.items, activeAsset])

  // Prevent hydration mismatch by only showing transient states after mount
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Country -> cities mapping used to populate the city dropdown
  const COUNTRY_CITIES: Record<string, string[]> = {
    All: [],
    Pakistan: ["All", "Lahore", "Karachi", "Islamabad"],
    UAE: ["All", "Dubai", "Abu Dhabi", "Sharjah"],
    "Saudi Arabia": ["All", "Riyadh", "Jeddah", "Dammam"],
  }

  // When the country changes we should update the city dropdown to a sensible default
  const handleCountryChange = (val: string) => {
    setCountry(val)
    // Default city to All when country changes
    setCity("All")
  }

  // Compute city options to render in the City select. If country is 'All', show union of all cities.
  const cityOptions = useMemo(() => {
    if (country === "All") {
      const s = new Set<string>()
      Object.values(COUNTRY_CITIES).forEach((arr) => arr.forEach((c) => s.add(c)))
      // Ensure 'All' is first
      const all = Array.from(s).filter((c) => c && c !== "All")
      return ["All", ...all]
    }
    return COUNTRY_CITIES[country] || ["All"]
  }, [country])

  // Compute available asset type options from loaded data
  const typeOptions = useMemo(() => {
    const s = new Set<string>()
    ;(data?.items ?? []).forEach((a) => { if (a.type) s.add(a.type) })
    return Array.from(s)
  }, [data])

  // Latest reading for the asset shown in details (used for IronRain supply fields)
  const [assetLastReading, setAssetLastReading] = useState<any | null>(null)
  // When details open for an asset, fetch its most recent reading (if any)
  useEffect(() => {

      // (removed duplicate mapping - defined earlier)
    let cancelled = false
    async function run() {
      if (!detailsOpen || !activeAsset) {
        setAssetLastReading(null)
        return
      }

      // Try deviceID/deviceId/id fields
      const devId = (activeAsset as any).deviceID ?? (activeAsset as any).deviceId ?? (activeAsset as any).id ?? null
      if (!devId) {
        setAssetLastReading(null)
        return
      }

      try {
        // Request recent readings for this device; use limit=1 to get latest
        const resp = await fetch(`/api/data?deviceID=${encodeURIComponent(String(devId))}&limit=1`)
        if (!resp.ok) {
          setAssetLastReading(null)
          return
        }
        const payload = await resp.json().catch(() => ({}))

        // normalize payload to an array of rows
        let rows: any[] = []
        if (Array.isArray(payload?.data)) rows = payload.data
        else if (Array.isArray(payload?.data?.list)) rows = payload.data.list
        else if (Array.isArray(payload)) rows = payload
        else if (Array.isArray(payload?.rows)) rows = payload.rows
        else rows = []

        if (!cancelled) setAssetLastReading(rows.length ? rows[0] : null)
      } catch (e) {
        if (!cancelled) setAssetLastReading(null)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [detailsOpen, activeAsset])

  // Format '2025-10-20T11:10:54.966288' -> '2025-10-20, 11:10:54' in Pakistan time
  function formatMaintenanceDate(raw?: string) {
    if (!raw) return "—"
    const s = raw.trim()
    try {
      function toUTCDate(str: string): Date {
        // If timezone info exists, parse directly
        if (/[Zz]|[+-]\d{2}:\d{2}$/.test(str)) return new Date(str)
        // ISO with T but no timezone -> assume UTC
        if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return new Date(str + 'Z')
        // "YYYY-MM-DD HH:mm:ss(.SSS)?" -> construct with Date.UTC
        const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.(\d+))?$/)
        if (m) {
          const year = Number(m[1])
          const month = Number(m[2]) - 1
          const day = Number(m[3])
          const hour = Number(m[4])
          const minute = Number(m[5])
          const second = Number(m[6])
          const milli = m[8] ? Number((m[8] + '').slice(0, 3).padEnd(3, '0')) : 0
          return new Date(Date.UTC(year, month, day, hour, minute, second, milli))
        }
        // Fallback
        return new Date(str)
      }

      const d = toUTCDate(s)
      if (isNaN(d.getTime())) return s
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      const parts = fmt.formatToParts(d)
      const get = (type: string) => parts.find(p => p.type === type)?.value || ''
      const year = get('year')
      const month = get('month').padStart(2, '0')
      const day = get('day').padStart(2, '0')
      const hour = get('hour').padStart(2, '0')
      const minute = get('minute').padStart(2, '0')
      const second = get('second').padStart(2, '0')
      return `${year}-${month}-${day}, ${hour}:${minute}:${second}`
    } catch (e) {
      return s
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const items = (data?.items ?? [])
    return items.filter((a) => {
      // Basic text search
      const textOk = [a.name ?? "", a._id ?? "", a.location ?? "", a.stakeholder ?? ""].some((v) => v.toLowerCase().includes(q))
      // City + Country filtering:
      const loc = (a.location || "").toLowerCase()
      const cityOk = (() => {
        // If a specific city selected, require it
        if (city && city !== "All") return loc.includes(city.toLowerCase())
        // If city is All but a specific country selected, match country or any city in that country
        if (country && country !== "All") {
          const countryLower = country.toLowerCase()
          const cities = (COUNTRY_CITIES[country] || []).filter((c) => c && c !== 'All')
          if (loc.includes(countryLower)) return true
          return cities.some((ct) => loc.includes(ct.toLowerCase()))
        }
        // Otherwise allow all
        return true
      })()
      // Type filtering (empty selection => no filtering)
      const typesOk = (selectedTypes.length === 0) || (a.type && selectedTypes.includes(a.type))
      // Status filtering: map Active -> online, others -> offline
      const statusLabel = mapStateToAssetLabel(detectAssetState(a))
      const isOnline = statusLabel === 'Active'
      const statusOk = statusFilter === 'all' || (statusFilter === 'online' ? isOnline : !isOnline)

      return textOk && cityOk && typesOk && statusOk
    })
  }, [data, query, city, country, selectedTypes, statusFilter])

  // Helpers for selected rows and actions
  const FORBIDDEN_ID = '6924446eebe68039d6634b84'
  const getSelectedRows = () => {
    const ids = selectedIds.filter(id => id !== FORBIDDEN_ID)
    return (data?.items ?? []).filter((r) => ids.includes(r._id))
  }

  // Resolve deviceId for an asset using normalizedAssets or asset fields
  const getDeviceIdFor = (a: ApiAsset) => {
    const found = (normalizedAssets || []).find((n: any) => String(n.id) === String(a._id ?? (a as any).id))
    return found?.deviceId ?? (a as any).deviceId ?? (a as any).deviceID ?? ''
  }

  const handleDownloadSelected = () => {
    const rows = getSelectedRows()
    if (!rows || rows.length === 0) {
      setServerMsgTitle('Notice')
      setServerMsg('Please select assets to download')
      setDeleteMsgOpen(true)
      return
    }
    const cols = ["name","deviceId","location","type","stakeholder","lat","long","status","efficiency","createdAt","lastActiveAt"]
    const csv = [cols.join(',')]
      .concat(rows.map(r => cols.map(c => {
        if (c === 'deviceId') return `"${String(getDeviceIdFor(r) ?? '').replace(/"/g,'""')}"`
        return `"${String((r as any)[c] ?? '').replace(/"/g,'""')}"`
      }).join(',')))
      .join('\n')
    const blob = new Blob([csv], { type: 'application/vnd.ms-excel' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'assets.xls'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleShareSelected = async () => {
    const rows = getSelectedRows()
    if (!rows || rows.length === 0) {
      setServerMsgTitle('Notice')
      setServerMsg('Please select assets to share')
      setDeleteMsgOpen(true)
      return
    }
    // Share device IDs instead of internal _id
    const text = rows.map(r => `${r.name ?? ''} (${getDeviceIdFor(r) || r._id}) - ${r.location ?? ''}`).join('\n')
    try {
      if (navigator && (navigator as any).share) {
        await (navigator as any).share({ title: 'Asset List', text })
        // Use a transient toast for share success (do not open the modal)
        try { toast({ title: 'Shared asset list' }) } catch (e) {}
      } else if (navigator && (navigator as any).clipboard) {
        await (navigator as any).clipboard.writeText(text)
        try { toast({ title: 'Asset list copied to clipboard' }) } catch (e) {}
      } else {
        const blob = new Blob([text], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'assets.txt'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        try { toast({ title: 'Downloaded asset list as text' }) } catch (e) {}
      }
    } catch (e) {
      try { toast({ title: 'Failed to share asset list' }) } catch (err) {}
    }
  }


  const StatusPill = ({ status }: { status: AssetStatus }) => {
    const styles: Record<AssetStatus, string> = {
      Active: "bg-emerald-100 text-emerald-700 border-emerald-200",
      Inactive: "bg-zinc-100 text-zinc-700 border-zinc-200",
      Paused: "bg-amber-100 text-amber-700 border-amber-200",
      Fault: "bg-red-100 text-red-700 border-red-200",
    }
    return (
      <Badge variant="outline" className={`px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
        {status}
      </Badge>
    )
  }

  function getStatusLabel(a: ApiAsset): AssetStatus {
    const state = detectAssetState(a)
    // If heuristics returned 'alert' (unknown) but the asset was just created/updated
    // and has no explicit activity timestamps, prefer to show it as Inactive
    // so newly-added assets don't appear online immediately.
    if (state === 'alert') {
      const aa: any = a as any
      const hasExplicitActivity = !!(aa?.lastActiveAt || aa?.lastActive || aa?.lastSeen || aa?.lastSeenAt || aa?.last_online)
      const hasExplicitStatus = !!(aa?.status || aa?.active !== undefined)
      if (!hasExplicitActivity && !hasExplicitStatus) return 'Inactive'
    }
    return mapStateToAssetLabel(state)
  }

  const EllipsisIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M6 12a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 11-4 0 2 2 0 014 0zm6 2a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  )

  const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  )

  const ShareIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" />
      <path d="M16 6l-4-4-4 4" />
      <path d="M12 2v14" />
    </svg>
  )

  return (
    <AppShell>
      <Topbar title="Assets" searchQuery={query} onSearchChange={setQuery} />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">Assets Management</h1>
        <p className="text-muted-foreground">Manage and monitor your air purification assets</p>
      </div>

      {/* Toolbar */}
  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={country} onValueChange={handleCountryChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(COUNTRY_CITIES).map((c: string) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cityOptions.map((ct: string) => (
                <SelectItem key={ct} value={ct}>{ct}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="ghost" size="sm" className="gap-2" onClick={handleShareSelected}>
            <ShareIcon /> Share
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadSelected}>
            <DownloadIcon />
          </Button>
        </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-[260px]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="pl-9"
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Filter</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64 p-2">
              <div className="px-2 py-1">
                <p className="text-xs font-medium mb-1">Types</p>
                {typeOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No types available</p>
                ) : (
                  typeOptions.map((t) => (
                    <label key={t} className="flex items-center gap-2 px-1 py-1">
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(t)}
                        onChange={(e) => {
                          if ((e.target as HTMLInputElement).checked) setSelectedTypes((prev) => [...prev, t])
                          else setSelectedTypes((prev) => prev.filter((x) => x !== t))
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">{t}</span>
                    </label>
                  ))
                )}
              </div>
              <DropdownMenuSeparator />
              <div className="px-2 py-1">
                <p className="text-xs font-medium mb-1">Status</p>
                <label className="flex items-center gap-2 px-1 py-1">
                  <input type="radio" name="asset-status" checked={statusFilter === 'all'} onChange={() => setStatusFilter('all')} />
                  <span className="text-sm">All</span>
                </label>
                <label className="flex items-center gap-2 px-1 py-1">
                  <input type="radio" name="asset-status" checked={statusFilter === 'online'} onChange={() => setStatusFilter('online')} />
                  <span className="text-sm">Online</span>
                </label>
                <label className="flex items-center gap-2 px-1 py-1">
                  <input type="radio" name="asset-status" checked={statusFilter === 'offline'} onChange={() => setStatusFilter('offline')} />
                  <span className="text-sm">Offline</span>
                </label>
              </div>
              <DropdownMenuSeparator />
              <div className="px-2 py-2 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => { setSelectedTypes([]); setStatusFilter('all') }}>Clear</Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" asChild>
            <Link href="/assets/new">+ Add Asset</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 ">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">Assets Lists</CardTitle>
            <Badge variant="secondary" className="rounded-full">{data?.total ?? 0} assets</Badge>
          </div>
          <div />
        </CardHeader>
        <CardContent>
          {mounted && isLoading && <p className="text-xs text-muted-foreground">Loading assets…</p>}
          {mounted && error && (
            <p className="text-xs text-red-600">Failed to load assets. {String(error.message ?? error)}</p>
          )}
          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain rounded-md border">
              <table className="min-w-[1100px] w-full text-sm overscroll-x-contain">
              <thead className="bg-muted/50 text-left">
                <tr className="border-b">
                  <th className="px-2 py-2">
                    <Checkbox
                      aria-label="Select all"
                      checked={(filtered ?? []).length > 0 && selectedIds.length === (filtered ?? []).length}
                      onCheckedChange={(v: any) => {
                        const ids = (filtered ?? []).map((a) => a._id)
                        if (v) setSelectedIds(ids)
                        else setSelectedIds([])
                      }}
                    />
                  </th>
                  <th className="px-2 py-2 whitespace-nowrap">
                    <button type="button" className="font-medium" onClick={() => {
                      // toggle select all for visible (filtered) items
                      const ids = (filtered ?? []).map((a) => a._id)
                      if (ids.length === 0) return
                      const allSelected = ids.every((id) => selectedIds.includes(id))
                      setSelectedIds(allSelected ? [] : ids)
                    }}>Asset Name</button>
                  </th>
                  <th className="px-2 py-2 whitespace-nowrap">Device ID</th>
                  <th className="px-2 py-2">Location</th>
                  <th className="px-2 py-2">Coordinates</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Stakeholder</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Created</th>
                  <th className="px-2 py-2">Last Active</th>
                  <th className="px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 6).map((a, idx) => (
                  <tr key={`${a._id}-${idx}`} className="border-b hover:bg-muted/30">
                    <td className="px-2 py-2 align-middle">
                      <Checkbox
                        aria-label={`Select ${a.name ?? a._id}`}
                        checked={selectedIds.includes(a._id)}
                        onCheckedChange={(v: any) => {
                          if (v) setSelectedIds((prev) => Array.from(new Set([...prev, a._id])))
                          else setSelectedIds((prev) => prev.filter((id) => id !== a._id))
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 font-medium">{a.name ?? "—"}</td>
                    <td className="px-2 py-2 font-mono">{(() => {
                      const found = (normalizedAssets || []).find((n) => String(n.id) === String(a._id ?? (a as any).id))
                      return found?.deviceId ?? (a as any).deviceId ?? "—"
                    })()}</td>
                    <td className="px-2 py-2">{a.location ?? "—"}</td>
                    <td className="px-2 py-2 font-mono">
                      <div className="flex flex-col leading-tight">
                        <span>{a.lat ?? "—"}</span>
                        <span>{a.long ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">{a.type ?? "—"}</td>
                    <td className="px-2 py-2">{a.stakeholder ?? "—"}</td>
                    <td className="px-2 py-2"><StatusPill status={getStatusLabel(a)} /></td>
                    <td className="px-3 py-3 whitespace-nowrap">{a.createdAt ? formatMaintenanceDate(a.createdAt) : "—"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatMaintenanceDate(a.lastActiveAt)}</td>
                    <td className="px-3 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <EllipsisIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <Play className="text-foreground" /> Start Asset
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Pause className="text-foreground" /> Pause Asset
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Square className="text-foreground" /> Stop Asset
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Settings className="text-foreground" /> Configure
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => { setActiveAsset(a); setDetailsOpen(true) }}>
                            <Eye className="text-foreground" /> View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(a)}>
                            <Pencil className="text-foreground" /> Edit Asset
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => { setActiveAsset(a); setDeleteOpen(true) }}>
                            <Trash2 className="text-red-600" /> Delete Asset
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination (static) */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs text-muted-foreground">Page {data?.page ?? 1} of {data?.total ? Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 10))) : 1}</p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm">«</Button>
              <Button variant="outline" size="sm">‹</Button>
              <Button variant="outline" size="sm">›</Button>
              <Button variant="outline" size="sm">»</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* Recent Maintenance Log */}
      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
          <CardTitle className="text-lg">Recent Maintenance Log</CardTitle>
          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">View Calendar</Button>
              </PopoverTrigger>
              <PopoverContent className="!w-auto p-2">
                <div className="flex items-start gap-2">
                  <Calendar mode="single" selected={logDate} onSelect={(d) => setLogDate(d as Date | undefined)} />
                  <div className="flex flex-col gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setLogDate(undefined)}>Clear</Button>
                    <Button variant="secondary" size="sm" onClick={() => { /* just close popover by clicking outside */ }}>Done</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {(() => {
            const items = (data?.items ?? [])
              .flatMap(a => (a.maintenanceHistory ?? []).map(h => {
                // derive a simple type from history entry if explicit type not available
                const explicitType = (h as any).type
                let inferred: 'emergency' | 'preventive' | 'normal' = 'normal'
                if (explicitType) inferred = String(explicitType).toLowerCase() as any
                else if ((h.action ?? '').toLowerCase().includes('emergency')) inferred = 'emergency'
                else if ((h.action ?? '').toLowerCase().includes('preventive')) inferred = 'preventive'
                return ({
                  assetName: a.name ?? "—",
                  stakeholder: a.stakeholder ?? "—",
                  location: a.location ?? "—",
                  date: h.date,
                  action: h.action,
                  type: inferred,
                })
              }))
              .filter((m) => {
                // filter by selected type
                if (logTypeFilter && logTypeFilter !== 'all' && m.type !== logTypeFilter) return false
                // filter by selected date (compare YYYY/MM/DD)
                if (logDate) {
                  try {
                    const d1 = new Date(m.date)
                    const d2 = new Date(logDate)
                    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false
                    if (!(d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate())) return false
                  } catch (e) {
                    return false
                  }
                }
                return true
              })
              .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
              .slice(0, 3)

            if (!items.length) return <p className="text-sm text-muted-foreground">No maintenance logs found.</p>

            return (
              <div className="grid gap-3">
                {items.map((m, idx) => (
                  <div key={idx} className="w-full max-w-full overflow-x-auto">
                    <div className={`min-w-[700px] rounded-lg border p-3 ${idx % 3 === 0 ? 'bg-emerald-50 border-emerald-300' : idx % 3 === 1 ? 'bg-red-50 border-red-300' : 'bg-blue-50 border-blue-300'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium leading-tight">{m.assetName}</p>
                          <p className="text-sm text-muted-foreground">{m.action}</p>
                          <p className="mt-2 text-[11px] text-muted-foreground">Location: <span className="font-medium text-foreground">{m.location}</span></p>
                        </div>
                        <div className="text-right text-sm">
                          <p><span className="text-muted-foreground">Date:</span> {formatMaintenanceDate(m.date)}</p>
                          <p><span className="text-muted-foreground">Stakeholder:</span> {m.stakeholder}</p>
                        </div>
                      </div>
                      <div className="mt-2 text-sm">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${idx % 3 === 0 ? 'border-emerald-300 text-emerald-700 bg-emerald-100' : idx % 3 === 1 ? 'border-red-300 text-red-700 bg-red-100' : 'border-blue-300 text-blue-700 bg-blue-100'}`}>• Completed</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </CardContent>
      </Card>
      {/* Centralized details dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{activeAsset?.name ?? "Asset Details"}</DialogTitle>
            <DialogDescription>
              Stakeholder: {activeAsset?.stakeholder ?? "—"} • Type: {activeAsset?.type ?? "—"}
            </DialogDescription>
          </DialogHeader>
          {activeAsset && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-medium">{activeAsset.location ?? "—"}</p>
                </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Latitude</p>
                      <p className="font-medium">{activeAsset.lat ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Longitude</p>
                      <p className="font-medium">{activeAsset.long ?? "—"}</p>
                    </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{activeAsset.createdAt ? formatMaintenanceDate(activeAsset.createdAt) : "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Maintenance</p>
                  <p className="font-medium text-red-500">
                    {(() => {
                      const h = activeAsset.maintenanceHistory ?? []
                      if (!h.length) return "—"
                      const last = h.reduce((p, c) => (c.date > p.date ? c : p))
                      return formatMaintenanceDate(last.date)
                    })()}
                  </p>
                </div>
                      {/* IronRain specific supply info (if present) */}
                      {activeAsset.type === 'IronRain' && (
                        <div className="col-span-1 md:col-span-2">
                          <p className="text-sm text-muted-foreground">Supply</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Supply Fault</p>
                              <p className="font-medium">
                                {(() => {
                                  // prefer freshly fetched last reading, fall back to asset fields
                                  const source = assetLastReading ?? activeAsset
                                  const sf = (source as any)?.supplyFAULT ?? (source as any)?.supplyFault ?? null
                                  if (sf === undefined || sf === null) return '—'
                                  // show raw numeric value, but map common flags to friendly labels
                                  if (Number(sf) === 0) return 'No Fault'
                                  if (Number(sf) === 1) return 'Fault'
                                  return String(sf)
                                })()}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Supply Status</p>
                              <p className="font-medium">{(assetLastReading ?? activeAsset as any)?.supplySTATUS ?? (assetLastReading ?? activeAsset as any)?.supplyStatus ?? '—'}</p>
                            </div>
                          </div>
                        </div>
                      )}
              </div>

              {activeAsset.images && activeAsset.images.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Images</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {activeAsset.images.map((img, i) => (
                      <div key={i} className="rounded-md border p-1">
                        <img
                          src={img.startsWith("http") ? img : `${process.env.NEXT_PUBLIC_BACKEND_BASE_URL || ""}/uploads/${img}`}
                          alt={`asset-${i}`}
                          className="h-28 w-full rounded object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeAsset.maintenanceHistory && activeAsset.maintenanceHistory.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Maintenance History</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {activeAsset.maintenanceHistory.map((m, i) => (
                      <li key={i}>
                        <span className="font-medium">{m.action}</span> — <span className="text-muted-foreground">{formatMaintenanceDate(m.date)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Edit Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0">
          <SheetHeader>
            <SheetTitle>Edit Asset</SheetTitle>
          </SheetHeader>
          <ScrollArea className="max-h-[calc(100vh-6rem)] p-4">
          <div className="grid gap-3">
            <label className="text-sm font-medium">Name</label>
            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <label className="text-sm font-medium">Type</label>
            <Input value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} />
            <label className="text-sm font-medium">Location</label>
            <Input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
            <label className="text-sm font-medium">Stakeholder</label>
            <Input value={editForm.stakeholder} onChange={(e) => setEditForm({ ...editForm, stakeholder: e.target.value })} />
            <label className="text-sm font-medium">Device ID</label>
            <Select value={editForm.deviceId} onValueChange={(v) => setEditForm({ ...editForm, deviceId: v })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={loadingDevices ? 'Loading...' : (deviceIds.length ? 'Select Device ID' : 'No devices found')} />
              </SelectTrigger>
              <SelectContent>
                {deviceIds.length > 0 ? (
                  deviceIds.map((id) => (
                    <SelectItem key={id} value={id}>{id}</SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>No devices</SelectItem>
                )}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Latitude</label>
                <Input value={editForm.latitude} onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Longitude</label>
                <Input value={editForm.longitude} onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })} />
              </div>
            </div>
            <label className="text-sm font-medium">Action (required)</label>
            <Input placeholder="e.g. Replaced filter, Updated stakeholder" value={editForm.action} onChange={(e) => setEditForm({ ...editForm, action: e.target.value })} />
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
            </div>
          </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Shared success message dialog (delete/update) */}
      <AlertDialog open={deleteMsgOpen} onOpenChange={setDeleteMsgOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{serverMsgTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {serverMsg ?? "Operation completed successfully"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDeleteMsgOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete asset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {activeAsset?.name ?? "this asset"}? This action cannot be undone.
            </AlertDialogDescription>
            {deleteError && (
              <p className="text-sm text-red-600">{deleteError}</p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}
