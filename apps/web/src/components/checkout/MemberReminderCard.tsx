import Link from "next/link"
import { Button } from "@/components/ui/button"

/**
 * Checkout step-1 reminder for logged-out visitors. Many customers only
 * realize AFTER placing an order that they checked out as a guest — missed
 * the first-purchase discount, 公益存款 points, or can't find the order under
 * "我的訂單". Rendered above 收件資訊 only while `!isLoggedIn` — the parent
 * page owns that check; this component has no visibility logic of its own.
 *
 * See docs/superpowers/specs/2026-08-30-guest-checkout-membership-awareness-design.md
 */
export function MemberReminderCard() {
  return (
    <div className="rounded-lg border bg-white p-5 text-left space-y-3">
      <p className="font-semibold" style={{ color: "#10305a" }}>🎁 已經是會員了嗎？</p>
      <p className="text-sm text-zinc-600 leading-relaxed">
        登入即可套用首購折抵與點數回饋
      </p>
      <Link href="/auth/login?next=/checkout" className="block">
        <Button className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }}>
          登入 →
        </Button>
      </Link>
    </div>
  )
}
