// Shared asset status heuristics used by dashboard and assets pages
// Returns a normalized status key and a mapper for UI labels

export type NormalizedAssetState = "online" | "offline" | "paused" | "alert"

function isRecentTimestamp(val: any, withinMs = 3600000) {
  if (!val) return false
  const d = new Date(String(val))
  if (isNaN(d.getTime())) return false
  return Date.now() - d.getTime() < withinMs
}

export function detectAssetState(a: any): NormalizedAssetState {
  // Accept many forms of explicit status
  const s = String(a?.status ?? "").toLowerCase().trim()
  if (s === "online" || s === "active" || s === "1" || s === "true") return "online"
  if (s === "inactive" || s === "offline" || s === "0" || s === "false") return "offline"
  if (s === "paused") return "paused"
  if (s === "fault" || s === "faulty" || s === "error" || s === "alert") return "alert"

  // Boolean/alternate flags
  if (a?.active === true) return "online"
  if (a?.active === false) return "offline"

  // Check common timestamp fields (recent -> online)
  const tsCandidates = [
    a?.lastActiveAt,
    a?.lastActive,
    a?.lastSeen,
    a?.lastSeenAt,
    a?.last_online,
  ]
  for (const c of tsCandidates) {
    if (isRecentTimestamp(c)) return "online"
  }

  // Heuristics used by Dashboard: maintenance hints and efficiency
  const eff = Number(a?.efficiency ?? a?.eff ?? 0)
  const lastAction = (a?.maintenanceHistory ?? [])
    .slice()
    .sort((x: any, y: any) => (y.date > x.date ? 1 : y.date < x.date ? -1 : 0))[0]?.action?.toLowerCase() ?? ""
  if (lastAction.includes("stop") || lastAction.includes("fault") || lastAction.includes("offline")) return "offline"
  if (Number.isFinite(eff) && eff >= 80) return "online"
  if (Number.isFinite(eff) && eff < 30) return "offline"

  // Default fallback: mark as alert to indicate unknown/needs attention
  return "alert"
}

export function mapStateToAssetLabel(state: NormalizedAssetState) {
  // Map normalized state to Assets page label set
  if (state === "online") return "Active"
  if (state === "offline") return "Inactive"
  if (state === "paused") return "Paused"
  return "Fault"
}
