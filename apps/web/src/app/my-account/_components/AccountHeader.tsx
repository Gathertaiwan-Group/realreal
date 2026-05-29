"use client"

import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function AccountHeader({ displayName }: { displayName: string }) {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error("登出失敗，請再試一次")
      return
    }
    router.push("/")
    router.refresh()
  }

  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-[#10305a]">
          歡迎回來，{displayName}
        </h1>
        <p className="mt-1 text-sm text-[#687279]">管理您的訂單與帳號設定</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleLogout}
        className="shrink-0 border-[#10305a]/30 text-[#10305a] hover:bg-[#10305a]/5"
      >
        <LogOut className="mr-1.5 h-4 w-4" />
        登出
      </Button>
    </div>
  )
}
