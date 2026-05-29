# 管理員後台：金流 / 物流 / 發票 / 通知 參數熱更新 — 設計

**日期**：2026-05-30
**範疇**：新增 admin page、DB 表、加密層、API、把所有 credential 讀取點改成可被 DB 覆寫
**目標**：管理員從後台改任何整合參數後，**不重啟、不重 deploy**，下一個 request 就吃到新值

---

## 問題

目前所有金流/物流/發票/通知整合的 credential（PChomePay、LINE Pay、街口、ECPay、Amego、Resend）都在 `process.env.X` 寫死，**改一個值必須**：
1. 改 Railway environment variable
2. 等 Railway 重新 build container
3. 等 worker / api 重新啟動

對 ops 來說：切廠商、輪換 key、改寄件人地址、開關沙箱 → 都要走整個 deploy 流程。

## 方案

DB 為主、env 為 fallback：

```
讀取： getSetting("pchomepay.app_id") ?? process.env.PCHOMEPAY_APP_ID ?? ""
寫入： admin UI → POST /admin/settings → 加密 → upsert DB → invalidate cache
```

DB 沒設 → 走 env（向後相容、零中斷遷移）。DB 有設 → DB 優先且 30s 內被 cache。

---

## DB schema

新增兩張表（migration 加在 `packages/db/migrations/0012_app_settings.sql`）：

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  -- AES-256-GCM 密文：base64(iv || ciphertext || authTag)
  value_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE app_settings_audit (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  action TEXT NOT NULL,          -- "set" | "unset"
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- 故意不存 old/new value 避免歷史值洩漏
);
CREATE INDEX idx_app_settings_audit_changed_at ON app_settings_audit (changed_at DESC);
```

**Key naming convention**：`<section>.<field>`，全小寫底線

```
pchomepay.app_id          pchomepay.secret           pchomepay.hash_key
pchomepay.hash_iv         pchomepay.sandbox          pchomepay.pay_types
linepay.channel_id        linepay.channel_secret     linepay.sandbox
jkopay.store_id           jkopay.api_key             jkopay.secret_key
jkopay.sandbox
ecpay.merchant_id         ecpay.hash_key             ecpay.hash_iv
ecpay.sandbox             ecpay.sender_name          ecpay.sender_phone
ecpay.sender_zip          ecpay.sender_city          ecpay.sender_address
amego.tax_id              amego.app_key              amego.webhook_secret
amego.sandbox
resend.api_key            resend.from_address        resend.from_name
```

---

## 加密層

`apps/api/src/lib/settings.ts`

```ts
const ALGO = "aes-256-gcm"
const KEY = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY ?? "", "hex") // 32 bytes

function encrypt(plain: string): string {
  if (KEY.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be 64 hex chars")
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, KEY, iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, enc, tag]).toString("base64")
}

