# 訂單狀態細分 + 已完成自動觸發 + 後台取消訂單一鍵全做

**Date:** 2026-05-30
**Status:** Draft → Pending user review
**Touches:** apps/api (1 new route, 1 webhook tweak, 2 lib files), apps/web (1 helper, admin list + detail UI), packages/db (1 migration), 0 breaking enum changes

## Why

Admin 後台目前看到的「訂單進度」只有 4 段（訂單建立 → 確認付款 → 已出貨 → 已完成），對實際物流生命週期細節無感：

- 顧客有沒有去 7-11/全家取貨？看不到。
- 宅配的「配達」和超商的「到店待取」在後台同樣顯示「已出貨」，無法分流出貨經驗。
- 7 天過期未取貨自動退回的情況，後台不會自動感知。
- 「取消訂單」按鈕只翻 `orders.status='cancelled'`，不退款、不作廢發票、不取消綠界物流單，admin 必須自己分別去三個系統善後。

業務需求：以後超商取貨會放大量，admin 一定要能在後台一眼看到「客人取了沒」+「過期未取要重新出貨還是退錢」+ 取消訂單時不要漏退款／漏作廢。

## Scope

### IN

1. **狀態細分（UI 層推導）** — `order.status` enum 不動，6 值維持；後台用 `(order.status, logistics.status, logistics.type)` 推導出 7+ 個顯示狀態 + filter chip。
2. **已完成自動觸發** — 綠界 webhook 收到 LogisticsStatus=3018（CVS 取貨）或 TCAT 配達狀態 → `orders.status='completed' + completed_at=NOW()`。手動「完成訂單」按鈕保留為 fallback。
3. **後台取消訂單一鍵全做** — POST `/admin/orders/:id/cancel` 同步串四步：作廢發票 → 取消綠界物流 → 退款 → 翻 status。每步獨立 try/catch，UI 顯示 per-step 結果。
4. **TCAT 宅配 status code 對應表補齊** + 「過期未取退回」(3022) 處理。

### OUT (future)

- **顧客取貨後退貨流程**（折讓單 / 部分退款 / 收回貨品入庫）— 另案。本案 cancel 按鈕只在 `status ∈ {pending, processing, shipped}` 出現，`completed` 後 admin 想退錢得走另案。
- **金流真退款 API 整合**（pchomepay / linepay / jkopay 各自 refund endpoint）— 本案的 refund step 標 `payment_status='refunded'` + 寫 admin notification「請至 X 後台手動退款」，code 留 hook 給未來接 API。
- **訂閱單取消** — 訂閱單有獨立 `subscriptions.status` flow，不在本案。

## Design

### Section 1 — 顯示狀態推導

#### 共用 helper

`apps/web/src/lib/order-display-status.ts`（新檔，前後台共用）

```ts
export type DisplayStatusKey =
  | "awaiting_payment"     // 待付款
  | "awaiting_shipment"    // 待出貨
  | "dispatched"           // 待出貨（已派工）
  | "in_transit"           // 運送中
  | "arrived_cvs"          // 已到店待取（only CVS）
  | "picked_up"            // 已取貨（CVS）
  | "delivered"            // 已配達（HOME）
  | "returned_unclaimed"   // 過期未取退回
  | "cancelled"            // 已取消
  | "failed"               // 失敗

export interface DisplayStatus {
  key: DisplayStatusKey
  label: string
  color: "gray" | "blue" | "amber" | "green" | "red"
}

export function getOrderDisplayStatus(
  order: { status: string },
  logistics: { status: string; type: string } | null,
): DisplayStatus {
  // exhaustive mapping — see table below
}
```

#### 對應表

| order.status | logistics.status | logistics.type | DisplayStatusKey | 標籤 | 顏色 |
|---|---|---|---|---|---|
| pending | — | — | awaiting_payment | 待付款 | gray |
| processing | null | — | awaiting_shipment | 待出貨 | blue |
| processing | pending | — | dispatched | 已派工 | blue |
| shipped | in_transit | * | in_transit | 運送中 | blue |
| shipped | arrived_cvs | CVS | arrived_cvs | 已到店待取 | amber |
| completed | delivered | CVS | picked_up | 已取貨 | green |
| completed | delivered | HOME | delivered | 已配達 | green |
| failed | returned | * | returned_unclaimed | 過期未取退回 | red |
| cancelled | — | — | cancelled | 已取消 | gray |
| failed | — | — | failed | 失敗 | red |

`logistics.type` 來源：worker 建單時寫入，CVS C2C = `"CVS"`，宅配 = `"HOME"`（已實作 in `workers/logistics-creator.ts`）。

#### UI 使用

