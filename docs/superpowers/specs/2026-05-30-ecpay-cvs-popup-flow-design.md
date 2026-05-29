# ECPay 超商取貨彈窗 → 主視窗回流 — 設計

**日期**：2026-05-30
**範疇**：`apps/web/src/app/checkout/page.tsx`（前端唯一改動點）
**不動**：`apps/api/src/routes/logistics.ts`、`apps/api/src/lib/ecpay-logistics.ts`

---

## 問題

目前結帳頁的「選擇取貨門市」流程：

1. 使用者按按鈕 → `window.open(${apiUrl}/logistics/map?...)` 開新視窗
2. 新視窗 auto-submit form 跳 ECPay 門市地圖
3. ECPay POST 回我們 API `/logistics/map-result`
4. API redirect 新視窗到 `${siteUrl}/checkout?cvsStoreId=...&cvsStoreName=...&cvsAddress=...&logisticsSubType=...`
5. **新視窗** 的 /checkout 讀 URL 參數、`setCvsStoreId/...`、`history.replaceState` 清掉 URL
6. **原視窗** 完全不知道 step 5 發生，仍顯示「尚未選擇取貨門市」

→ 兩個 React tree、兩份 state，門市資訊跑進錯的那個。使用者卡住不知道要做什麼。

---

## 設計（A + C fallback）

### A 主路徑：postMessage + 自動關彈窗

- 主視窗 `/checkout` 監聽 `window.message`，收到 `{ type: "cvs-selected", ... }` 就更新 state（不重新整理、不重新 mount form）。
- 彈窗版的 `/checkout`（API redirect 後落地）偵測 `window.opener && !window.opener.closed`：
  - 是 → `opener.postMessage(msg, location.origin)` → `window.close()`
  - 否 → 退回原本「在彈窗內 inline 顯示已選好門市」，使用者至少知道流程結束。

### C fallback：popup blocker / mobile → 同分頁導航

`openCvsMap` 呼叫 `window.open` 之後立刻判斷：

```ts
const popup = window.open(url, "_blank", "width=800,height=600")
const blocked = popup === null || typeof popup.closed === "undefined"
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
if (blocked || isMobile) {
  saveDraftToLocalStorage()
  window.location.href = url
  return
}
```

C 流程：
1. 把當前 form state 寫進 `localStorage["realreal-cvs-draft"]`，含 `expiresAt: Date.now() + 5 * 60_000`
2. 同分頁導航到 ECPay map URL
3. ECPay redirect 回 `/checkout?cvsStoreId=...`，主分頁的 `useEffect` 既有路徑接住
4. 進場時偵測 draft、未過期就還原表單、清掉 draft

---

## 元件分工

### `apps/web/src/app/checkout/page.tsx`

四段改動，全部在這一個檔。**useEffect 宣告順序**（重要 — React 依宣告順序執行）：

```
1. Draft 還原 useEffect      ← 最先，可能會 setAddressType("cvs")、setShippingMethod("711") 等
2. Cart hydration useEffect  ← 既有
3. 訊息監聽 useEffect         ← 一次性，註冊 listener
4. URL 參數 useEffect         ← 依賴 searchParams
5. 切換取貨方式 useEffect      ← 既有
```

URL 參數和 draft 還原的 state 都會收斂到同一份 React state（因為 setState 是 batched），不會打架。

#### 1. `openCvsMap`

```ts
const openCvsMap = useCallback(() => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  const subType = shippingMethod === "family" ? "FAMIC2C" : "UNIMARTC2C"
  const url = `${apiUrl}/logistics/map?logisticsSubType=${subType}&isCollection=N`

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  if (isMobile) {
    saveCvsDraft()
    window.location.href = url
    return
  }

  const popup = window.open(url, "_blank", "width=800,height=600")
  if (!popup || typeof popup.closed === "undefined") {
    saveCvsDraft()
    window.location.href = url
  }
}, [
  shippingMethod,
  // draft 用到的所有 form fields
  name, phone, email, addressType, city, district, postalCode, addressLine, invoice,
])
```

#### 2. 訊息監聽 `useEffect`（新增）

