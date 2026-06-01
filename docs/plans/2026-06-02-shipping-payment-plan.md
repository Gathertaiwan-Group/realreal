# 物流費用後台設定 + 海外到付 + 超商取貨付款 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 三個功能：① 後台可設定物流費用 ② 新增海外寄送（到付）選項 ③ 新增超商取貨付款（ECPay 代收）。

**Architecture:** Monorepo Turborepo — `apps/api` (Express + Supabase + BullMQ)，`apps/web` (Next.js 15 client)。設定透過 `app_settings` 加密 DB 存取，物流透過 ECPay 物流 API，付款透過各金流 Webhook。

**Tech Stack:** TypeScript, Express, Zod, Supabase, BullMQ/Redis, ECPay Logistics API, React/Next.js 15, Tailwind CSS

---

## Task 1：後台新增「物流運費」設定區塊

**Files:**
- Modify: `apps/api/src/lib/settings.ts` (SECTIONS + SETTING_DEFAULTS)
- Modify: `apps/web/src/app/admin/settings/page.tsx` (FIELD_META)

### Step 1：在 SECTIONS 新增 shipping 分組

打開 `apps/api/src/lib/settings.ts`，找到 `export const SECTIONS` 區塊（約第 216 行），在 `points` 區塊結尾的 `},` 之後，加入：

```typescript
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
  contact: {
    label: "聯絡資訊",
    keys: ["contact.email"],
  },
```

> **注意**：若 `contact` 已存在就不重複加，只加 `shipping` 部分。

### Step 2：在 SETTING_DEFAULTS 新增預設值

在同一檔案的 `SETTING_DEFAULTS` 物件（約第 300 行）加入：

```typescript
  "shipping.fee_home_delivery": "150",
  "shipping.fee_cvs": "65",
  "shipping.free_threshold_home": "999",
  "shipping.free_threshold_cvs": "499",
  "shipping.fee_overseas_cod": "0",
```

### Step 3：在 admin settings 前端新增 FIELD_META 項目

打開 `apps/web/src/app/admin/settings/page.tsx`，找到 `FIELD_META` 裡的 Shipping 區塊（約第 122-127 行），補上海外運費說明：

```typescript
  // Shipping
  "shipping.fee_home_delivery":   { label: "宅配運費 NT$", placeholder: "150" },
  "shipping.fee_cvs":             { label: "超商運費 NT$", placeholder: "65" },
  "shipping.free_threshold_home": { label: "宅配免運門檻 NT$", placeholder: "999", hint: "0 = 不提供免運" },
  "shipping.free_threshold_cvs":  { label: "超商免運門檻 NT$", placeholder: "499", hint: "0 = 不提供免運" },
  "shipping.fee_overseas_cod":    { label: "海外到付運費（顯示用）", placeholder: "0", hint: "實際由司機收取，固定顯示 NT$0，此設定僅供備忘" },
```

### Step 4：驗證後台可看到運費設定

啟動本地 API（`cd apps/api && npm run dev`），開啟後台 `/admin/settings`，確認出現「物流運費」區塊，包含 5 個欄位。

### Step 5：Commit

```bash
git add apps/api/src/lib/settings.ts apps/web/src/app/admin/settings/page.tsx
git commit -m "feat: expose shipping fee settings in admin panel"
```

---

## Task 2：API — 支援 overseas_cod 物流方式

