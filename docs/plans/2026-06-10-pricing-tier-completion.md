# Pricing, Tier, Sandbox Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the remaining 2026-06-09 audit items: migrate order money fields to real TWD values, make tier spend updates atomic/window-based, close sandbox payment exposure, and remove known payment/idempotency leftovers.

**Architecture:** Keep existing public column names for compatibility, but migrate stored values from cents to TWD and update all writers/readers accordingly. Move tier spend mutation into database RPCs for atomicity and keep TypeScript code as orchestration. Use additive migrations with idempotent guards so production can be applied once safely.

**Tech Stack:** Node/Express, TypeScript, Supabase/Postgres SQL migrations, Vitest.

---

### Task 1: Money Unit Migration

**Files:**
- Create: `packages/db/migrations/0034_money_units_twd_and_tier_atomic.sql`
- Modify: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/lib/enqueue-post-payment.ts`
- Modify: `apps/api/src/routes/admin-orders.ts`
- Modify: `apps/api/src/routes/admin-kols.ts`
- Modify: `apps/api/src/lib/refund-payment.ts`
- Modify: `apps/api/src/workers/logistics-creator.ts`
- Modify: `packages/db/src/schema/orders.ts`

**Steps:** add SQL data migration, change order/order_item writers to TWD, remove reader `/100` conversions, and verify with build/tests.

### Task 2: Tier Atomicity and Window Rules

**Files:**
- Modify: `apps/api/src/lib/tier.ts`
- Modify: `apps/api/src/lib/enqueue-post-payment.ts`
- Modify: `apps/api/src/lib/points.ts`
- Modify: `apps/api/src/workers/tier-expire.ts`
- Add/modify tests under `apps/api/test`.

**Steps:** use Postgres RPCs for spend increments/decrements, use subtotal-after-discounts excluding shipping for earn base, make tier expiry cascade to the highest tier matching period spend.

### Task 3: Sandbox and JKO Cleanup

**Files:**
- Modify: `apps/api/src/routes/orders.ts`
- Modify JKO/admin retry flows as needed.

**Steps:** gate `test_paid` to admin or explicit env flag, ensure failed JKO/payment initiation has a cleanup path and no silent stuck payment state.

### Task 4: Apply and Verify

**Files:**
- Modify: `docs/superpowers/specs/2026-06-09-U-pricing-correctness-audit-checkpoint.md`

**Steps:** apply Supabase migrations with provided access token, run focused tests/build, inspect remote schema/data samples, and update audit checkpoint.