```ts
useEffect(() => {
  function onMessage(e: MessageEvent) {
    if (e.origin !== window.location.origin) return
    const data = e.data as Partial<CvsMessage> | null
    if (data?.type !== "cvs-selected") return
    if (!data.storeId || !data.storeName) return

    setCvsStoreId(data.storeId)
    setCvsStoreName(data.storeName)
    if (data.address) setCvsAddress(data.address)
    if (data.subType === "FAMIC2C") {
      setShippingMethod("family")
      setAddressType("cvs")
    } else if (data.subType === "UNIMARTC2C") {
      setShippingMethod("711")
      setAddressType("cvs")
    }
  }
  window.addEventListener("message", onMessage)
  return () => window.removeEventListener("message", onMessage)
}, [])
```

#### 3. URL 參數 `useEffect`（既有，改）

```ts
useEffect(() => {
  const storeId = searchParams.get("cvsStoreId")
  const storeName = searchParams.get("cvsStoreName")
  if (!storeId || !storeName) return

  const address = searchParams.get("cvsAddress") ?? undefined
  const subType = searchParams.get("logisticsSubType") ?? undefined

  // 如果這是彈窗 → 通知 opener、自己關掉
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(
        { type: "cvs-selected", storeId, storeName, address, subType },
        window.location.origin,
      )
      window.close()
      return
    } catch {
      // postMessage / close 失敗 → fall through 走 inline
    }
  }

  // 同分頁回流（C fallback 路徑），或 opener 已關 → inline 更新
  setCvsStoreId(storeId)
  setCvsStoreName(storeName)
  if (address) setCvsAddress(address)
  if (subType === "FAMIC2C") {
    setShippingMethod("family")
    setAddressType("cvs")
  } else if (subType === "UNIMARTC2C") {
    setShippingMethod("711")
    setAddressType("cvs")
  }
  window.history.replaceState({}, "", "/checkout")
}, [searchParams])
```

#### 4. Draft 還原 `useEffect`（新增，只跑一次）

```ts
useEffect(() => {
  const raw = localStorage.getItem("realreal-cvs-draft")
  if (!raw) return
  try {
    const draft = JSON.parse(raw) as CvsDraft
    if (Date.now() > draft.expiresAt) {
      localStorage.removeItem("realreal-cvs-draft")
      return
    }
    if (draft.name) setName(draft.name)
    if (draft.phone) setPhone(draft.phone)
    if (draft.email) setEmail(draft.email)
    if (draft.city) setCity(draft.city)
    if (draft.district) setDistrict(draft.district)
    if (draft.postalCode) setPostalCode(draft.postalCode)
    if (draft.addressLine) setAddressLine(draft.addressLine)
    if (draft.addressType) setAddressType(draft.addressType)
    if (draft.shippingMethod) setShippingMethod(draft.shippingMethod)
    if (draft.invoice) setInvoice(draft.invoice)
  } catch {
    // bad draft → 清掉
  } finally {
    localStorage.removeItem("realreal-cvs-draft")
  }
}, [])

function saveCvsDraft() {
  const draft: CvsDraft = {
    name, phone, email,
    addressType, city, district, postalCode, addressLine,
    shippingMethod, invoice,
    expiresAt: Date.now() + 5 * 60_000,
  }
  localStorage.setItem("realreal-cvs-draft", JSON.stringify(draft))
}
```

### API 不動

`/logistics/map` 與 `/logistics/map-result` 維持現狀。所有「我是彈窗還是分頁？」的判斷只在前端做，API 不需要兩種回應分支。

---

## 型別

```ts
type CvsMessage = {
  type: "cvs-selected"
  storeId: string
  storeName: string
  address?: string
  subType?: "FAMIC2C" | "UNIMARTC2C"
}

type CvsDraft = {
  name: string
  phone: string
  email: string
  addressType: "home" | "cvs"
  city: string
  district: string
  postalCode: string
  addressLine: string
  shippingMethod: "home_delivery" | "711" | "family"
  invoice: InvoiceState  // 已存在的 invoice state type
  expiresAt: number      // Date.now() + 5 * 60_000
}
```

**安全**：
- 發：第二參數 `targetOrigin` 用 `window.location.origin`（同 origin，不會洩漏到第三方）
- 收：先檢查 `e.origin === window.location.origin`，再檢查 `e.data.type === "cvs-selected"` 才處理。任意第三方頁面無法注入 `cvs-selected`，因為他們不在我們的 origin 內。

