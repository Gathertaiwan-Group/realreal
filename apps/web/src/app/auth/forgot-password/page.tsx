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
import { forgotPasswordAction } from "../actions"
import Link from "next/link"
import Image from "next/image"

export default function ForgotPasswordPage() {
  const [state, formAction, isPending] = useActionState(forgotPasswordAction, null)
  const searchParams = useSearchParams()
  const callbackError = searchParams.get("error")

  useEffect(() => {
    if (state?.success) {
      toast.success("密碼重設郵件已寄出")
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [state])

  useEffect(() => {
    // /auth/confirm bounces expired/used recovery links back here with
    // ?error=link_expired — surface it so the user knows to re-request a link.
    if (callbackError) {
      toast.error(
        callbackError === "link_expired"
          ? "重設密碼連結已失效或已使用，請重新寄送連結"
          : decodeURIComponent(callbackError),
      )
    }
  }, [callbackError])

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center flex flex-col items-center">
          <Image src="/logo.svg" alt="誠真生活" width={150} height={75} />
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl" style={{ color: "#10305a" }}>忘記密碼</CardTitle>
            <CardDescription>
              輸入您的電子郵件，我們將寄送密碼重設連結給您
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
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
              {state?.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              {state?.success && (
                <p className="text-sm text-green-600">{state.success}</p>
              )}
              <Button type="submit" className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }} disabled={isPending}>
                {isPending ? "寄送中…" : "寄送重設連結"}
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