function decrypt(b64: string): string {
  const buf = Buffer.from(b64, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const enc = buf.subarray(12, buf.length - 16)
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
}
```

`SETTINGS_ENCRYPTION_KEY` 必須在 Railway api + worker service 都設一樣。**一次設定，永不旋轉**（簡化；rotation 是 v2 議題）。

---

## getSetting + cache

```ts
type CacheEntry = { value: string | null; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 30_000

export async function getSetting(key: string): Promise<string | null> {
  const hit = cache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.value
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value_enc")
    .eq("key", key)
    .maybeSingle()
  const value = data?.value_enc ? decrypt(data.value_enc) : null
  cache.set(key, { value, expiresAt: Date.now() + TTL })
  return value
}

export function invalidateSetting(key: string) {
  cache.delete(key)
}
```

**為什麼 in-memory cache 安全**：Railway 目前 api 服務是單 instance。worker 是另一個 instance 但獨立 cache。改設定後：
- api cache invalidate（同 process 內保證）
- worker 最多 30s 後拿到新值（acceptable for invoice/billing jobs）

---

## API routes

`apps/api/src/routes/admin/settings.ts`

### GET /admin/settings

回傳分區結構 + 已設 key 的 mask 狀態：

```json
{
  "pchomepay": {
    "app_id":    { "set": true,  "preview": "••••••3a2f" },
    "secret":    { "set": true,  "preview": "•••••" },
    "hash_key":  { "set": false, "preview": null },
    "sandbox":   { "set": false, "value": "true" },
    "pay_types": { "set": false, "value": "CARD" }
  },
  "ecpay": {...},
  "amego": {...},
  "resend": {...},
  "linepay": {...},
  "jkopay": {...}
}
```

**規則**：
- Secret 類型欄位（含 `key`, `secret`, `id`）→ 從不回傳明文，只回 `set` + 最後 4 碼 preview
- 非 secret（sandbox 布林、from_address、sender_name、pay_types）→ 直接回 value

### PUT /admin/settings

```ts
// body: { key: "pchomepay.app_id", value: "new-app-id" }
// or:   { key: "pchomepay.app_id", value: null }  // 清除
```

- 驗證 key 在白名單（防 arbitrary write）
- 加密 → upsert app_settings → 寫入 app_settings_audit
- `invalidateSetting(key)` 立即清同 process cache
- 回 `{ ok: true }`

### GET /admin/settings/audit

回最近 50 筆 audit。

**全部走既有 admin auth middleware**（`requireAdmin` 或同等）。

---

## 既有 env 讀取點遷移

每個 credential 用點都改 wrapper（範例）：

```ts
// apps/api/src/lib/pchomepay.ts
async function getCreds() {
  const [appId, secret, hashKey, hashIv, sandbox, payTypes] = await Promise.all([
    getSetting("pchomepay.app_id"),
    getSetting("pchomepay.secret"),
    getSetting("pchomepay.hash_key"),
    getSetting("pchomepay.hash_iv"),
    getSetting("pchomepay.sandbox"),
    getSetting("pchomepay.pay_types"),
  ])
  return {
    appId:    appId    ?? process.env.PCHOMEPAY_APP_ID    ?? "",
    secret:   secret   ?? process.env.PCHOMEPAY_SECRET    ?? "",
    hashKey:  hashKey  ?? process.env.PCHOMEPAY_HASH_KEY  ?? "",
    hashIv:   hashIv   ?? process.env.PCHOMEPAY_HASH_IV   ?? "",
    sandbox:  (sandbox ?? process.env.PCHOMEPAY_SANDBOX ?? "false") === "true",
    payTypes: (payTypes ?? process.env.PCHOMEPAY_PAY_TYPES ?? "CARD").split(","),
  }
}
```

呼叫端從 `process.env.X` 改成 `await getCreds()`。因為加了 `await`，呼叫鏈一路 async 化（既有都是 async handler，影響小）。

**遷移範圍**：
- `apps/api/src/lib/pchomepay.ts`
- `apps/api/src/lib/linepay.ts`（如果存在；否則 stub）
- `apps/api/src/lib/jkopay.ts`（同上）
- `apps/api/src/routes/logistics.ts` + `apps/api/src/lib/ecpay-logistics.ts`
- `apps/api/src/workers/invoice-issuer.ts`（Amego）
- `apps/api/src/lib/email.ts` 或 `resend.ts`（找實際檔名）

---

## 前端 UI

`apps/web/src/app/admin/settings/page.tsx`

- 4 個 Accordion section：金流 / 物流 / 發票 / 通知
- 每個 section 內：fields 列表，每個 field 一行
  - Label（中文）+ 描述（小字）
  - 非 secret：直接 `<Input>` / `<Switch>`，輸入時 dirty 狀態
  - Secret：若 `set === true`，顯示 `已設定 ••••••3a2f` + 「修改」按鈕；按了才出現 input
  - Section 底部「儲存本區」按鈕：把該 section 內 dirty 的 fields 用 `Promise.all` 個別 PUT
- 儲存後：toast「已儲存並生效」+ refetch GET /admin/settings（避免 stale UI）
- 已存在的 admin auth：用既有 `lib/admin-fetch.ts` 帶 token

---

## 安全清單

| 項目 | 處理 |
|---|---|
| At-rest 加密 | AES-256-GCM，key 在 env 不入 DB |
| In-transit 加密 | HTTPS only（Vercel / Railway 都 TLS） |
| Secret 永不回前端 | API GET 只回 `set` + preview（最後 4 碼） |
| Audit | `app_settings_audit` 記 who/when/key/action，**不記 value** |
| 白名單檢查 | PUT body 的 key 必須在硬編碼的允許清單內 |
| Auth | 既有 admin middleware；非 admin → 401 |
| Key 旋轉 | v2 議題，本版不做 |
| 多人同時編輯 | 單管理員場景 → last-write-wins，不做 lock |

---

## 失敗模式

| 情境 | 處理 |
|---|---|
| `SETTINGS_ENCRYPTION_KEY` 沒設或長度錯 | api 啟動 throw → Railway healthcheck 失敗 → 看 log 修 env |
| key 旋轉導致舊密文解不開 | 解密 throw → fall back to `process.env.X`（getSetting 包 try-catch 回 null） |
| 改錯把金流弄壞 | UI 旁邊放 `[測試 ping]` 按鈕，呼叫該整合的最小 API 驗活（v1.5，先 ship 不含 ping） |
| Worker 30s 沒拿到新值 | 接受。Invoice 任務 retry 機制本來就有指數退避 |
| Supabase 暫時不可用 | getSetting 回 null → fall back env → 不中斷服務 |

---

## 驗證

1. 設 `SETTINGS_ENCRYPTION_KEY` 在 Railway api 與 worker
2. 跑 migration → 兩張表建好
3. UI 進 `/admin/settings` → 4 區都顯示、現有 env 值反映在 `set` 狀態（其實不會，因為 DB 空 → 全部 `set:false` 但下游讀仍走 env）
4. 改 `pchomepay.sandbox` 從未設 → "true"：
   - DB 出現一筆
   - audit 出現一筆
   - 立即發起一筆訂單 → log 確認用了 sandbox URL
5. 改 `ecpay.sender_name` → 立刻去 `/checkout` 走宅配 → API 用新寄件人
6. 刪除一個值（PUT value=null）→ getSetting 回 null → 下游 fallback env

---

## 不做（YAGNI）

- 設定值版本/diff 顯示
- 多人 lock / 衝突 detect
- 金鑰旋轉 UI
- export / import 整包設定
- 測試 ping 按鈕（v1.5）
- 角色細分（誰能看金流 / 誰能看發票）— 單管理員場景

---

## 相關檔案

新增：
- `packages/db/migrations/0012_app_settings.sql`
- `apps/api/src/lib/settings.ts`（crypto + cache + getSetting + invalidate）
- `apps/api/src/routes/admin/settings.ts`
- `apps/web/src/app/admin/settings/page.tsx`
- `apps/web/src/app/admin/settings/_client.tsx`（如沿用既有 admin pattern）

改：
- `apps/api/src/app.ts`（mount admin settings router）
- `apps/api/src/lib/pchomepay.ts`、相關 payment libs、`logistics.ts`、`invoice-issuer.ts`、`email.ts`
- `apps/web/src/app/admin/_layout` 或 sidebar：加「系統設定」入口

不動：
- 其他既有 admin pages
- DB schema 以外的 packages/db
- 既有 env 變數（保留作 fallback）
