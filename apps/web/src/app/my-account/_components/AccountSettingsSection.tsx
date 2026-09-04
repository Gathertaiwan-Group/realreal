"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronRight, MapPin, Pencil, Plus, Save, Trash2, User as UserIcon, X } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import {
  listUserAddresses,
  createUserAddress,
  updateUserAddress,
  deleteUserAddress,
  migrateLegacyAddresses,
  type UserAddress,
} from "@/lib/user-addresses"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface AccountSettingsSectionProps {
  /** Initial display name (server-fetched). */
  initialDisplayName: string
  /** Initial phone (server-fetched). */
  initialPhone: string
  /** 已設定的生日 (YYYY-MM-DD)；空字串代表還沒填過，此時才可輸入。 */
  initialBirthday: string
  /** Read-only auth email. */
  email: string
  /** Auto-expand on mount — used when redirected from a deleted sub-route. */
  defaultOpen?: boolean
}

const emptyAddressForm: Omit<UserAddress, "id"> = {
  name: "",
  phone: "",
  city: "",
  district: "",
  postal_code: "",
  address_line: "",
  is_default: false,
}

export function AccountSettingsSection({
  initialDisplayName,
  initialPhone,
  initialBirthday,
  email,
  defaultOpen = false,
}: AccountSettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section id="account-settings" className="mb-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl border border-[#10305a]/10 bg-white px-5 py-4 transition-colors hover:bg-zinc-50"
      >
        <div className="flex items-center gap-3 text-left">
          {open ? (
            <ChevronDown className="h-4 w-4 text-zinc-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-500" />
          )}
          <h2 className="text-lg font-semibold text-[#10305a]">帳號設定</h2>
        </div>
        <span className="text-xs text-zinc-500">
          {open ? "點擊收合" : "個人資料 · 收件地址"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-6 rounded-2xl border border-[#10305a]/10 bg-white p-5">
          <ProfileBlock
            initialDisplayName={initialDisplayName}
            initialPhone={initialPhone}
            initialBirthday={initialBirthday}
            email={email}
          />
          <hr className="border-zinc-100" />
          <AddressesBlock />
        </div>
      )}
    </section>
  )
}

