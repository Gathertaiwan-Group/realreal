import { Router } from "express"

export const configRouter = Router()

// GET /config — public, non-sensitive storefront runtime flags.
//
// `allowTestPaid` mirrors the server-side gate (ALLOW_NON_ADMIN_TEST_PAID) that
// POST /orders enforces, so the checkout UI can show the sandbox "test_paid"
// option iff the server will actually accept it from a non-admin. Read here at
// runtime (server process.env) — deliberately NOT a NEXT_PUBLIC build-time flag,
// because that has to be inlined at build and is easy to get wrong / forget.
//
// ⚠️ test_paid marks an order paid WITHOUT real payment. Removing the single
// Railway env ALLOW_NON_ADMIN_TEST_PAID before go-live both hides the button
// (this flag flips to false) and makes the server reject it — atomic.
configRouter.get("/", (_req, res) => {
  res.json({
    allowTestPaid: process.env.ALLOW_NON_ADMIN_TEST_PAID === "true",
  })
})
