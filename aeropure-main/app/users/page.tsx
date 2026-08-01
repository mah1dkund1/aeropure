"use client"

import AppShell from "@/components/app/shell"
import { Topbar } from "@/components/app/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Eye, EyeOff, DownloadIcon, UserPlus, MoreVertical } from "lucide-react"
import { useMemo, useState } from "react"

type UserStatus = "Active" | "Inactive" | "Suspended"
type User = {
	name: string
	role: string
	department: string
	email: string
	contact: string
	status: UserStatus
	lastLogin: string
	lastLoginTime: string
}

const StatusPill = ({ status }: { status: UserStatus }) => {
	const styles: Record<UserStatus, string> = {
		Active: "bg-emerald-100 text-emerald-700 border-emerald-200",
		Inactive: "bg-slate-100 text-slate-600 border-slate-200",
		Suspended: "bg-red-100 text-red-700 border-red-200",
	}
	return (
		<Badge variant="outline" className={`px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
			{status}
		</Badge>
	)
}

export default function UserManagementPage() {
	const [query, setQuery] = useState("")
	const [dialogOpen, setDialogOpen] = useState(false)
	const [showPassword, setShowPassword] = useState(false)

	const users: User[] = [
		{
			name: "Michael Richardson",
			role: "System Administrator",
			department: "IT Administration",
			email: "admin@aeropure.com",
			contact: "+1-555-0001",
			status: "Active",
			lastLoginTime: "16:36:06",
			lastLogin: "Jan 15, 2024",
		},
		{
			name: "Jennifer Martinez",
			role: "System Operator",
			department: "Operations",
			email: "operator@aeropure.com",
			contact: "+1-555-0002",
			status: "Active",
			lastLoginTime: "16:36:06",
			lastLogin: "Jan 15, 2024",
		},
		{
			name: "Dr. Amanda Foster",
			role: "Data Analyst",
			department: "Analytics",
			email: "analyst@aeropure.com",
			contact: "+1-555-0003",
			status: "Inactive",
			lastLoginTime: "16:36:06",
			lastLogin: "Jan 15, 2024",
		},
		{
			name: "Robert Kim",
			role: "Operator",
			department: "Operations",
			email: "robert.kim@aeropure.com",
			contact: "+1-555-2104",
			status: "Active",
			lastLoginTime: "16:36:06",
			lastLogin: "Jan 15, 2024",
		},
		{
			name: "Sarah Elizabeth",
			role: "Data Analyst",
			department: "Analytics",
			email: "sarah.johnson@aeropure.com",
			contact: "+1-555-0005",
			status: "Suspended",
			lastLoginTime: "16:36:06",
			lastLogin: "Jan 15, 2024",
		},
		{
			name: "Gregory T. Wallace",
			role: "Viewer",
			department: "Management",
			email: "Deleted automation rule",
			contact: "+1-555-0008",
			status: "Active",
			lastLoginTime: "16:36:06",
			lastLogin: "Jan 15, 2024",
		},
	]

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return users.filter((u) =>
			[u.name, u.role, u.department, u.email, u.contact].some((v) => v.toLowerCase().includes(q))
		)
	}, [query])

	return (
		<AppShell>
			<Topbar title="Users" />
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">User Management</h1>
					<p className="text-muted-foreground">Manage user access and permissions</p>
				</div>

				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button size="sm" className="gap-2">
							<UserPlus /> Add User
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Add New Integration</DialogTitle>
							<DialogDescription>
								Configure a new external integration to connect third-party services and data sources to the AeroPure platform.
							</DialogDescription>
						</DialogHeader>

						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<label className="text-sm font-medium">Full Name</label>
								<Input placeholder="Enter full name" />
							</div>
							<div>
								<label className="text-sm font-medium">Email</label>
								<Input placeholder="Enter email address" type="email" />
							</div>
							<div>
								<label className="text-sm font-medium">Role</label>
								<Select>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Viewer" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="viewer">Viewer</SelectItem>
										<SelectItem value="operator">Operator</SelectItem>
										<SelectItem value="analyst">Data Analyst</SelectItem>
										<SelectItem value="admin">System Administrator</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div>
								<label className="text-sm font-medium">Department</label>
								<Select>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Operations" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="operations">Operations</SelectItem>
										<SelectItem value="analytics">Analytics</SelectItem>
										<SelectItem value="it">IT Administration</SelectItem>
										<SelectItem value="management">Management</SelectItem>
									</SelectContent>
								</Select>
							</div>

							<div>
								<label className="text-sm font-medium">Phone No.</label>
								<Input placeholder="Enter phone number" />
							</div>
							<div>
								<label className="text-sm font-medium">Password*</label>
								<InputGroup>
									<InputGroupInput placeholder="Enter password" type={showPassword ? "text" : "password"} />
									<InputGroupAddon align="inline-end">
										<button type="button" onClick={() => setShowPassword((s) => !s)} className="text-muted-foreground">
											{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
										</button>
									</InputGroupAddon>
								</InputGroup>
							</div>

							<div className="sm:col-span-2">
								<label className="text-sm font-medium">Notes</label>
								<Input placeholder="Additional notes about the user" />
							</div>
						</div>

						<DialogFooter className="mt-4">
							<Button type="reset" variant="outline">Reset</Button>
							<Button onClick={() => setDialogOpen(false)}>Create User</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0">
					<div className="flex items-center gap-3">
						<CardTitle className="text-xl">Activity History</CardTitle>
						<Badge variant="secondary" className="rounded-full">6 records</Badge>
					</div>
					<div />
				</CardHeader>
				<CardContent>
					<div className="mb-3 flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
						<Button variant="outline" size="sm" className="gap-2">
							<DownloadIcon className="h-4 w-4" />
						</Button>
						<Button variant="outline" size="sm">Filter</Button>
					</div>

					<div className="overflow-auto rounded-md border">
						<table className="w-full min-w-[1000px] text-sm">
							<thead className="bg-muted/50 text-left">
								<tr className="border-b">
									<th className="px-3 py-3"><Checkbox aria-label="Select all" /></th>
									<th className="px-3 py-3">Name</th>
									<th className="px-3 py-3">Role</th>
									<th className="px-3 py-3">Department</th>
									<th className="px-3 py-3">Email</th>
									<th className="px-3 py-3">Contact</th>
									<th className="px-3 py-3">Status</th>
									<th className="px-3 py-3">Last Login</th>
									<th className="px-3 py-3 text-right">Actions</th>
								</tr>
							</thead>
							<tbody>
								{filtered.map((u, idx) => (
									<tr key={`${u.email}-${idx}`} className="border-b hover:bg-muted/30">
										<td className="px-3 py-3 align-middle">
											<Checkbox aria-label={`Select ${u.name}`} />
										</td>
										<td className="px-3 py-3 font-medium">{u.name}</td>
										<td className="px-3 py-3">{u.role}</td>
										<td className="px-3 py-3">{u.department}</td>
										<td className="px-3 py-3 text-muted-foreground">{u.email}</td>
										<td className="px-3 py-3">{u.contact}</td>
										<td className="px-3 py-3"><StatusPill status={u.status} /></td>
										<td className="px-3 py-3 whitespace-nowrap">
											<div className="flex flex-col leading-tight">
												<span className="tabular-nums">{u.lastLoginTime}</span>
												<span className="text-xs text-muted-foreground">{u.lastLogin}</span>
											</div>
										</td>
										<td className="px-3 py-3 text-right">
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" size="icon" className="h-8 w-8">
														<MoreVertical className="h-5 w-5" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem>View profile</DropdownMenuItem>
													<DropdownMenuItem>Edit user</DropdownMenuItem>
													<DropdownMenuItem>Deactivate</DropdownMenuItem>
													<DropdownMenuItem className="text-red-600">Remove</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
		</AppShell>
	)
}