function ProfileBlock({
  initialDisplayName,
  initialPhone,
  initialBirthday,
  email,
}: {
  initialDisplayName: string
  initialPhone: string
  initialBirthday: string
  email: string
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [phone, setPhone] = useState(initialPhone)
  // 生日填過就鎖住。資料庫也有 lock_birthday_once trigger 擋——這裡的唯讀只是
  // 別讓人白填一場，真正的鎖在資料庫，因為這個表單是前端直接寫 Supabase 的。
  const birthdayLocked = initialBirthday !== ""
  const [birthday, setBirthday] = useState(initialBirthday)
  const today = new Date().toISOString().slice(0, 10)
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const dirty =
    displayName !== initialDisplayName ||
    phone !== initialPhone ||
    (!birthdayLocked && birthday !== "")

  function handleSave() {
    startTransition(async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        toast.error("請先登入")
        return
      }
      const { error } = await supabase
        .from("user_profiles")
        .update({
          display_name: displayName.trim() || null,
          phone: phone.trim() || null,
          // 只在「本來沒有、這次填了」時送出生日。已鎖定的欄位連送都不送，
          // 免得 trigger 因為送了一個相同的值而誤判（is distinct from 會擋掉
          // 真正的變更，相同值本來就會通過，但不送最乾淨）。
          ...(!birthdayLocked && birthday ? { birthday } : {}),
        })
        .eq("user_id", user.id)
      if (error) {
        // 把資料庫回的原因直接顯示出來。原本這裡一律吞成「儲存失敗，請稍後再
        // 試」，於是生日欄位少了一個 column-level GRANT 時（0051 之前），畫面
        // 只說「請稍後再試」—— 而那個錯誤等到天荒地老也不會自己好。
        // 生日鎖與日期檢查本來就是用 raise exception 寫給人看的訊息。
        toast.error(error.message || "儲存失敗，請稍後再試")
        console.error("[my-account] profile save failed:", error)
        return
      }
      toast.success(
        !birthdayLocked && birthday ? "已儲存，生日設定完成" : "帳號資料已儲存",
      )
      if (!birthdayLocked && birthday) router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-[#10305a]">
        <UserIcon className="h-4 w-4" />
        個人資料
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="display-name">顯示名稱</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="您的名字"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">手機號碼</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09xxxxxxxx"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="birthday">生日</Label>
          <Input
            id="birthday"
            type="date"
            max={today}
            value={birthday}
            disabled={birthdayLocked}
            onChange={(e) => setBirthday(e.target.value)}
          />
          <p className="text-xs text-zinc-500">
            {birthdayLocked
              ? "生日已設定，如需更正請聯絡客服"
              : "生日當月消費享會員禮金；儲存後無法自行修改"}
          </p>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            value={email}
            disabled
            className="bg-zinc-50 text-zinc-500"
          />
          <p className="text-xs text-zinc-500">變更 Email 請聯絡客服</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!dirty || isPending}
          className="bg-[#10305a] text-white hover:bg-[#10305a]/90"
        >
          <Save className="mr-1.5 h-4 w-4" />
          {isPending ? "儲存中…" : "儲存個人資料"}
        </Button>
      </div>
    </div>
  )
}

function AddressesBlock() {
  const [addresses, setAddresses] = useState<UserAddress[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Omit<UserAddress, "id">>(emptyAddressForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await migrateLegacyAddresses()
      const list = await listUserAddresses()
      if (cancelled) return
      setAddresses(list)
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function openAdd() {
    setEditingId(null)
    setForm(emptyAddressForm)
    setShowForm(true)
  }
  function openEdit(addr: UserAddress) {
    setEditingId(addr.id)
    setForm({
      name: addr.name,
      phone: addr.phone,
      city: addr.city,
      district: addr.district,
      postal_code: addr.postal_code,
      address_line: addr.address_line,
      is_default: addr.is_default,
    })
    setShowForm(true)
  }
  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyAddressForm)
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.phone.trim() || !form.address_line.trim()) {
      toast.error("請填寫必要欄位（姓名、電話、地址）")
      return
    }
    setSaving(true)
    try {
      const saved = editingId
        ? await updateUserAddress(editingId, form)
        : await createUserAddress(form)
      if (!saved) {
        toast.error("儲存失敗，請稍後再試")
        return
      }
      setAddresses(await listUserAddresses())
      cancelForm()
      toast.success(editingId ? "地址已更新" : "地址已新增")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!(await deleteUserAddress(id))) {
      toast.error("刪除失敗")
      return
    }
    setAddresses(await listUserAddresses())
    toast.success("地址已刪除")
  }

  function updateField<K extends keyof Omit<UserAddress, "id">>(
    key: K,
    value: Omit<UserAddress, "id">[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-[#10305a]">
          <MapPin className="h-4 w-4" />
          收件地址
        </div>
        {!showForm && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openAdd}
            className="border-[#10305a]/30 text-[#10305a]"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            新增地址
          </Button>
        )}
      </div>

      {showForm && (
        <div className="space-y-3 rounded-[10px] border border-zinc-200 bg-zinc-50/50 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="addr-name">姓名 *</Label>
              <Input
                id="addr-name"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addr-phone">電話 *</Label>
              <Input
                id="addr-phone"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addr-postal">郵遞區號</Label>
              <Input
                id="addr-postal"
                value={form.postal_code}
                onChange={(e) => updateField("postal_code", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addr-city">縣市</Label>
              <Input
                id="addr-city"
                value={form.city}
                onChange={(e) => updateField("city", e.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="addr-line">詳細地址 *</Label>
              <Input
                id="addr-line"
                value={form.address_line}
                onChange={(e) => updateField("address_line", e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#687279]">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => updateField("is_default", e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-[#10305a] focus:ring-[#10305a]"
            />
            設為預設地址
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancelForm}>
              <X className="mr-1 h-3.5 w-3.5" />
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={saving}
              className="bg-[#10305a] text-white hover:bg-[#10305a]/90"
            >
              <Save className="mr-1 h-3.5 w-3.5" />
              {editingId ? "儲存變更" : "新增地址"}
            </Button>
          </div>
        </div>
      )}

      {hydrated && addresses.length === 0 && !showForm && (
        <p className="rounded-[10px] border border-dashed border-zinc-200 bg-zinc-50/50 py-6 text-center text-sm text-zinc-500">
          尚未新增收件地址
        </p>
      )}

      {addresses.length > 0 && (
        <ul className="space-y-2">
          {addresses.map((addr) => (
            <li
              key={addr.id}
              className="flex items-start justify-between gap-3 rounded-[10px] border border-zinc-200 bg-white p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[#10305a]">
                    {addr.name}
                  </p>
                  {addr.is_default && (
                    <span className="rounded-full bg-[#10305a]/10 px-2 py-0.5 text-[10px] font-medium text-[#10305a]">
                      預設
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{addr.phone}</p>
                <p className="mt-1 text-sm text-[#687279]">
                  {addr.postal_code} {addr.city} {addr.district} {addr.address_line}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(addr)}
                  className="h-8 w-8 p-0 text-zinc-500"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">編輯</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(addr.id)}
                  className="h-8 w-8 p-0 text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">刪除</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
