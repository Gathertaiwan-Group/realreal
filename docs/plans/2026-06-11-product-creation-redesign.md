# Product Creation Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete admin product creation workflow that creates a product and all variants from one responsive form.

**Architecture:** Add an authenticated `POST /admin/products` endpoint that validates a nested product/variants payload and performs compensating cleanup if variant creation fails. Replace the minimal new-product page with a structured client form that reuses existing image, editor, and attribute components and sends one atomic-looking request.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Express, Zod, Supabase, Vitest, Tailwind CSS.

---

### Task 1: Product Creation Payload Helpers

**Files:**
- Create: `apps/web/src/lib/product-create.ts`
- Test: `apps/web/src/lib/__tests__/product-create.test.ts`

**Steps:**
1. Write failing tests for default variant creation, duplicate SKU detection, sale-price validation, and API payload construction.
2. Run `npm test -- src/lib/__tests__/product-create.test.ts` from `apps/web` and confirm failure.
3. Implement typed draft models, validation, and payload construction.
4. Re-run the focused test and confirm it passes.

### Task 2: Nested Product Creation API

**Files:**
- Modify: `apps/api/src/routes/products.ts`
- Test: `apps/api/src/routes/__tests__/products.test.ts`

**Steps:**
1. Write failing route tests for successful product-plus-variants creation, invalid duplicate SKUs, and variant-insert rollback.
2. Run `npx vitest run src/routes/__tests__/products.test.ts` from `apps/api`.
3. Add nested Zod schemas and `POST /admin/products`.
4. Insert the product, batch insert variants, and delete the product if variant insertion fails.
5. Re-run route tests.

### Task 3: Full Product Creation Form

**Files:**
- Replace: `apps/web/src/app/admin/products/new/page.tsx`
- Reuse: `apps/web/src/app/admin/products/[id]/AttributesEditor.tsx`
- Reuse: `apps/web/src/components/catalog/ProductImageUpload.tsx`

**Steps:**
1. Build the responsive sectioned form with basic data, images, content, variants, and publishing settings.
2. Fetch and flatten existing categories.
3. Support add, duplicate, delete, and edit variant cards.
4. Validate locally and display a top-level error summary.
5. Submit one payload to `POST /admin/products`.
6. Redirect to `/admin/products/:id` after success.

### Task 4: Verification

**Files:**
- Verify all files modified above.

**Steps:**
1. Run focused Web tests.
2. Run focused API tests.
3. Run ESLint on modified Web files.
4. Run `npm run build` in `apps/api`.
5. Run `npm run build` in `apps/web`.
