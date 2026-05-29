import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import {
  ALLOWED_KEYS,
  SECRET_KEYS,
  SECTIONS,
  encryptSetting,
  decryptSetting,
  invalidateSetting,
  maskPreview,
} from "../lib/settings"

export const adminSettingsRouter = Router()

adminSettingsRouter.use(requireAuth, requireAdmin)

interface FieldState {
  set: boolean
  // For non-secret fields: the literal current value (or null if unset).
  // For secret fields: never returned.
  value?: string | null
  // For secret fields: last 4 chars, masked. For non-secret: undefined.
  preview?: string
}

type SettingsResponse = {
  sections: Array<{
    key: string
    label: string
    fields: Array<{ key: string; secret: boolean; state: FieldState }>
  }>
}

// GET /admin/settings
adminSettingsRouter.get("/", async (_req, res) => {
  // Pull all known settings in one query.
  const allKeys = Object.values(SECTIONS).flatMap((s) => s.keys)
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value_enc")
    .in("key", allKeys)
  if (error) {
    res.status(500).json({ error: "Failed to load settings", details: error.message })
    return
  }

  const map = new Map<string, string>()
  for (const row of data ?? []) {
    try {
      const plain = decryptSetting(row.value_enc as string)
      map.set(row.key as string, plain)
    } catch {
      // Corrupt row or rotated key — surface as unset; ops can re-save.
    }
  }

  const sections: SettingsResponse["sections"] = Object.entries(SECTIONS).map(
    ([sectionKey, section]) => ({
      key: sectionKey,
      label: section.label,
      fields: section.keys.map((key) => {
        const isSecret = SECRET_KEYS.has(key)
        const plain = map.get(key)
        const set = plain !== undefined && plain !== ""
        const state: FieldState = isSecret
          ? { set, preview: set ? maskPreview(plain!) : undefined }
          : { set, value: plain ?? null }
        return { key, secret: isSecret, state }
      }),
    }),
  )

  res.json({ sections })
})

// PUT /admin/settings
const putSchema = z.object({
  key: z.string().min(1).max(100),
  // null/empty string → unset; any other string → set
  value: z.union([z.string(), z.null()]),
})

adminSettingsRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }

  const { key, value } = parsed.data
  if (!ALLOWED_KEYS.has(key)) {
    res.status(400).json({ error: `Unknown setting key: ${key}` })
    return
  }

  const userId = (res.locals.userId as string | undefined) ?? null
  const isUnset = value === null || value === ""

  try {
    if (isUnset) {
      const { error: delError } = await supabase
        .from("app_settings")
        .delete()
        .eq("key", key)
      if (delError) throw delError
      await supabase
        .from("app_settings_audit")
        .insert({ key, action: "unset", changed_by: userId })
    } else {
      const enc = encryptSetting(value as string)
      const { error: upsertError } = await supabase.from("app_settings").upsert(
        {
          key,
          value_enc: enc,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        },
        { onConflict: "key" },
      )
      if (upsertError) throw upsertError
      await supabase
        .from("app_settings_audit")
        .insert({ key, action: "set", changed_by: userId })
    }

    invalidateSetting(key)
    res.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    res.status(500).json({ error: "Failed to save setting", details: msg })
  }
})

// GET /admin/settings/audit — recent 50 audit rows
adminSettingsRouter.get("/audit", async (_req, res) => {
  const { data, error } = await supabase
    .from("app_settings_audit")
    .select("id, key, action, changed_by, changed_at")
    .order("changed_at", { ascending: false })
    .limit(50)
  if (error) {
    res.status(500).json({ error: "Failed to load audit log", details: error.message })
    return
  }
  res.json({ rows: data ?? [] })
})