**Files:**
- Modify: `apps/api/src/lib/shipping.ts`
- Modify: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/workers/logistics-creator.ts`

### Step 1：shipping.ts 新增 overseas_cod 回傳 0

打開 `apps/api/src/lib/shipping.ts`，修改 `computeShipping` 函數簽名和邏輯：

```typescript
export async function computeShipping(
  method: "home_delivery" | "cvs_711" | "cvs_family" | "overseas_cod",
  subtotal: number,
): Promise<number> {
  // 海外到付：運費由司機收取，線上顯示 0
  if (method === "overseas_cod") return 0

  const isHome = method === "home_delivery"
  const feeKey = isHome ? "shipping.fee_home_delivery" : "shipping.fee_cvs"
  const thresholdKey = isHome
    ? "shipping.free_threshold_home"
    : "shipping.free_threshold_cvs"

  const fee = Number((await getSetting(feeKey)) ?? "100")
  const threshold = Number((await getSetting(thresholdKey)) ?? "0")

  if (threshold > 0 && subtotal >= threshold) return 0
  return fee
}
```

### Step 2：orders.ts — 放寬 phone 驗證 + 新增 overseas_cod 到 schema

打開 `apps/api/src/routes/orders.ts`，修改 `addressSchema`：

```typescript
const addressSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  // 海外地址放寬：不強制 09xxxxxxxx 格式
  phone: z.string().min(1),
  addressType: z.enum(["home", "cvs", "overseas"]),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  cvsStoreId: z.string().optional(),
  cvsType: z.string().optional(),
  country: z.string().optional(),  // 海外地址用
})
```

修改 `createOrderSchema`，新增 `overseas_cod`：

```typescript
const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  address: addressSchema,
  shippingMethod: z.enum(["home_delivery", "cvs_711", "cvs_family", "overseas_cod"]),
  paymentMethod: z.enum(["pchomepay", "linepay", "jkopay", "cvs_cod"]),
  guestEmail: z.string().email().optional(),
  couponCode: z.string().optional(),
  points_used: z.number().int().min(0).optional(),
  invoice: z.any().optional(),
})
```

同時在 `previewSchema`（`POST /orders/preview`）也新增 `"overseas_cod"`：

```typescript
const previewSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  shippingMethod: z.enum(["home_delivery", "cvs_711", "cvs_family", "overseas_cod"]).default("home_delivery"),
  couponCode: z.string().optional(),
})
```

### Step 3：order_addresses 存 country 欄位

在 orders.ts 裡 insert `order_addresses` 的地方（約第 445-470 行），補上 country：

```typescript
await supabase.from("order_addresses").insert({
  order_id: order.id,
  type: "shipping",
  name: address.name,
  phone: address.phone,
  email: address.email ?? guestEmail ?? null,
  address_type: address.addressType,
  address: address.address ?? null,
  city: address.city ?? null,
  postal_code: address.postalCode ?? null,
  cvs_store_id: address.cvsStoreId ?? null,
  cvs_type: address.cvsType ?? null,
  // 海外地址國家存入 metadata / 直接存在 address 前綴，或用 city 欄位存
  // 簡單做法：把 country 接在 address 前面
})
```

> **提示**：因 `order_addresses` 目前沒有 `country` 欄位，使用最簡單方案：若 `address.country` 存在，在 `address` 欄位前加入 `[country] ` 前綴（例：`"[Japan] 東京都..." `）。這樣不需要 DB migration。

```typescript
const fullAddress = address.country
  ? `[${address.country}] ${address.address ?? ""}`
  : (address.address ?? null)
```

並在 insert 時使用 `address: fullAddress`。

### Step 4：logistics-creator — skip overseas_cod

打開 `apps/api/src/workers/logistics-creator.ts`，在函數開頭的 `payment_status` 守衛之後，新增：

```typescript
// 海外到付：無 ECPay 物流，admin 手動安排
if (order.shipping_method === "overseas_cod") {
  console.log(`[logistics-creator] overseas_cod order ${orderId}, skipping ECPay logistics`)
  return
}
```

### Step 5：Commit

```bash
git add apps/api/src/lib/shipping.ts apps/api/src/routes/orders.ts apps/api/src/workers/logistics-creator.ts
git commit -m "feat: add overseas_cod shipping method to API"
```

---

## Task 3：前端 Step 1 — 結帳加入「海外寄送」選項

**Files:**
- Modify: `apps/web/src/app/checkout/page.tsx`

### Step 1：擴展型別和常數

打開 `apps/web/src/app/checkout/page.tsx`，修改型別：

```typescript
type AddressType = "home" | "cvs" | "overseas"
type ShippingMethod = "711" | "family" | "home_delivery" | "overseas_cod"
```

修改 `SHIPPING_LABELS`：

```typescript
const SHIPPING_LABELS: Record<ShippingMethod, string> = {
  "711": "7-11取貨",
  "family": "全家取貨",
  "home_delivery": "宅配",
  "overseas_cod": "海外寄送（到付）",
}
```

修改 `SHIPPING_FEES`：

```typescript
const SHIPPING_FEES: Record<ShippingMethod, number> = {
  "711": 65,
  "family": 65,
  "home_delivery": 150,
  "overseas_cod": 0,
}

