/**
 * 冪等鍵只該記住「成功」的回應。
 *
 * 這張表存在的理由是「同一筆訂單不要建立兩次」。失敗的請求根本沒有建立訂單，
 * 沒有什麼好保護的 —— 而把它存起來反而有害：前端在同一次送出中會重複使用同一
 * 把 Idempotency-Key，所以只要失敗被快取，之後每次重按都會立刻拿回一模一樣的
 * 錯誤，金流商連碰都不會碰到。#10000217（2026-09-07）就是這樣，客人按了好幾次
 * LINE Pay 都是同一個錯誤畫面。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Request, Response, NextFunction } from "express"

vi.mock("../../lib/supabase", () => {
  const insert = vi.fn().mockReturnValue({ then: (cb: any) => cb({ error: null }) })
  const maybeSingle = vi.fn().mockResolvedValue({ data: null })
  return {
    supabase: {
      from: vi.fn(() => ({
        insert,
        select: () => ({ eq: () => ({ gt: () => ({ maybeSingle }) }) }),
      })),
      __insert: insert,
      __maybeSingle: maybeSingle,
    },
  }
})

import { supabase } from "../../lib/supabase"
import { idempotencyMiddleware } from "../idempotency"

const KEY = "0123456789abcdef0123"
const insertMock = () => (supabase as any).__insert as ReturnType<typeof vi.fn>
const lookupMock = () => (supabase as any).__maybeSingle as ReturnType<typeof vi.fn>

function makeReqRes(statusCode: number) {
  const req = { headers: { "idempotency-key": KEY }, body: {} } as unknown as Request
  const res = {
    statusCode,
    json: vi.fn((b: any) => b),
    status: vi.fn().mockReturnThis(),
    locals: {},
  } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  return { req, res, next }
}

describe("冪等鍵中介層", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lookupMock().mockResolvedValue({ data: null })
  })

  it("★ 建單失敗（502）不寫入快取 —— 否則客人重按只會拿回同一個錯誤", async () => {
    const { req, res, next } = makeReqRes(502)
    await idempotencyMiddleware(req, res, next)
    res.json({ error: "Payment gateway error" })
    expect(insertMock()).not.toHaveBeenCalled()
  })

  it("★ 伺服器錯誤（500）同樣不寫入快取", async () => {
    const { req, res, next } = makeReqRes(500)
    await idempotencyMiddleware(req, res, next)
    res.json({ error: "Failed to create order address" })
    expect(insertMock()).not.toHaveBeenCalled()
  })

  it("★ 建單成功（201）要寫入快取 —— 重複送出才不會變成兩筆訂單", async () => {
    const { req, res, next } = makeReqRes(201)
    await idempotencyMiddleware(req, res, next)
    res.json({ data: { orderId: "o-1", orderNumber: "10000999" } })
    expect(insertMock()).toHaveBeenCalledTimes(1)
    expect(insertMock().mock.calls[0][0]).toMatchObject({ key: KEY, order_id: "o-1", status_code: 201 })
  })

  it("已快取的成功回應會被重播，不會再跑一次建單", async () => {
    lookupMock().mockResolvedValue({ data: { status_code: 201, response_body: { data: { orderId: "o-1" } } } })
    const { req, res, next } = makeReqRes(200)
    await idempotencyMiddleware(req, res, next)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(next).not.toHaveBeenCalled()
  })

  it("沒帶冪等鍵時直接放行", async () => {
    const req = { headers: {}, body: {} } as unknown as Request
    const { res } = makeReqRes(200)
    const next = vi.fn() as unknown as NextFunction
    await idempotencyMiddleware(req, res, next)
    expect(next).toHaveBeenCalled()
  })
})
