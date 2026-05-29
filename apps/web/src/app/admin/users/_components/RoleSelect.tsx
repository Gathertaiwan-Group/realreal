"use client"

import { useState } from "react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const ROLES = ["admin", "editor", "viewer"] as const

interface RoleSelectProps {
  userId: string
  currentRole: string
}

export default function RoleSelect({ userId, currentRole }: RoleSelectProps) {
  const [role, setRole] = useState(currentRole)
  const [saving, setSaving] = useState(false)

  async function handleChange(newRole: string) {
    if (newRole === role) return
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/admin/users/${userId}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ role: newRole }),
      })
      if (res.ok) {
        setRole(newRole)
        toast.success("角色已更新")
      } else {
        toast.error("更新失敗")
      }
    } catch {
      toast.error("更新失敗")
    } finally {
      setSaving(false)
    }
  }

  return (
    <select
      value={role}
      onChange={(e) => handleChange(e.target.value)}
      disabled={saving}
      className="flex h-8 rounded-[10px] border border-input bg-transparent px-2 py-1 text-sm shadow-sm disabled:opacity-50"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  )
}
