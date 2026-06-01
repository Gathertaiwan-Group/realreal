# 物流費用後台設定 + 海外到付 + 超商取貨付款 Design

## 目標

三個相關但可獨立部署的功能：

1. **後台物流費用設定** — 讓管理員可在後台修改各物流方式的運費與免運門檻
2. **海外寄送（到付）** — 新增「海外寄送」選項，顧客先線上付商品金額，運費由司機收取
3. **超商取貨付款（CVS COD）** — 新增付款方式，ECPay 代收，顧客到店取貨時付款

---

## Feature 1：後台物流費用設定

### 問題

`apps/api/src/lib/settings.ts` 的 `SECTIONS` 沒有 "shipping" 分組，導致 `shipping.*` 設定 key 雖在 DB 可存、`computeShipping()` 也讀得到，但後台看不到任何運費欄位。

### 設計

**`apps/api/src/lib/settings.ts`**
- `SECTIONS` 新增：
  ```ts
  shipping: {
    label: "物流運費",
    keys: [
      "shipping.fee_home_delivery",
      "shipping.fee_cvs",
      "shipping.free_threshold_home",
      "shipping.free_threshold_cvs",
      "shipping.fee_overseas_cod",
    ],
  },
  ```
- `SETTING_DEFAULTS` 新增：
  ```ts
  "shipping.fee_home_delivery": "150",
  "shipping.fee_cvs": "65",
  "shipping.free_threshold_home": "999",
  "shipping.free_threshold_cvs": "499",
  "shipping.fee_overseas_cod": "0",
  ```

**`apps/web/src/app/admin/settings/page.tsx`**
- `FIELD_META` 新增海外欄位：
  ```ts
  "shipping.fee_overseas_cod": { label: "海外到付運費（顯示用）", hint: "實際由司機收取，固定顯示為 NT$0", placeholder: "0" },
  ```

### 結帳頁面

不需修改。`POST /orders/preview` 回傳的 `shipping` 已透過 `computeShipping()` 讀 DB 值。本地常數只是 preview 載入前的 placeholder。

---

## Feature 2：海外寄送（到付）

### 概述

顧客選擇「海外寄送」→ 線上付商品金額（LINE Pay / PChomePay / JKOPay）→ 運費由司機收取。

### 資料模型

無 DB migration 需求：
- `orders.shipping_method`：`text` 欄位，新增 `"overseas_cod"` 值
- `order_addresses`：`address`、`city` 已為自由文字，新增 `country` 填入 metadata 或直接存 `address` 欄

### 結帳 Step 1（`apps/web/src/app/checkout/page.tsx`）

- `AddressType` 新增 `"overseas"`
- `ShippingMethod` 新增 `"overseas_cod"`
- 三個地址類型按鈕：宅配到府 / 超商取貨 / 🌍 海外寄送
- 選擇海外後顯示：
  - 國家（自由輸入）
  - 城市（自由輸入）
  - 詳細地址（自由輸入）
  - 手機：不強制 `09xxxxxxxx` 格式（改為 `min(1)` 非空即可）
  - 提示文字：「📦 運費由司機收取，收到貨品時當場付款」
- 運費顯示 NT$0

### 結帳 Step 2（`apps/web/src/app/checkout/payment/page.tsx`）

- 海外寄送時顯示提示：「海外寄送運費由司機收取，商品金額請線上付款」
- 付款方式照常：PChomePay / LINE Pay / JKOPay

### 後端 API（`apps/api/src/routes/orders.ts`）

- `addressSchema.phone`：overseas 放寬為 `z.string().min(1)`（透過 shippingMethod 判斷）
- `createOrderSchema.shippingMethod`：新增 `"overseas_cod"`
- `createOrderSchema` 新增 `invoiceData` 傳遞（已有）

**`apps/api/src/lib/shipping.ts`**
```ts
// overseas_cod → 運費永遠 0
if (method === "overseas_cod") return 0
```

**`apps/api/src/workers/logistics-creator.ts`**
```ts
// overseas_cod → 不建立 ECPay 物流，skip
if (order.shipping_method === "overseas_cod") {
  console.log(`[logistics-creator] overseas_cod order ${orderId}, skipping ECPay logistics`)
  return
}
```

