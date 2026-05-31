"use client"

import { useCallback, useEffect, useState } from "react"
import { Settings as SettingsIcon, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdminTabs } from "../../_components/AdminTabs"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const SETTINGS_TABS = [
  { href: "/admin/settings", label: "系統參數" },
  { href: "/admin/settings/team", label: "團隊成員" },
  { href: "/admin/settings/email-templates", label: "Email 模板" },
  { href: "/admin/settings/carousel", label: "顧客回饋輪播" },
]

type Role = "admin" | "editor" | "viewer"

interface Member {
  user_id: string
  email: string | null
  display_name: string | null
  role: Role
  created_at: string
}

const ROLE_LABEL: Record<Role, string> = {
  admin: "管理員",
  editor: "編輯",
  viewer: "一般用戶",
}

export default function AdminTeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "editor">("editor")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const [{ data: { user } }, listRes] = await Promise.all([
        supabase.auth.getUser(),
        adminFetch(`${API_URL}/admin/team`),
      ])
      if (user) setCurrentUserId(user.id)
      if (!listRes.ok) throw new Error(await listRes.text())
      const data = (await listRes.json()) as { data: Member[] }
      setMembers(data.data)
    } catch (err) {
      console.error(err)
      toast.error("載入團隊成員失敗")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleInvite() {
    if (!inviteEmail.trim()) {
      toast.error("請輸入 Email")
      return
    }
    setBusy(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/team`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error((detail as { error?: string }).error ?? "新增失敗")
      }
      toast.success(`已加入：${inviteEmail}`)
      setInviteEmail("")
      setInviteRole("editor")
      setShowInvite(false)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleRoleChange(userId: string, newRole: Role) {
    setBusy(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/team/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error((detail as { error?: string }).error ?? "更新失敗")
      }
      toast.success("角色已更新")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(userId: string, email: string | null) {
    if (!confirm(`移除 ${email ?? "此成員"} 的後台權限？\n他的帳號保留、但無法再進管理後台（仍可購物）。`)) return
    setBusy(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/team/${userId}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error((detail as { error?: string }).error ?? "移除失敗")
      }
      toast.success("已移除")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <div className="mb-3 flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-[#10305a]" />
          <h1 className="text-2xl font-semibold text-[#10305a]">設定</h1>
        </div>
        <AdminTabs tabs={SETTINGS_TABS} />
        <p className="text-sm text-zinc-500">
          團隊成員管理。新增成員會把對方的角色升等為管理員或編輯；移除則是降回一般用戶（不會刪除其帳號和訂單）。
        </p>
      </header>

      <section className="rounded-2xl border border-[#10305a]/10 bg-white">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold text-[#10305a]">
            所有成員 {members.length > 0 && <span className="font-normal text-zinc-500">({members.length})</span>}
          </h2>
          {!showInvite && (
            <Button
              type="button"
              size="sm"
              onClick={() => setShowInvite(true)}
              className="bg-[#10305a] text-white hover:bg-[#10305a]/90"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              新增成員
            </Button>
          )}
        </div>

        {showInvite && (
          <div className="space-y-3 border-b bg-zinc-50/50 px-5 py-4">
            <p className="text-xs text-zinc-500">
              對方必須是已註冊用戶（請先請對方在前台用 Email 註冊一次）。
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="example@realreal.cc"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">角色</Label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "editor")}
                  className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
                >
                  <option value="editor">編輯</option>
                  <option value="admin">管理員</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowInvite(false)
                  setInviteEmail("")
                  setInviteRole("editor")
                }}
                disabled={busy}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleInvite}
                disabled={busy || !inviteEmail.trim()}
                className="bg-[#10305a] text-white hover:bg-[#10305a]/90"
              >
                {busy ? "處理中…" : "新增"}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">載入中…</p>
        ) : members.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            尚無管理員 / 編輯
          </p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => {
              const isSelf = m.user_id === currentUserId
              return (
                <li
                  key={m.user_id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[#10305a]">
                      {m.display_name?.trim() || m.email?.split("@")[0] || "—"}
                      {isSelf && (
                        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-normal text-zinc-500">
                          你
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {m.email ?? "（無 Email 紀錄）"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.user_id, e.target.value as Role)}
                      disabled={busy || isSelf}
                      className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="admin">{ROLE_LABEL.admin}</option>
                      <option value="editor">{ROLE_LABEL.editor}</option>
                      <option value="viewer">{ROLE_LABEL.viewer}</option>
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || isSelf}
                      onClick={() => handleRemove(m.user_id, m.email)}
                      className="h-8 w-8 p-0 text-red-500 hover:bg-red-50 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">移除</span>
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
