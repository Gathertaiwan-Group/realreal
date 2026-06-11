import { Router, type Request, type Response } from "express"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { z } from "zod"

export const variantsRouter = Router({ mergeParams: true })

type ProductParams = { id: string }
type VariantParams = { id: string; variantId: string }

const variantSchema = z.object({
  sku: z.string().optional(),
  name: z.string().min(1),
  price: z.number().positive(),
  sale_price: z.number().positive().nullable().optional(),
  stock_qty: z.number().int().nonnegative().optional(),
  weight: z.number().nonnegative().nullable().optional(),
  attributes: z.record(z.string(), z.string()).nullable().optional(),
})

// GET /products/:id/variants — public
variantsRouter.get("/", async (req: Request<ProductParams>, res: Response) => {
  const { data, error } = await supabase
    .from("product_variants")
    .select("*")
    .eq("product_id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [] })
})

// POST /products/:id/variants — admin only
variantsRouter.post("/", requireAuth, requireAdmin, async (req: Request<ProductParams>, res: Response) => {
  const parsed = variantSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("product_variants")
    .insert({ ...parsed.data, product_id: req.params.id })
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// PUT /products/:id/variants/:variantId — admin only
variantsRouter.put("/:variantId", requireAuth, requireAdmin, async (req: Request<VariantParams>, res: Response) => {
  const parsed = variantSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("product_variants")
    .update(parsed.data)
    .eq("id", req.params.variantId)
    .eq("product_id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Variant not found" }); return }
  res.json({ data })
})

// DELETE /products/:id/variants/:variantId — admin only
variantsRouter.delete("/:variantId", requireAuth, requireAdmin, async (req: Request<VariantParams>, res: Response) => {
  const { error } = await supabase
    .from("product_variants")
    .delete()
    .eq("id", req.params.variantId)
    .eq("product_id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})

// PATCH /products/:id/variants/:variantId/stock — ADMIN ONLY.
// delta: positive = restock, negative = reduce. (Checkout does NOT use this —
// it decrements stock server-side via the atomic_deduct_stock RPC. This is a
// manual admin adjustment endpoint, so it must be admin-gated; previously it
// only required auth, letting any logged-in customer rewrite inventory.)
variantsRouter.patch("/:variantId/stock", requireAuth, requireAdmin, async (req: Request<VariantParams>, res: Response) => {
  const parseResult = z.object({ delta: z.number().int() }).safeParse(req.body)
  if (!parseResult.success) { res.status(400).json({ error: parseResult.error.flatten() }); return }
  const { delta } = parseResult.data

  const { data: variant, error: fetchError } = await supabase
    .from("product_variants")
    .select("stock_qty")
    .eq("id", req.params.variantId)
    .single()

  if (fetchError || !variant) { res.status(404).json({ error: "Variant not found" }); return }

  const newQty = (variant.stock_qty ?? 0) + delta
  if (newQty < 0) { res.status(409).json({ error: "Insufficient stock" }); return }

  const { data, error } = await supabase
    .from("product_variants")
    .update({ stock_qty: newQty })
    .eq("id", req.params.variantId)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data })
})