1. **`/admin/orders` list page**: 既有 status column 換成 `getOrderDisplayStatus(order, order.logistics?.[0])` 推導出的 badge。
2. **`/admin/orders/[id]` detail page**:
   - 頁面標頭右上的 badge 改用 display status
   - 進度條（目前 4 點）改成兩種 timeline：
     - **CVS**: 建單 → 已派工 → 運送中 → 已到店待取 → 已取貨（5 點）
     - **HOME**: 建單 → 已派工 → 運送中 → 已配達（4 點）
   - 取消／失敗狀態時 timeline 收摺成 banner。
3. **List filter chips**: 沿用 display status key 做 query param `?display=arrived_cvs` 等。

### Section 2 — 已完成自動觸發

#### Webhook 邏輯（apps/api/src/routes/webhooks/ecpay-logistics.ts）

目前 mapping：
```ts
const statusMap: Record<string, string> = {
  "300":  "in_transit",
  "3024": "arrived_cvs",
  "3018": "delivered",
  "3022": "failed",
}
```

問題：
- 上述只覆蓋 CVS C2C status code。TCAT 宅配的 RtnCode 不同。
- `3018 → delivered` 已有，但更新 `orders.status='completed'` 那行（webhook 第 70 行）需確認也設 `completed_at`。
- `3022 → failed` 沒對應 `orders.status` update，需要決定怎麼推回 admin 注意。

修改：

```ts
// per-type maps; default sub-map = CVS to preserve current behaviour
const CVS_STATUS_MAP: Record<string, string> = {
  "300":  "in_transit",
  "3024": "arrived_cvs",
  "3018": "delivered",        // 取貨完成
  "3022": "returned",         // 超過期限未取已退回（改名：原 "failed" 過於含糊）
}
const HOME_STATUS_MAP: Record<string, string> = {
  "300":  "in_transit",       // 物流商收件
  "310":  "in_transit",       // 配送途中
  "311":  "in_transit",
  "325":  "delivered",        // 配達
  "326":  "returned",         // 退件
  "327":  "returned",
}

// type 從 logistics row 反查（先 select before map）
const { data: record } = await supabase
  .from("logistics")
  .select("id, order_id, type")
  .eq("ecpay_logistics_id", AllPayLogisticsID)
  .single()

const statusMap = record?.type === "HOME" ? HOME_STATUS_MAP : CVS_STATUS_MAP
const mappedStatus = statusMap[LogisticsStatus] ?? "in_transit"
```

`orders.status` 更新規則（webhook 內）：

- `mappedStatus === 'arrived_cvs'`     → `orders.status='shipped'`（既有）
- `mappedStatus === 'delivered'`        → `orders.status='completed', completed_at=NOW()`（已有 status 設定，補 `completed_at`）
- `mappedStatus === 'returned'`         → `orders.status='failed', failed_reason='returned_unclaimed'`（新）
- `mappedStatus === 'in_transit'`       → 若 `orders.status='processing'` 則升級成 `'shipped'`；若已是 `shipped`/`completed` 就不動（避免覆寫更後面的狀態）。修補目前 webhook 只在 arrived_cvs 推 shipped、導致直送宅配的 in_transit 訂單卡在 processing 的 bug。

#### 手動 fallback

`_client.tsx` 第 68 行「完成訂單」按鈕：
- 顯示 gate 改為 `order.status === 'shipped'`（其他 status 隱藏）
- 行為不變（call `updateOrderStatusAction(id, 'completed')`），server action 補：set `completed_at=NOW()`

### Section 3 — 後台取消訂單

#### Backend: `POST /admin/orders/:id/cancel`

新檔不需，加進 `apps/api/src/routes/admin-orders.ts`。

