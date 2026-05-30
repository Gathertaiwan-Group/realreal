import { NextResponse, type NextRequest } from "next/server"

const SLUG_RE = /^[a-z0-9-]+$/
const SEVEN_DAYS = 60 * 60 * 24 * 7

export function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const ref = req.nextUrl.searchParams.get("ref")

  if (ref && SLUG_RE.test(ref)) {
    res.cookies.set("kol_ref", ref, {
      maxAge: SEVEN_DAYS,
      sameSite: "lax",
      httpOnly: false,
      secure: true,
      path: "/",
    })
    res.cookies.set("kol_ref_set_at", new Date().toISOString(), {
      maxAge: SEVEN_DAYS,
      sameSite: "lax",
      httpOnly: false,
      secure: true,
      path: "/",
    })
  }

  return res
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|api).*)"],
}
