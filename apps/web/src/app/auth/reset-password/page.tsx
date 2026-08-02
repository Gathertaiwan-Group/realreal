"use client"

import { useActionState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
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
import { resetPasswordAction } from "../actions"
import Link from "next/link"
import Image from "next/image"

export default function ResetPasswordPage() {
  const [state, formAction, isPending] = useActionState(resetPasswordAction, null)
  const searchParams = useSearchParams()
  // Carried from the emailed link and redeemed only on submit — see
  // resetPasswordAction for why the token is not verified on page load.
  const tokenHash = searchParams.get("token_hash") ?? ""

  useEffect(() => {
    if (state?.error) {
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
            <CardTitle className="text-xl" style={{ color: "#10305a" }}>設定新密碼</CardTitle>
            <CardDescription>請輸入您的新密碼</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="token_hash" value={tokenHash} />
              <div className="space-y-2">
                <Label htmlFor="password">新密碼</Label>
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
                <Label htmlFor="confirmPassword">確認新密碼</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="再次輸入新密碼"
                  minLength={8}
                  required
                />
              </div>
              {state?.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              <Button type="submit" className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }} disabled={isPending}>
                {isPending ? "更新中…" : "更新密碼"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <Link
              href="/auth/login"
              className="text-sm hover:underline"
              style={{ color: "#10305a" }}
            >
              返回登入
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