```ts
// POST /admin/orders/:id/cancel
// Body: { reason: string }
adminOrdersRouter.post("/:id/cancel", async (req, res) => {
  const { reason } = req.body
  if (!reason?.trim()) return res.status(400).json({ error: "reason 必填" })

  const order = /* fetch order + invoices + logistics */
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: `status=${order.status} 不可取消` })
  }

  const actions = {
    invoice_void:   { ok: null, message: "" },
    logistics_cancel: { ok: null, message: "" },
    payment_refund: { ok: null, message: "" },
    status_update:  { ok: null, message: "" },
  }

  // Step 1: 作廢發票
  if (invoice?.status === "issued") {
    try {
      await voidInvoice(invoice.amego_id, reason)
      await supabase.from("invoices").update({
        status: "voided", voided_at: NOW(), error_message: null,
      }).eq("id", invoice.id)
      actions.invoice_void = { ok: true, message: "已作廢 Amego 發票" }
    } catch (e) { actions.invoice_void = { ok: false, message: e.message } }
  } else actions.invoice_void = { ok: true, message: "無發票需作廢" }

  // Step 2: 取消綠界物流
  if (logistics && !logistics.delivered_at && logistics.ecpay_logistics_id) {
    try {
      const r = await cancelEcpayLogistics(logistics)
      await supabase.from("logistics").update({
        status: "cancelled", raw_response: { ...existing, cancel_response: r.raw },
      }).eq("id", logistics.id)
      actions.logistics_cancel = r.ok
        ? { ok: true, message: "綠界物流已取消" }
        : { ok: false, message: `綠界拒絕：${r.message}（多半因物流商已收件，需客服處理）` }
    } catch (e) { actions.logistics_cancel = { ok: false, message: e.message } }
  } else actions.logistics_cancel = { ok: true, message: "無物流需取消" }

  // Step 3: 退款（v1 = mark refunded + log + admin email）
  if (order.payment_status === "paid") {
    actions.payment_refund = await refundPayment(order, reason)
  } else actions.payment_refund = { ok: true, message: "未付款，無需退款" }

  // Step 4: 翻 status（總是要做）
  await supabase.from("orders").update({
    status: "cancelled",
    payment_status: order.payment_status === "paid" ? "refunded" : order.payment_status,
    cancelled_at: NOW(),
    cancel_reason: reason,
  }).eq("id", orderId)
  actions.status_update = { ok: true, message: "訂單狀態已標記取消" }

  res.json({ ok: true, actions })
})

const CANCELLABLE_STATUSES = ["pending", "processing", "shipped"]
```

四步 invariant：
- 每步獨立 try/catch — 任一步失敗不阻斷其他步驟。
- 第 4 步「翻 status」總是執行（即使前 3 步全爛，admin 至少看到「取消」標記）。
- 即使所有 side-effect 失敗，整個 endpoint 仍回 200，狀態擺進 `actions` 讓 UI 顯示分項結果。

#### 新檔 1: `lib/ecpay-logistics.ts` 補 `cancelEcpayLogistics`

```ts
export async function cancelEcpayLogistics(
  logistics: { ecpay_logistics_id: string; type: string; raw_response: any }
): Promise<{ ok: boolean; message: string; raw: string }> {
  const c = await getEcpayCreds()
  const merchantTradeNo = logistics.raw_response?.MerchantTradeNo
  if (!merchantTradeNo) return { ok: false, message: "缺 MerchantTradeNo", raw: "" }

  // ECPay endpoint: POST {base}/Helper/LogisticsTradeCancel
  // Fields: MerchantID, MerchantTradeNo, AllPayLogisticsID, LogisticsType,
  //         LogisticsSubType, CheckMacValue
  const fields = {
    MerchantID: c.merchantId,
    MerchantTradeNo: merchantTradeNo,
    AllPayLogisticsID: logistics.ecpay_logistics_id,
    // type=CVS/HOME 推回 LogisticsType (CVS/HOME) and LogisticsSubType (UNIMARTC2C/FAMIC2C/TCAT)
    LogisticsType: logistics.type === "HOME" ? "HOME" : "CVS",
    LogisticsSubType: logistics.raw_response?.LogisticsSubType ?? "",
  }
  fields.CheckMacValue = buildCheckMacValue(fields, c.hashKey, c.hashIv)

  const resp = await fetch(`${c.baseUrl}/Helper/LogisticsTradeCancel`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  })
  const text = await resp.text()
  const [code, ...msgParts] = text.split("|")
  return {
    ok: code === "1",
    message: msgParts.join("|") || `RtnCode=${code}`,
    raw: text,
  }
}
```

⚠️ 需驗證 ECPay 真實 endpoint 名稱（可能是 `/Helper/LogisticsTradeCancel` 或 `/Express/Cancel`，spec 上叫不同名）。實作時對照 ECPay 全站宅配技術文件 v2.0.16+ 確認。

#### 新檔 2: `lib/refund-payment.ts`

```ts
export async function refundPayment(
  order: { id: string; payment_method: string; total: number; gateway_tx_id?: string },
  reason: string,
): Promise<{ ok: boolean; message: string }> {
  // V1: 標記 refunded + 寄 admin email「需手動退款」
  // 之後接金流真退款 API 時，在這個函式內 switch by payment_method
  await supabase.from("payments").update({ status: "refund_requested" })
    .eq("order_id", order.id).eq("status", "succeeded")

  await sendAdminEmail({
    subject: `[退款待處理] 訂單 ${order.id} 已取消`,
    body: `金流：${order.payment_method}\n金額：${order.total}\n原因：${reason}\n請至對應金流後台手動退款。`,
  })

  return { ok: true, message: "已標記退款請求，請至金流後台手動操作" }

  // TODO future:
  // switch (order.payment_method) {
  //   case "pchomepay": return refundPchome(order.gateway_tx_id, order.total)
  //   case "linepay":   return refundLinepay(order.gateway_tx_id, order.total)
  //   case "jkopay":    return refundJkopay(order.gateway_tx_id, order.total)
  // }
}
```

