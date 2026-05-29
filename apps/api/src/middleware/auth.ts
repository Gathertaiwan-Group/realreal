import type { Request, Response, NextFunction } from "express"
import { supabase } from "../lib/supabase"

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" }); return
  }
  const token = authHeader.slice(7)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) { res.status(401).json({ error: "Invalid token" }); return }

  res.locals.userId = user.id
  res.locals.userEmail = user.email
  next()
}

/**
 * Same as requireAuth, but does NOT reject when the token is missing or
 * invalid. Used by endpoints that work for both logged-in users and guests
 * (e.g. POST /orders) — when the user happens to be authenticated, we want
 * to link the result to their account; when they're not, we proceed as guest.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) {
    next(); return
  }
  const token = authHeader.slice(7)
  try {
    const { data: { user } } = await supabase.auth.getUser(token)
    if (user) {
      res.locals.userId = user.id
      res.locals.userEmail = user.email
    }
  } catch {
    // Bad/expired token — fall through silently as guest.
  }
  next()
}
