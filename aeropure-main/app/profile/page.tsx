"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export default function ProfilePage() {
  return (
    <div className="p-4">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src="/avatars/01.png" alt="User" />
            <AvatarFallback>AP</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold">Aeropure Admin</div>
            <div className="text-sm text-muted-foreground">admin@aeropure.local</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
