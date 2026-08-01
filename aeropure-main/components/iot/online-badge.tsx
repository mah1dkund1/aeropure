export function OnlineBadge({ state }: { state: 0 | 1 }) {
  const isOnline = state === 1
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs ${isOnline ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"}`}
      aria-label={isOnline ? "Online" : "Offline"}
    >
      <span className={`mr-1 h-1.5 w-1.5 rounded-full ${isOnline ? "bg-green-600" : "bg-gray-500"}`} />
      {isOnline ? "Online" : "Offline"}
    </span>
  )
}