const FREE_SHIPPING_THRESHOLD: Record<ShippingMethod, number> = {
  "711": 499,
  "family": 499,
  "home_delivery": 999,
  "overseas_cod": 0,  // 永遠不免運，因本來就 0
}
```

### Step 2：新增 overseas 相關 state

在現有 state 之後新增：

```typescript
const [country, setCountry] = useState("")
```

### Step 3：addressType 切換 effect 新增 overseas 分支

找到 `useEffect` 裡處理 addressType 切換的邏輯（約第 453-461 行），修改為：

```typescript
useEffect(() => {
  if (addressType === "cvs" && shippingMethod === "home_delivery") {
    setShippingMethod("711")
  }
  if (addressType === "home" && shippingMethod !== "home_delivery") {
    setShippingMethod("home_delivery")
  }
  if (addressType === "overseas") {
    setShippingMethod("overseas_cod")
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [addressType])
```

### Step 4：三個地址類型按鈕

找到配送方式 section 裡的地址類型按鈕區塊（目前只有 `["home", "cvs"]`），改為三個按鈕：

```tsx
<div className="grid grid-cols-3 gap-3">
  {(["home", "cvs", "overseas"] as AddressType[]).map(type => (
    <button
      key={type}
      type="button"
      onClick={() => setAddressType(type)}
      className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-colors ${
        addressType === type
          ? "border-zinc-200 text-zinc-600"
          : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
      }`}
      style={addressType === type ? { borderColor: "#10305a", backgroundColor: "rgba(16,48,90,0.05)", color: "#10305a" } : undefined}
    >
      <span>{type === "home" ? "🏠" : type === "cvs" ? "🏪" : "🌍"}</span>
      <span>{type === "home" ? "宅配到府" : type === "cvs" ? "超商取貨" : "海外寄送"}</span>
    </button>
  ))}
</div>
```

### Step 5：海外地址表單（新增 else if 分支）

在 `{addressType === "cvs" && (...)}` 區塊之後，新增：

```tsx
{addressType === "overseas" && (
  <div className="space-y-3">
    <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
      📦 運費由司機收取，收到貨品時當場付款。商品金額請線上完成付款。
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="country">國家 / Country <span className="text-red-500">*</span></Label>
        <Input
          id="country"
          value={country}
          onChange={e => setCountry(e.target.value)}
          placeholder="Japan / 日本"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="city">城市 / City <span className="text-red-500">*</span></Label>
        <Input
          id="city"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="Tokyo / 東京都"
        />
      </div>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="addressLine">詳細地址 <span className="text-red-500">*</span></Label>
      <Input
        id="addressLine"
        value={addressLine}
        onChange={e => setAddressLine(e.target.value)}
        placeholder="街道、區域、郵遞區號"
      />
    </div>
    <p className="text-xs text-zinc-400">
      運費：<span className="font-medium text-zinc-600">NT$ 0（到付，由司機收取）</span>
    </p>
  </div>
)}
```

### Step 6：validate() 加入 overseas 驗證

在 `validate()` 函數內，加入 overseas 分支：

```typescript
if (addressType === "home") {
  if (!city.trim()) errs.city = "請選擇縣市"
  if (!addressLine.trim()) errs.address = "請輸入詳細地址"
} else if (addressType === "cvs") {
  if (!cvsStoreName) errs.cvsStore = "請選擇取貨門市"
} else {
  // overseas
  if (!country.trim()) errs.city = "請輸入國家"
  if (!addressLine.trim()) errs.address = "請輸入詳細地址"
}
```

### Step 7：handleNext() 傳遞 country 到 checkoutData

在 `handleNext()` 的 `checkoutData` 物件裡，address 加入 `country`：

```typescript
address: {
  name,
  phone,
  email,
  addressType,
  city,
  district,
  postalCode,
  addressLine,
  cvsStoreName,
  cvsStoreId,
  country,   // ← 新增
},
shippingMethod,
```

同時 `shippingMethod` 的 map 在 payment/page.tsx 需要：

```typescript
const shippingMethodMap: Record<string, string> = {
  "711": "cvs_711",
  family: "cvs_family",
  home_delivery: "home_delivery",
  overseas_cod: "overseas_cod",  // ← 新增
}
```

### Step 8：手動測試

本地啟動 `apps/web`，到結帳頁，確認：
- 出現「🌍 海外寄送」按鈕
- 選擇後顯示國家/城市/地址欄位
- 運費顯示「NT$ 0（到付，由司機收取）」
- 下一步可以到付款頁

### Step 9：Commit

```bash
git add apps/web/src/app/checkout/page.tsx
git commit -m "feat: add overseas shipping option to checkout step 1"
```

---

## Task 4：前端 Step 2 — payment/page.tsx 新增 country 傳遞 + 海外說明

**Files:**
- Modify: `apps/web/src/app/checkout/payment/page.tsx`

### Step 1：更新 CheckoutData 型別

在 `payment/page.tsx` 找到 `CheckoutData` 型別定義，`address` 加入 `country`：

```typescript
type CheckoutData = {
  items: { variantId: string; productName: string; variantName: string; price: number; qty: number }[]
  address: {
    name: string; phone: string; email?: string; addressType: string;
    city: string; district?: string; postalCode: string; addressLine?: string;
    cvsStoreName?: string; cvsStoreId?: string; country?: string  // ← 新增
  }
  shippingMethod: string
  shippingFee?: number
  invoice?: InvoiceData
}
```

### Step 2：更新 SHIPPING_LABELS

```typescript
const SHIPPING_LABELS: Record<string, string> = {
  "711": "7-11取貨",
  "family": "全家取貨",
  "home_delivery": "宅配",
  "overseas_cod": "海外寄送（到付）",
}
```

### Step 3：若海外寄送顯示提示

在「收件資訊」摘要 section，加入海外說明：

```tsx
{checkoutData.shippingMethod === "overseas_cod" && (
  <div className="mt-2 rounded bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
    🌍 海外到付：運費由司機收取，請線上完成商品金額付款
  </div>
)}
```

### Step 4：在 handleConfirm 傳遞 country 到 API

找到 `handleConfirm` 的 `apiAddress` 物件：

```typescript
const apiAddress = {
  type: "shipping",
  name: checkoutData.address.name,
  phone: checkoutData.address.phone,
  addressType: shippingMethod === "home_delivery" ? "home"
    : shippingMethod === "overseas_cod" ? "overseas"
    : "cvs",
  address: checkoutData.address.addressLine || checkoutData.address.cvsStoreName || undefined,
  city: checkoutData.address.city || undefined,
  postalCode: checkoutData.address.postalCode || undefined,
  cvsStoreId: checkoutData.address.cvsStoreId || undefined,
  cvsType: cvsTypeMap[shippingMethod],
  country: checkoutData.address.country || undefined,   // ← 新增
}
```

### Step 5：Commit

```bash
git add apps/web/src/app/checkout/payment/page.tsx
git commit -m "feat: pass country field for overseas shipping in payment step"
```

---

## Task 5：ECPay — createCvsLogistics 支援代收（IsCollection）

**Files:**
- Modify: `apps/api/src/lib/ecpay-logistics.ts`

### Step 1：修改 createCvsLogistics 函數簽名

打開 `apps/api/src/lib/ecpay-logistics.ts`，找到 `createCvsLogistics` 函數（約第 73 行），新增兩個選填參數：

```typescript
export async function createCvsLogistics(
  _orderId: string,
  cvsType: "UNIMARTC2C" | "FAMIC2C",
  receiverName: string,
  receiverPhone: string,
  receiverEmail: string,
  storeId: string,
  isCollection: boolean = false,
  collectionAmount: number = 0,
): Promise<CvsLogisticsResult> {
```

### Step 2：在 fields 物件加入 IsCollection 相關欄位

在 `IsCollection: "N"` 那行，改為：

```typescript
IsCollection: isCollection ? "Y" : "N",
...(isCollection && { CollectionAmount: String(Math.round(collectionAmount)) }),
```

完整的 fields 物件相關部分：

```typescript
const fields: Record<string, string> = {
  // ... 其他欄位不動 ...
  IsCollection: isCollection ? "Y" : "N",
  ServerReplyURL: `${apiUrl}/webhooks/ecpay-logistics`,
}

// 代收貨款金額（IsCollection=Y 時必填）
if (isCollection && collectionAmount > 0) {
  fields.CollectionAmount = String(Math.round(collectionAmount))
}

fields.CheckMacValue = buildCheckMacValue(fields, c.hashKey, c.hashIv)
```

### Step 3：Commit

```bash
git add apps/api/src/lib/ecpay-logistics.ts
git commit -m "feat: add IsCollection support to createCvsLogistics for CVS COD"
```

---

## Task 6：Logistics Creator — 支援 cvs_cod 訂單即時建立物流

**Files:**
- Modify: `apps/api/src/workers/logistics-creator.ts`
- Modify: `apps/api/src/workers/inventory-worker.ts`

### Step 1：新增 processCreateShipmentCod 函數

在 `logistics-creator.ts` 的 `processCreateShipment` 函數之後，新增：

```typescript
/**
 * Create CVS logistics with IsCollection=Y for cvs_cod orders.
 * Called immediately after order creation (not waiting for payment).
 * The payment is confirmed when ECPay webhook fires on LogisticsStatus=3018 (delivered).
 */
export async function processCreateShipmentCod(orderId: string) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, shipping_method, status, payment_method, total")
    .eq("id", orderId)
    .single()

  if (!order) throw new Error(`Order ${orderId} not found`)
  if (order.payment_method !== "cvs_cod") {
    console.warn(`[logistics-creator] processCreateShipmentCod called for non-cvs_cod order ${orderId}`)
    return
  }

  // Idempotency
  const { data: existing } = await supabase
    .from("logistics")
    .select("id")
    .eq("order_id", orderId)
    .limit(1)
    .maybeSingle()

  if (existing) {
    console.log(`[logistics-creator] logistics already exists for order ${orderId}, skipping`)
    return
  }

  const { data: address } = await supabase
    .from("order_addresses")
    .select("name, phone, email, address, cvs_store_id, cvs_type")
    .eq("order_id", orderId)
    .eq("type", "shipping")
    .maybeSingle()

  if (!address) throw new Error(`Shipping address not found for order ${orderId}`)

  // order.total is in cents — convert to TWD for ECPay CollectionAmount
  const collectionAmountTwd = Math.round(Number(order.total) / 100)

  const cvsType = order.shipping_method === "cvs_711" ? "UNIMARTC2C" : "FAMIC2C"
  const result = await createCvsLogistics(
    orderId,
    cvsType as "UNIMARTC2C" | "FAMIC2C",
    address.name,
    address.phone,
    address.email ?? "",
    address.cvs_store_id ?? "",
    true,                    // isCollection = true
    collectionAmountTwd,     // ECPay 代收金額 (TWD)
  )

  const { error } = await supabase.from("logistics").insert({
    order_id: orderId,
    provider: "ecpay",
    type: "CVS",
    ecpay_logistics_id: result.logisticsId,
    status: "pending",
    cvs_payment_no: result.cvsPaymentNo ?? null,
    cvs_validation_no: result.cvsValidationNo ?? null,
  })

  if (error) {
    console.error(`[logistics-creator] failed to insert logistics row for cvs_cod order ${orderId}:`, error)
    throw error
  }

  console.log(`[logistics-creator] CVS COD shipment created for order ${orderId}, collection=${collectionAmountTwd} TWD`)
}
```

### Step 2：inventory-worker.ts 新增 create-shipment-cod case

打開 `apps/api/src/workers/inventory-worker.ts`，在 import 區新增：

```typescript
import { processCreateShipment, processCreateShipmentCod } from "./logistics-creator"
```

在 switch 裡新增：

```typescript
case "create-shipment-cod":
  return processCreateShipmentCod((job.data as { orderId: string }).orderId)
```

### Step 3：Commit

```bash
git add apps/api/src/workers/logistics-creator.ts apps/api/src/workers/inventory-worker.ts
git commit -m "feat: add processCreateShipmentCod for CVS COD immediate logistics"
```

---

## Task 7：orders.ts — 支援 cvs_cod 付款方式

**Files:**
- Modify: `apps/api/src/routes/orders.ts`

### Step 1：import inventoryQueue

在 orders.ts 頂部，確認 `inventoryQueue` 有被 import（若已有跳過）：

```typescript
import { inventoryQueue } from "../lib/queue"
```

### Step 2：在付款分支新增 cvs_cod 處理

找到約第 482 行的付款分支（`let paymentUrl: string`），將整段修改為：

```typescript
// ---- cvs_cod：不走線上金流，立即建立物流 ----
if (paymentMethod === "cvs_cod") {
  // Insert payment record (pending, gateway = cvs_cod)
  await supabase.from("payments").insert({
    order_id: order.id,
    gateway: "cvs_cod",
    gateway_tx_id: order.order_number,
    amount: Math.round(totalCents / 100),
    status: "pending",
  })

  // Enqueue CVS COD logistics creation immediately
  try {
    await inventoryQueue.add(
      "create-shipment-cod",
      { orderId: order.id },
      { attempts: 5, backoff: { type: "exponential", delay: 60000 } },
    )
  } catch (err) {
    console.warn("[orders] cvs_cod logistics enqueue failed (non-fatal):", err)
  }

  // Return without paymentUrl — frontend detects this and goes straight to confirm
  res.status(201).json({
    data: {
      orderId: order.id,
      orderNumber: order.order_number,
      paymentMethod,
    },
  })
  return
}

// ---- 線上金流（PChomePay / LINE Pay / JKOPay）----
let paymentUrl: string
let gatewayTxId: string | null = null

try {
  if (paymentMethod === "pchomepay") {
    // ... 原有 pchomepay 邏輯不動 ...
  } else if (paymentMethod === "linepay") {
    // ... 原有 linepay 邏輯不動 ...
  } else {
    // jkopay — 原有邏輯不動
  }
} catch (err) {
  // ... 原有 rollback 邏輯不動 ...
}
// ... 原有 insert payment + res.json() 不動 ...
```

> **重要**：`cvs_cod` 分支的 `return` 語句確保後面的 `let paymentUrl` 不會執行（避免 TS 報錯「Variable 'paymentUrl' is used before being assigned」）。

### Step 3：Commit

```bash
git add apps/api/src/routes/orders.ts
git commit -m "feat: handle cvs_cod payment method in orders route"
```

---

## Task 8：ECPay Logistics Webhook — 支援 CVS COD 付款確認

**Files:**
- Modify: `apps/api/src/routes/webhooks/ecpay-logistics.ts`

### Step 1：Import enqueuePostPaymentJobs

在 webhook 檔案頂部新增：

```typescript
import { enqueuePostPaymentJobs } from "../../lib/enqueue-post-payment"
```

### Step 2：在 delivered 狀態處理 COD 付款確認

找到現有的 `delivered` 處理邏輯（約第 93-100 行）：

```typescript
} else if (mappedStatus === "delivered") {
  // 配達 / 取貨完成 → 訂單完成 + 紀錄 completed_at
  const now = new Date().toISOString()
  await supabase
    .from("orders")
    .update({ status: "completed", completed_at: now, updated_at: now })
    .eq("id", record.order_id)
}
```

修改為：

```typescript
} else if (mappedStatus === "delivered") {
  const now = new Date().toISOString()

  // 取得訂單付款方式
  const { data: orderForCod } = await supabase
    .from("orders")
    .select("payment_method, payment_status")
    .eq("id", record.order_id)
    .single()

  if (orderForCod?.payment_method === "cvs_cod" && orderForCod.payment_status !== "paid") {
    // CVS COD：顧客取貨付款，ECPay 代收完成 → 確認付款
    await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        status: "completed",
        completed_at: now,
        updated_at: now,
      })
      .eq("id", record.order_id)

    // 觸發 post-payment jobs（email/發票/點數/升等）
    try {
      await enqueuePostPaymentJobs(record.order_id)
    } catch (err) {
      console.warn("[webhooks/ecpay-logistics] enqueuePostPaymentJobs failed for cvs_cod:", err)
    }
  } else {
    // 非 COD 訂單：只更新 order.status
    await supabase
      .from("orders")
      .update({ status: "completed", completed_at: now, updated_at: now })
      .eq("id", record.order_id)
  }
}
```

### Step 3：Commit

```bash
git add apps/api/src/routes/webhooks/ecpay-logistics.ts
git commit -m "feat: trigger post-payment jobs on CVS COD delivery webhook"
```

---

## Task 9：前端 payment/page.tsx — 超商取貨付款選項 + 無 paymentUrl 跳轉

**Files:**
- Modify: `apps/web/src/app/checkout/payment/page.tsx`

### Step 1：擴展 PaymentMethod 型別

```typescript
type PaymentMethod = "pchomepay" | "linepay" | "jkopay" | "cvs_cod"
```

### Step 2：動態 PAYMENT_OPTIONS（cvs_cod 只在 CVS 配送時顯示）

找到 `PAYMENT_OPTIONS` 常數，改為在 render 裡動態計算（根據 checkoutData）：

```typescript
const isCvsShipping = checkoutData?.shippingMethod === "711" || checkoutData?.shippingMethod === "family"

const PAYMENT_OPTIONS: PaymentOption[] = [
  { value: "pchomepay", label: "PChomePay 支付連", icon: "💳", color: "bg-blue-50 border-blue-200" },
  { value: "linepay", label: "LINE Pay", icon: "💚", color: "bg-green-50 border-green-200", note: "不支援定期訂閱扣款" },
  { value: "jkopay", label: "街口支付 JKOPay", icon: "🟠", color: "bg-orange-50 border-orange-200", note: "不支援定期訂閱扣款" },
  ...(isCvsShipping ? [{
    value: "cvs_cod" as PaymentMethod,
    label: "超商取貨付款",
    icon: "🏪",
    color: "bg-zinc-50 border-zinc-200",
    note: "到店取貨時付款，由綠界代收"
  }] : []),
]
```

> **注意**：`PAYMENT_OPTIONS` 移到 component function body 裡（不再是頂層常數）。

當 `isCvsShipping` 變為 false 時（例如切回宅配），若 `paymentMethod === "cvs_cod"` 則自動重設：

```typescript
useEffect(() => {
  if (!isCvsShipping && paymentMethod === "cvs_cod") {
    setPaymentMethod("pchomepay")
  }
}, [isCvsShipping, paymentMethod])
```

### Step 3：選擇 cvs_cod 時顯示說明文字

在付款方式卡片下方新增條件提示：

```tsx
{paymentMethod === "cvs_cod" && (
  <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-sm text-zinc-600 space-y-1">
    <p className="font-medium">🏪 超商取貨付款流程</p>
    <ol className="list-decimal list-inside space-y-0.5 text-xs text-zinc-500">
      <li>訂單成立後，包裹寄至您選擇的超商</li>
      <li>超商簡訊通知到貨後，前往取貨</li>
      <li>取貨時現場付款給店員（現金）</li>
    </ol>
  </div>
)}
```

### Step 4：handleConfirm 處理無 paymentUrl（cvs_cod）

找到 `handleConfirm` 中的 `paymentUrl` 判斷邏輯：

```typescript
const paymentUrl = data?.data?.paymentUrl

if (paymentUrl) {
  toast.success("正在前往付款頁面...")
  window.location.href = paymentUrl
} else {
  setError("無法取得付款連結，請稍後再試或聯繫客服")
}
```

改為：

```typescript
const paymentUrl = data?.data?.paymentUrl
const returnedOrderNumber = data?.data?.orderNumber

if (paymentUrl) {
  toast.success("正在前往付款頁面...")
  window.location.href = paymentUrl
} else if (paymentMethod === "cvs_cod" && returnedOrderNumber) {
  // CVS COD：訂單已成立，直接跳確認頁
  toast.success("訂單已成立！")
  // 清空購物車
  useCart.getState().clear?.()
  router.push(`/checkout/confirm?order=${encodeURIComponent(returnedOrderNumber)}&status=success&method=cvs_cod`)
} else {
  setError("無法取得付款連結，請稍後再試或聯繫客服")
}
```

> **注意**：`useCart.getState().clear?.()` — 確認 cart store 有 `clear` action。若 cart 用 `useCart(s => s.clear)` 方式，改用 `useCart.getState().clear()`。

### Step 5：Commit

```bash
git add apps/web/src/app/checkout/payment/page.tsx
git commit -m "feat: add cvs_cod payment option with COD confirm flow"
```

---

## Task 10：confirm 頁面顯示 CVS COD 等待取貨訊息

**Files:**
- Modify: `apps/web/src/app/checkout/confirm/page.tsx`

### Step 1：讀取 method query param

在 confirm page 的 `useSearchParams()` 使用區域，新增讀取 `method`：

```typescript
const searchParams = useSearchParams()
const orderNumber = searchParams.get("order")
const method = searchParams.get("method")  // "cvs_cod" 時顯示特殊訊息
```

### Step 2：cvs_cod 狀態 bypass polling

CVS COD 訂單 `payment_status = "pending"`（要等到取貨才變 paid），確認頁 polling 到 "pending" 會顯示「付款確認中」。

找到 polling 狀態機邏輯，在 polling useEffect 之前加一個 shortcut：

```typescript
// CVS COD：跳過 polling，直接顯示成功（訂單已建立，等待到店付款）
const isCvsCod = method === "cvs_cod"
```

在 JSX 的成功/失敗/pending 判斷區塊，加入最高優先 CVS COD 分支：

```tsx
{isCvsCod ? (
  <div className="text-center space-y-4">
    <div className="text-5xl">🏪</div>
    <h1 className="text-2xl font-bold">訂單已成立！</h1>
    <p className="text-zinc-500">訂單編號：<span className="font-mono font-medium">{orderNumber}</span></p>
    <div className="rounded-lg bg-zinc-50 border p-4 text-sm text-zinc-600 space-y-2 text-left">
      <p className="font-semibold">取貨付款流程：</p>
      <ol className="list-decimal list-inside space-y-1">
        <li>包裹寄至您選擇的超商（約 3-5 個工作天）</li>
        <li>收到超商簡訊通知後，前往取貨</li>
        <li>取貨時現場付款（現金）給店員</li>
      </ol>
    </div>
    <Link href="/shop">
      <Button variant="outline">繼續購物</Button>
    </Link>
  </div>
) : (
  /* 原有的 success/pending/failed UI 不動 */
)}
```

### Step 3：Commit

```bash
git add apps/web/src/app/checkout/confirm/page.tsx
git commit -m "feat: show CVS COD pickup instructions on confirm page"
```

---

## Task 11：整合測試 + 部署

### Step 1：本地整合測試 — Feature 1

1. 啟動 `apps/api` + `apps/web`
2. 登入後台，進 `/admin/settings`
3. 確認出現「物流運費」區塊
4. 修改「宅配運費」為 200，儲存
5. 進結帳頁，確認 preview 回傳的運費為 200

### Step 2：本地整合測試 — Feature 2（海外到付）

1. 加入商品到購物車
2. 進結帳，選「🌍 海外寄送」
3. 填入 Country: Japan，City: Tokyo，Address: 新宿区1-2-3
4. 手機填入 +81-90-1234-5678（非台灣格式）
5. 下一步 → 付款，選 LINE Pay
6. 確認訂單建立成功，shipping_method = "overseas_cod"
7. 查 DB，`order_addresses.address` 應為 `[Japan] 新宿区1-2-3`

### Step 3：本地整合測試 — Feature 3（超商取貨付款）

1. 加入商品到購物車
2. 選超商取貨（7-11），選好門市
3. 付款步驟出現「🏪 超商取貨付款」選項
4. 選擇後看到說明文字
5. 按「確認付款」
6. 應跳轉 `/checkout/confirm?method=cvs_cod`，顯示取貨說明

> **ECPay 代收測試**：需要 ECPay 沙箱帳號開通代收功能。在後台設定 `ecpay.sandbox = true`，用沙箱測試物流代收流程。

### Step 4：Deploy

```bash
# 確認本地無 TS 錯誤
cd apps/api && npm run type-check
cd apps/web && npm run type-check

# Push，Railway 和 Vercel 自動部署
git push origin main
```

確認 Railway build 成功後，在正式環境進行一次 CVS COD 測試訂單。

---

## 注意事項

### ECPay 代收前置條件
- 超商取貨付款需要向 ECPay 申請開通「代收貨款」功能
- 沙箱環境：需要在 ECPay 測試後台確認 IsCollection 功能可用
- 正式上線前告知業務窗口開通

### 海外到付運費
- 海外寄送的實際運費由商家自行計算後向顧客收取
- 系統不自動計算，訂單顯示運費 NT$0
- 建議在商品頁或 FAQ 說明海外運費估算方式

### Cart clear for cvs_cod
- confirm 頁面 cvs_cod 分支需要清空購物車
- 檢查 `useCart` store 是否有 `clear` action；若無，在 payment/page.tsx 的跳轉前手動清空：`localStorage.removeItem("realreal-cart")`