### 管理後台

後台訂單列表顯示 `"overseas_cod"` → 標示「海外到付」badge，提醒管理員手動安排出貨。

---

## Feature 3：超商取貨付款（CVS COD via ECPay）

### 概述

顧客選擇超商配送 + 「超商取貨付款」→ 訂單立即成立（無線上付款）→ ECPay 代收款 → 到店取貨時付款 → ECPay Webhook → 系統確認付款 → 觸發 email / 發票 / 點數。

### 限制

- 只有 `cvs_711` 或 `cvs_family` 配送方式才能選此付款
- 不支援定期訂閱

### Order 狀態機

```
下單 → payment_status: "pending"
     → 立即 enqueue 物流建立 (IsCollection=Y)
     → 前端跳轉確認頁（無需付款）
ECPay 送包裹到超商
顧客到店付款取貨
ECPay webhook (LogisticsStatus=3018 delivered)
     → payment_status: "paid"
     → enqueuePostPaymentJobs (email/invoice/points/tier)
     → order.status: "completed"
```

### 後端改動

**`apps/api/src/lib/ecpay-logistics.ts`**

`createCvsLogistics` 新增參數：
```ts
isCollection?: boolean,
collectionAmount?: number,
```
當 `isCollection=true` 時加入：
```ts
IsCollection: "Y",
CollectionAmount: String(collectionAmount ?? 0),
```

**`apps/api/src/routes/orders.ts`**

- `createOrderSchema.paymentMethod` 新增 `"cvs_cod"`
- `cvs_cod` 分支：
  - 不呼叫任何金流 API
  - 直接 enqueue `inventoryQueue.add("create-shipment-cod", { orderId })` 
  - 回傳 `{ orderId, orderNumber }`（無 `paymentUrl`）

**`apps/api/src/workers/logistics-creator.ts`**

新增 `processCreateShipmentCod(orderId)` 函數：
- 跳過 `payment_status === "paid"` 守衛
- 呼叫 `createCvsLogistics(..., isCollection: true, collectionAmount: order.total / 100)`
- inventory-worker.ts 新增 `case "create-shipment-cod"`

**`apps/api/src/routes/webhooks/ecpay-logistics.ts`**

在 `mappedStatus === "delivered"` 時：
```ts
// 若是 CVS COD 訂單 → 確認付款 → enqueue post-payment jobs
const { data: orderRow } = await supabase
  .from("orders")
  .select("id, payment_method, payment_status")
  .eq("id", record.order_id)
  .single()

if (orderRow?.payment_method === "cvs_cod" && orderRow.payment_status !== "paid") {
  await supabase
    .from("orders")
    .update({ payment_status: "paid", updated_at: new Date().toISOString() })
    .eq("id", record.order_id)
  await enqueuePostPaymentJobs(record.order_id)
}
```

**`apps/web/src/app/checkout/payment/page.tsx`**

- 新增 `PaymentMethod = "cvs_cod"`
- `PAYMENT_OPTIONS` 動態新增（只在 CVS 配送時顯示）
- 偵測 `!paymentUrl` 且 `paymentMethod === "cvs_cod"` → 跳轉 `/checkout/confirm?order=${orderNumber}&status=success`
- 確認頁顯示：「訂單已成立 🎉 請前往指定超商取貨並付款，店員掃描取貨碼後完成交易」

### 確認頁（`apps/web/src/app/checkout/confirm/page.tsx`）

CVS COD 訂單的 `payment_status` 初始為 "pending"，確認頁 polling 應判斷：若 `shippingMethod === "cvs_cod"` → 顯示「等待到店取貨付款」而非「付款確認中」。

---

## 部署順序

1. Feature 1（最安全）— 無 DB migration，只加設定 key
2. Feature 2（海外到付）— 需同時部署 API + Web
3. Feature 3（CVS COD）— 需同時部署 API + Web，上線前確認 ECPay 帳號已開通「代收貨款」功能

---

## 不在範圍

- 海外運費的自動計算（依重量/地區）
- ECPay CVS COD 代收帳款對帳
- 離島地址的特別驗證
