"use client"

import { useActionState, useEffect } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { registerAction } from "../actions"
import Link from "next/link"
import Image from "next/image"

export default function RegisterPage() {
  const [state, formAction, isPending] = useActionState(registerAction, null)
  // 生日不可能是未來 —— 讓日期選擇器自己擋掉，比讓人填完再被退件好。
  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (state?.success) {
      toast.success("註冊成功")
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [state])

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center flex flex-col items-center">
          <Image src="/logo.svg" alt="誠真生活" width={150} height={75} />
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl" style={{ color: "#10305a" }}>建立帳號</CardTitle>
            <CardDescription>填寫以下資訊以建立您的帳號</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">姓名</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  placeholder="您的姓名"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">電子郵件</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密碼</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="至少 8 個字元"
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthday">
                  生日 <span className="text-muted-foreground">（選填）</span>
                </Label>
                <Input id="birthday" name="birthday" type="date" max={today} />
                <p className="text-xs text-muted-foreground">
                  生日當月消費可享會員禮金（初心之友 NT$50、知心之友 NT$100、同心之友 NT$150）。
                  <span className="text-[#10305a]">送出後無法自行修改</span>，請確認填寫正確。
                </p>
              </div>
              {state?.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              {state?.success && (
                <p className="text-sm text-green-600">{state.success}</p>
              )}
              <Button type="submit" className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }} disabled={isPending}>
                {isPending ? "建立中…" : "註冊"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              已有帳號？{" "}
              <Link
                href="/auth/login"
                className="font-medium hover:underline"
                style={{ color: "#10305a" }}
              >
                立即登入
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
