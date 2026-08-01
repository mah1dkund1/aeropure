import AppShell from "@/components/app/shell"
import { Topbar } from "@/components/app/topbar"

export default function DataAnalysisPage() {
  return (
    <AppShell>
      <Topbar title="Dashboard" />
      <h1 className="mb-2 text-2xl font-semibold">History and Data Analytics</h1>
      <p className="text-sm text-muted-foreground">This section is under development.</p>
    </AppShell>
  )
}