---

## C fallback 觸發條件

**任一**成立就走 C：

1. `popup === null` — 經典 popup blocker
2. `typeof popup.closed === "undefined"` — 某些手機瀏覽器這樣回
3. `navigator.userAgent` 含 `Mobi|Android|iPhone|iPad` — 手機強制走 C，避免依賴不可靠的 `window.open`

C 流程：

1. `saveCvsDraft()` 把 form 寫進 `localStorage["realreal-cvs-draft"]`（含 `expiresAt`）
2. `window.location.href = url` 直接同分頁跳 ECPay
3. ECPay 回 `/checkout?cvsStoreId=...`
4. 進場 `useEffect` 還原 draft、清 draft
5. URL 參數 `useEffect` 偵測 `window.opener === null`（同分頁，沒 opener）→ 走 inline 更新分支 → 門市帶入

---

## 邊角

| 情境 | 處理 |
|---|---|
| opener 已關（使用者關了原視窗） | postMessage 拋例外 → catch → fall through 到 inline 更新 → 彈窗內顯示已選好門市，使用者看完關掉 |
| 使用者 ✕ 關彈窗未選擇 | 主視窗保持「尚未選擇」，可以再按 |
| draft 過 5 分鐘 | 進場 `useEffect` 偵測 expired → 清掉、不還原 |
| 重複選門市 | 每次 message 都 setState，後一筆覆寫前一筆 |
| popup 沒被 `null` 但實際被擋（罕見瀏覽器） | C fallback 不觸發，使用者卡住 → 既有按鈕仍可再按一次 → 不算 regress 因為原本就是這樣 |
| 切換取貨方式（宅配 ↔ 超商） | 不動相關 state、既有切換 useEffect 保持 |
| `window.opener` 是 `null` 但 URL 有參數 | 同分頁路徑（C fallback 回來）→ 直接走 inline → 正常 |

---

## 不做什麼（YAGNI）

- **不**改 API：所有判斷都在前端
- **不**做 iframe 嵌入 ECPay：他們的 X-Frame-Options 應該擋
- **不**做專用 callback 頁（Option B）：/checkout 本來就要讀 URL 參數，多一個 route 是冗餘
- **不**處理使用者開多個 checkout 分頁的場景：postMessage 只給 opener，天然隔離
- **不**做 draft 在多個欄位 setState 後的 debounce 儲存：只在按「選擇取貨門市」當下存一次就好

---

## 驗證計畫

| # | 情境 | 預期 |
|---|---|---|
| 1 | 桌機 happy path | 宅配 → 改超商 → 7-11 → popup 跳 → 選門市 → popup 自動關 → 主視窗 cvsStoreName 出現、姓名/手機沒被清掉 |
| 2 | popup blocker | Chrome 設定關掉 popup → 點選 → 同分頁跳 ECPay → 回來 → 表單還在 + 門市帶入 |
| 3 | 手機 Safari / Chrome | UA 偵測命中 → 走 C → 順暢 |
| 4 | 重選 | 選 A → 再按 → 選 B → 顯示 B |
| 5 | 填一半切換取貨方式 | 填縣市 → 切超商 → 切回宅配 → 縣市仍在 |
| 6 | 全家 vs 7-11 | 兩家都跑一次，shippingMethod 對應 family / 711 |
| 7 | postMessage 安全 | 開另一個分頁載任意第三方頁、嘗試 `window.opener.postMessage({type:"cvs-selected"...})` → 主視窗的 origin check 應該擋掉（無法測，但邏輯有 origin guard） |

---

## 相關檔案

- 改：`apps/web/src/app/checkout/page.tsx`（唯一）
- 不動：`apps/api/src/routes/logistics.ts`
- 不動：`apps/api/src/lib/ecpay-logistics.ts`
- 不動：`apps/api/src/lib/urls.ts`

---

## 上線後

- 觀察 1-2 天，如果手機強制走 C 沒問題，可考慮把桌機也統一走 C（彈窗永遠是 UX 弱點）。先不做，現狀工作即可。
- 未來新增物流通路（萊爾富、家樂福、OK）只要 `LogisticsSubType` 加 enum 對應即可，主流程不動。