#### Frontend: `_client.tsx` 取消按鈕 + Modal

- 既有 78–80 行 reason input + 第 73 行「取消訂單」按鈕：
  - 顯示 gate 改 `CANCELLABLE_STATUSES.includes(order.status)`（completed/cancelled/failed 隱藏）
  - 點按打開 modal：reason textarea（必填，max 200 字）+ confirm
  - confirm 呼叫新 `cancelOrderAction(id, reason)` server action → POST `/admin/orders/:id/cancel`
  - 回傳的 `actions` 物件用 toast/card 列：
    ```
    ✅ 訂單狀態已標記取消
    ✅ 已作廢 Amego 發票
    ⚠️ 綠界拒絕：物流商已收件，需客服處理
    ⚠️ 已標記退款請求，請至金流後台手動操作
    ```

### Section 4 — Migration

`packages/db/migrations/0016_order_completion_cancellation.sql`：

```sql
-- 完成 / 取消 時間戳 + 原因（為了 audit + 退款工單）
ALTER TABLE orders
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancel_reason TEXT,
  ADD COLUMN failed_reason TEXT;

-- 註：payments.status 與 logistics.status 都是 TEXT 無 CHECK constraint
-- （見 0001_initial.sql 第 106、121 行），所以新值 'refund_requested' /
-- 'cancelled' / 'returned' 直接寫入即可，本 migration 無需改 schema，
-- 只列在這裡文件化新合法值集合。

-- Backfill：把 status='completed' 但無 completed_at 的舊單填上 updated_at
UPDATE orders SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;

UPDATE orders SET cancelled_at = updated_at
WHERE status = 'cancelled' AND cancelled_at IS NULL;
```

### Section 5 — Testing

#### Unit tests (vitest, apps/api)

1. `cancelOrder` 內每一步獨立 mock：
   - 全成功 → `actions` 四個 `ok: true`
   - 發票作廢失敗 → 其他三步仍跑、回 200、`actions.invoice_void.ok=false`
   - 綠界 reject (1|物流商已收件) → 不阻斷退款 / status flip
   - 未付款訂單 → `payment_refund.ok=true, message="未付款，無需退款"`
2. status gate：completed 訂單呼叫 cancel endpoint → 400
3. webhook 3018 → `orders.status='completed' + completed_at` 寫入

#### Manual smoke

1. 派一筆 CVS 測試單，到「已到店待取」階段
2. 後台按取消 → 確認：發票作廢 ✓、綠界回拒 / 取消 ✓、退款 email 收到 ✓、status badge 變「已取消」
3. ECPay sandbox 模擬 3018 push → 看訂單自動 `已取貨` + 進度條打到第 4 點

## File touch summary

| 動作 | 路徑 |
|---|---|
| 改 | `apps/api/src/routes/admin-orders.ts`（新 POST /:id/cancel + import refund helper） |
| 改 | `apps/api/src/routes/webhooks/ecpay-logistics.ts`（per-type status map + completed_at + failed_reason） |
| 改 | `apps/api/src/lib/ecpay-logistics.ts`（補 `cancelEcpayLogistics`） |
| 新 | `apps/api/src/lib/refund-payment.ts` |
| 新 | `packages/db/migrations/0016_order_completion_cancellation.sql` |
| 新 | `apps/web/src/lib/order-display-status.ts` |
| 改 | `apps/web/src/app/admin/orders/page.tsx`（list status column → display badge） |
| 改 | `apps/web/src/app/admin/orders/[id]/_client.tsx`（timeline + button gates + cancel modal） |
| 改 | `apps/web/src/app/admin/orders/[id]/actions.ts`（cancelOrderAction） |
| 改 | `apps/web/src/app/admin/orders/[id]/page.tsx`（fetch logistics row for status helper） |
| 測 | `apps/api/test/admin-orders.cancel.test.ts`（新） |

預估：~600 行新增 / 200 行修改。

## Validation

1. `cd apps/api && npm test` 全綠
2. `cd packages/db && npx drizzle-kit push` migration 0016 套用 Supabase
3. Railway deploy（API + worker 同 repo，git push 觸發）
4. Vercel deploy（apps/web）
5. End-to-end smoke：建 / 派工 / 模擬 webhook / 取消 — 一輪走完

## Known caveats

- ECPay 物流取消 API 名稱／field set 待文件確認，本案 PR 必須先測 sandbox 才能 deploy production。
- 退款 v1 只標 refunded + 寄信，沒真退錢；admin 必須記得自己去金流後台。下一案要接金流真退款 API。
- 「過期未取退回」(3022 / 326) 的後續處理（重派 vs 退錢）本案不自動，admin 看到 `returned_unclaimed` 狀態後自己決定下一步。
