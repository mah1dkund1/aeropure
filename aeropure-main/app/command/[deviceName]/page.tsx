"use client"

import AppShell from "@/components/app/shell"
import { useApi } from "@/components/iot/use-fetcher"
import { useParams } from "next/navigation"
import { OnlineBadge } from "@/components/iot/online-badge"

export default function DeviceDetailPage() {
  const params = useParams<{ deviceName: string }>()
  const name = decodeURIComponent(params.deviceName)
  const { data: detail, isLoading: l1, error: e1 } = useApi<any>(`/api/iot/device/${encodeURIComponent(name)}`)
  const {
    data: latest,
    isLoading: l2,
    error: e2,
  } = useApi<any>(`/api/iot/device/${encodeURIComponent(name)}/latest?size=1`)
  const { data: tsl } = useApi<any>(`/api/iot/device/${encodeURIComponent(name)}/tsl`)

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-semibold">{name}</h1>
      {l1 && <p>Loading device…</p>}
      {e1 && <p className="text-red-600">Failed to load device.</p>}
      {detail && (
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Status</div>
            <div className="mt-1">
              <OnlineBadge state={detail.data?.onlineState ?? 0} />
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Created</div>
            <div className="mt-1">
              {detail.data?.createTime ? new Date(detail.data.createTime).toLocaleString() : "-"}
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Serial</div>
            <div className="mt-1">{detail.data?.serial ?? "-"}</div>
          </div>
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Latest data</h2>
        {l2 && <p>Loading…</p>}
        {e2 && <p className="text-red-600">Failed to load latest data.</p>}
        {latest && Array.isArray(latest.data) && latest.data[0] && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {Object.entries(latest.data[0]).map(([key, v]: any) => (
              <div key={key} className="rounded border p-3">
                <div className="text-xs text-muted-foreground">{key}</div>
                <div className="text-sm font-medium">{v?.name ?? "-"}</div>
                <div className="text-2xl">{v?.value ?? "-"}</div>
                <div className="text-xs text-muted-foreground">{v?.time ? new Date(v.time).toLocaleString() : "-"}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Location (Map placeholder)</h2>
        <div className="h-64 w-full rounded border bg-muted/40 flex items-center justify-center text-muted-foreground">
          Map coming soon
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">TSL (Object Model)</h2>
        {tsl?.data ? (
          <div className="overflow-auto rounded border">
            <table className="min-w-[800px] w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">Identifier</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Unit</th>
                  <th className="px-3 py-2 text-left">Min</th>
                  <th className="px-3 py-2 text-left">Max</th>
                </tr>
              </thead>
              <tbody>
                {tsl.data.map((t: any) => (
                  <tr key={t.id} className="border-t">
                    <td className="px-3 py-2">{t.identifier}</td>
                    <td className="px-3 py-2">{t.functionName}</td>
                    <td className="px-3 py-2">{t.dataType}</td>
                    <td className="px-3 py-2">{t.elementUnit ?? "-"}</td>
                    <td className="px-3 py-2">{t.minimumValue ?? "-"}</td>
                    <td className="px-3 py-2">{t.maximumValue ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No TSL found.</p>
        )}
      </section>
    </AppShell>
  )
}
