"use client"

import AppShell from "@/components/app/shell"
import { Topbar } from "@/components/app/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { CalendarIcon, ImageIcon, MapPin, Settings as SettingsIcon } from "lucide-react"
import { useRef, useState, useEffect } from "react"
import { useDevices } from "@/components/iot/use-devices"
import { useAssets } from "@/components/iot/use-assets"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export default function NewAssetPage() {
  const [isSubmitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installDate, setInstallDate] = useState<Date | undefined>(undefined)
  const [stakeholder, setStakeholder] = useState<string>("")
  const [assetType, setAssetType] = useState<string>("")
  const [deviceIds, setDeviceIds] = useState<number[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("")
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [successOpen, setSuccessOpen] = useState(false)
  const [errorOpen, setErrorOpen] = useState(false)
  const router = useRouter()

  // Refs for file uploads
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Read devices and existing assets from hooks so we can filter out used ids
  const { devices: hookDevices } = useDevices()
  const { assets: existingAssets } = useAssets()

  // Fetch recent device ids from upstream data API so we can populate the Device ID dropdown
  useEffect(() => {
    let mounted = true
    const fetchDeviceIds = async () => {
      setLoadingDevices(true)
      try {
  // Request device list via local proxy to avoid CORS
  const resp = await fetch('/api/iot/getDevices')
        if (!resp.ok) throw new Error('Failed to fetch device list')
  const json = await resp.json()
  // Log raw upstream response for debugging (visible in browser console)
  console.log('[NewAsset] /getDevices raw response:', json)

        // The endpoint may return several shapes. Prefer a top-level `deviceIDs` array
        // and preserve its order (do not dedupe) so all ids show in the dropdown.
        if (Array.isArray(json?.deviceIDs)) {
          // Preserve upstream order but remove duplicates while filtering used ids
          const idsFromTop = (json.deviceIDs as any[])
            .map((v) => (typeof v === "number" ? v : Number(v)))
            .filter((v) => !isNaN(v))
          console.debug('[NewAsset] deviceIDs from response (preserve order):', idsFromTop)
          const used = new Set((existingAssets || []).map((a: any) => Number(a.deviceId ?? a.deviceID ?? a.id)).filter((n: number) => !isNaN(n)))
          const seen = new Set<number>()
          const available: number[] = []
          for (const id of idsFromTop) {
            if (used.has(id)) continue
            if (!seen.has(id)) {
              seen.add(id)
              available.push(id)
            }
          }
          if (mounted) {
            setDeviceIds(available)
            if (available.length) setSelectedDeviceId(String(available[0]))
          }
        } else {
          // Fallback: handle arrays of numbers/strings/objects and other wrappers
          let items: any[] = []
          if (Array.isArray(json)) items = json
          else if (Array.isArray(json?.devices)) items = json.devices
          else if (Array.isArray(json?.data)) items = json.data
          else items = []

          // Normalize items to numeric ids (dedupe here since source may be noisy)
          const ids = Array.from(
            new Set(
              items
                .map((r: any) => {
                  if (typeof r === 'number') return r
                  if (typeof r === 'string') return Number(r)
                  return Number(r?.deviceID ?? r?.deviceId ?? r?.id ?? r?.DeviceID ?? r?.deviceIDs)
                })
                .filter((v: number) => !isNaN(v))
            )
          ) as number[]
          ids.sort((a, b) => a - b)
          console.debug('[NewAsset] normalized device ids (fallback):', ids)
          // Filter out IDs already used by existing assets
          const used = new Set((existingAssets || []).map((a: any) => Number(a.deviceId ?? a.deviceID ?? a.id)).filter((n: number) => !isNaN(n)))
          const available = ids.filter((id) => !used.has(id))
          if (mounted) {
            setDeviceIds(available)
            if (available.length) setSelectedDeviceId(String(available[0]))
          }
        }
      } catch (err) {
        // Non-fatal: leave deviceIds empty
        console.warn('Failed to load device ids for asset form:', err)
      } finally {
        if (mounted) setLoadingDevices(false)
      }
    }

    fetchDeviceIds()
    return () => { mounted = false }
  }, [])

  // Also read device IDs from the app's device hook as a fallback (no CORS/network issues)
  useEffect(() => {
    if ((deviceIds?.length || 0) > 0) return // already have ids from fetch
    try {
      // Normalize device id fields from different sources. hookDevices may expose numbers or objects.
      const idsFromHook = Array.from(
        new Set(
          (hookDevices || []).map((d: any) => {
            if (typeof d === 'number') return d
            return Number(d?.deviceID ?? d?.deviceId ?? d?.id ?? d?.DeviceID ?? d?.deviceIDs)
          }).filter((v: number) => !isNaN(v))
        )
      )
      idsFromHook.sort((a, b) => a - b)
      if (idsFromHook.length > 0) {
        setDeviceIds(idsFromHook)
        setSelectedDeviceId(String(idsFromHook[0]))
      } else {
        // Hardcode fallback if both sources fail
        const fallbackIds = [1, 101]
        setDeviceIds(fallbackIds)
        setSelectedDeviceId(String(fallbackIds[0]))
      }
    } catch (err) {
      // ignore
    }
  }, [hookDevices, deviceIds])

  // Dummy submit to simulate save
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    // Prevent creating duplicate asset for same device id (client-side quick check)
    if (selectedDeviceId) {
      const selectedNum = Number(selectedDeviceId)
      if (!isNaN(selectedNum) && (existingAssets || []).some((a: any) => Number(a.deviceId) === selectedNum)) {
        setError(`An asset already exists for device id ${selectedDeviceId}. Please edit the existing asset instead.`)
        setErrorOpen(true)
        setSubmitting(false)
        return
      }
    }
    try {
      const formEl = e.currentTarget
      const fd = new FormData(formEl)

      // Compose backend-specific payload
      const name = (fd.get("name") as string) || ""
      // Duplicate name check (case-insensitive, trimmed)
      const nameNorm = name.trim().toLowerCase()
      if (nameNorm) {
        const nameDup = (existingAssets || []).some((a: any) => String(a?.name || '').trim().toLowerCase() === nameNorm)
        if (nameDup) {
          setError(`An asset with the name "${name.trim()}" already exists. Choose a different name.`)
          setErrorOpen(true)
          setSubmitting(false)
          return
        }
      }
      const type = (fd.get("type") as string) || ""
      const city = (fd.get("city") as string) || ""
      const locationOnly = (fd.get("location") as string) || ""
  // stakeholder is from headless Select; manage via state
      const latitude = (fd.get("latitude") as string) || ""
      const longitude = (fd.get("longitude") as string) || ""

      // Backend expects location as "City,Location"
      const location = city && locationOnly ? `${city},${locationOnly}` : city || locationOnly

    // Build FormData for backend (supports files)
    const out = new FormData()
    out.set("name", name)
    // Prefer selected headless Select value for type if provided, otherwise fall back to form value
    out.set("type", assetType || type)
    out.set("location", location)
  if (stakeholder) out.set("stakeholder", stakeholder)
    out.set("latitude", latitude)
    out.set("longitude", longitude)
  // Include selected Device ID when available. The backend expects this as `id`.
  if (selectedDeviceId) out.set("id", selectedDeviceId)

      // Append files[] if any
      if (fileInputRef.current?.files?.length) {
        Array.from(fileInputRef.current.files).forEach((f) => out.append("files", f, f.name))
      }

      const res = await fetch("/api/assets", {
        method: "POST",
        body: out,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.error || json?.message || `Request failed (${res.status})`)
      }

      // Success: reset and show modal, then navigate back
      formEl.reset()
      if (fileInputRef.current) fileInputRef.current.value = ""
      setSuccessOpen(true)
    } catch (err: any) {
      setError(err?.message || "Failed to create asset")
      setErrorOpen(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell>
      <Topbar title="Assets" />
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Assets Management</h1>
        <p className="text-muted-foreground">Manage and monitor your air purification assets</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5" /> Basic Details
            </CardTitle>
            <p className="text-sm text-muted-foreground">Essential asset details and identification</p>
          </CardHeader>
          <CardContent>
            <FieldSet>
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Asset Name</FieldLabel>
                    <FieldContent>
                      <Input name="name" placeholder="e.g IonRain Tower# 03" required />
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel>Device ID</FieldLabel>
                    <FieldContent>
                      <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={loadingDevices ? 'Loading...' : (deviceIds.length ? 'Select Device ID' : 'No devices found')} />
                        </SelectTrigger>
                        <SelectContent>
                          {deviceIds.length > 0 ? (
                            deviceIds.map((id) => (
                              <SelectItem key={id} value={String(id)}>{String(id)}</SelectItem>
                            ))
                          ) : (
                            <SelectItem value="none" disabled>No devices</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel>Asset Type</FieldLabel>
                    <FieldContent>
                      <Select value={assetType} onValueChange={setAssetType}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select Asset Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SenseMesh">SenseMesh</SelectItem>
                          <SelectItem value="IonRain">IonRain</SelectItem>
                          <SelectItem value="IndusESP">IndusESP</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel>Installation Date</FieldLabel>
                    <FieldContent>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn("w-full justify-start text-left font-normal", !installDate && "text-muted-foreground")}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {installDate ? installDate.toLocaleDateString() : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={installDate}
                            onSelect={setInstallDate}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel>Stakeholder</FieldLabel>
                    <FieldContent>
                      <Select value={stakeholder} onValueChange={setStakeholder}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select Stakeholder" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="City Municipality">City Municipality</SelectItem>
                          <SelectItem value="Private Developer">Private Developer</SelectItem>
                          <SelectItem value="Environmental Agency">Environmental Agency</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldContent>
                  </Field>

                  <Field className="md:col-span-1 md:row-span-2">
                    <FieldLabel>Images</FieldLabel>
                    <FieldDescription>Click to upload images or drag and drop files here</FieldDescription>
                    <div className="border-dashed rounded-md border p-6 text-center text-sm text-muted-foreground grid place-items-center h-[120px]">
                      <div className="flex flex-col items-center gap-1">
                        <ImageIcon className="h-6 w-6" />
                        <span>Supports: JPG, PNG, WEBP (Max 10MB each)</span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        Upload Images
                      </Button>
                    </div>
                    <input
                      ref={fileInputRef}
                      name="files"
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf"
                      className="mt-2 text-sm"
                    />
                  </Field>

                  <Field>
                    {/* Efficiency removed per requirements */}
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" /> Location & Coordinates
            </CardTitle>
            <p className="text-sm text-muted-foreground">Geographical positioning and address information</p>
          </CardHeader>
          <CardContent>
            <FieldSet>
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Location</FieldLabel>
                    <FieldContent>
                      <Input name="location" placeholder="e.g DownTown District" />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>City</FieldLabel>
                    <FieldContent>
                      <Input name="city" placeholder="e.g Islamabad" />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>Latitude</FieldLabel>
                    <FieldContent>
                      <InputGroup>
                        <InputGroupInput name="latitude" placeholder="e.g 40.712" inputMode="decimal" />
                      </InputGroup>
                    </FieldContent>
                  </Field>
                  {/* Device ID moved to Basic Details per UI request */}
                  <Field>
                    <FieldLabel>Longitude</FieldLabel>
                    <FieldContent>
                      <InputGroup>
                        <InputGroupInput name="longitude" placeholder="e.g -74" inputMode="decimal" />
                      </InputGroup>
                    </FieldContent>
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </CardContent>
        </Card>

        {/* Removed Technical Specifications and other extra fields not accepted by server */}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/assets")}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Asset"}</Button>
        </div>
        {error && <p className="text-sm text-red-600 text-right">{error}</p>}
      </form>

      {/* Success Alert Dialog */}
      <AlertDialog open={successOpen} onOpenChange={(o) => { setSuccessOpen(o); if (!o) router.push("/assets") }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Asset created</AlertDialogTitle>
            <AlertDialogDescription>
              Your asset has been created successfully.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => router.push("/assets")}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Error Alert Dialog */}
      <AlertDialog open={errorOpen} onOpenChange={setErrorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Failed to create asset</AlertDialogTitle>
            <AlertDialogDescription>
              {error ?? "An unexpected error occurred. Please try again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorOpen(false)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}