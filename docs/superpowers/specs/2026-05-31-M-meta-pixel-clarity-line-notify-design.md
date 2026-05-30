# Spec M — Meta Pixel + Microsoft Clarity + LINE Notify

**Date:** 2026-05-31
**Status:** Draft (user approved 全做)
**Touches:** apps/web (GTM tag config — 不動 code), apps/api (1 new lib + 3 hook patches), packages/db (0)
**Scope:** small-medium — ~350 LOC, 0 migration

## Why

3 件不同性質的「行銷 + 觀察 + 通知」工具補洞：

- **Meta Pixel** — FB/IG 投廣告必接（不接的話 ROAS 算不出來、Lookalike 無資料）
- **Microsoft Clarity** — 免費的使用者錄影 + 點擊熱圖（看顧客在 cart 卡在哪、商品頁哪段被忽略）
- **LINE Notify** — 新訂單立刻 push 到你 LINE、線上錯誤即時提醒（比看 email 快）

## Locked decisions
- Pixel + Clarity 走 GTM 容器（spec L 已裝 GTM；本案只在 GTM workspace 加兩個 tag，**不寫 code 在 next.js 內**）
- LINE Notify 走 server-side webhook（new order 在 `enqueue-post-payment.ts` 末段觸發，Sentry error 自動轉發）
- 全部 ID/token 走 app_settings + env override

## Scope

### IN
1. **Meta Pixel**：純 GTM 設定（用戶在 GTM workspace 加 Pixel tag + trigger）—**spec 本身 0 code**，文件指引
2. **Microsoft Clarity**：同上，純 GTM tag
3. **LINE Notify backend**：
   - 新 `apps/api/src/lib/line-notify.ts` — `sendLineNotify(message)` POST to notify-api.line.me
   - `enqueue-post-payment.ts` 在 admin email 之後加 `sendLineNotify(訂單通知)`
   - Sentry error 自動 → 加 Sentry beforeSend hook 也 push LINE
4. `/admin/settings` 加 marketing-tools section: Meta Pixel ID (display only, real config in GTM) / Clarity ID (同) / LINE Notify Token (input + 保密)

### OUT
- TikTok Pixel (沒 TikTok 廣告就不接)
- Google Ads conversion tag (要投 Google 廣告才裝)
- LINE Bot 雙向對話（純 push）
- Slack 整合（用 LINE 就好）

## Design

### Section 1 — Pixel + Clarity via GTM（純設定，無 code）

文件 `docs/marketing/gtm-tags-setup.md`：
```
1. 登入 tagmanager.google.com
2. 選 realreal.cc 容器
3. 新建 Tag「Meta Pixel - Base」
   - Tag Type: 自訂 HTML
   - 貼 Meta 的 base pixel script (含 fbq init)
   - Trigger: All Pages
4. 新建 Tag「Meta Pixel - Purchase」
   - Tag Type: 自訂 HTML → fbq('track', 'Purchase', { value: {{value}}, currency: 'TWD' })
   - Trigger: Custom Event "purchase" (對應 spec L dataLayer)
5. 新建 Tag「Microsoft Clarity」
   - Tag Type: 自訂 HTML → Clarity init script
   - Trigger: All Pages
6. Submit + Publish container
```

### Section 2 — LINE Notify backend

`apps/api/src/lib/line-notify.ts`:
```ts
import axios from "axios"
import { getSettingOrEnv } from "./settings"

export async function sendLineNotify(message: string) {
  try {
    const token = await getSettingOrEnv("notifications.line_notify_token", "LINE_NOTIFY_TOKEN")
    if (!token) return  // silently skip if not configured
    await axios.post(
      "https://notify-api.line.me/api/notify",
      new URLSearchParams({ message }).toString(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 5000,
      }
    )
  } catch (err) {
    // Non-fatal: log + continue. Don't let LINE outage break order flow.
    console.warn("[line-notify] failed:", err)
  }
}
```

`apps/api/src/lib/enqueue-post-payment.ts` 末段（在 admin email 之後）：
```ts
await sendLineNotify(
  `🛒 新訂單 #${orderNumber}\n` +
  `顧客：${userEmail ?? "guest"}\n` +
  `金額：NT$ ${total}\n` +
  `${kolSlug ? `來自 KOL：${kolSlug}` : ""}`
)
```

Sentry hook (在 `apps/api/src/sentry.ts` beforeSend 內)：
```ts
beforeSend(event) {
  // For ERROR level, also push to LINE
  if (event.level === "error" || event.level === "fatal") {
    const msg = `🚨 線上錯誤\n${event.exception?.values?.[0]?.value ?? event.message}\nURL: ${event.request?.url ?? "?"}`
    sendLineNotify(msg).catch(() => {})  // fire-and-forget
  }
  return event
}
```

### Section 3 — Admin settings UI

`/admin/settings` 加 marketing-tools section:
- Meta Pixel ID (text, info: "實際 tag 配置在 GTM workspace；此處僅供留存記錄")
- Clarity ID (text, info 同上)
- LINE Notify Token (password input, 與其他 SECRET_KEYS 同等保密)

Stored as `marketing.meta_pixel_id / marketing.clarity_id / notifications.line_notify_token`。

LINE Notify Token 加進 `SECRET_KEYS` set（encrypt at rest，UI 顯示遮罩）。

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `apps/api/src/lib/line-notify.ts` |
| 改 | `apps/api/src/lib/enqueue-post-payment.ts` (call sendLineNotify) |
| 改 | `apps/api/src/sentry.ts` (beforeSend → LINE on error) |
| 改 | `apps/api/src/lib/settings.ts` (3 keys + 1 SECRET) |
| 改 | `apps/web/src/app/admin/settings/page.tsx` (marketing-tools section) |
| 新 | `docs/marketing/gtm-tags-setup.md` (GTM 設定指引) |

預估 ~250 LOC code + ~100 LOC doc / 0 migration

## Validation
1. `tsc` 雙綠
2. 設 LINE_NOTIFY_TOKEN → POST 假訂單 → 你 LINE 應收訊息
3. 故意拋 error → 看 LINE 是否收到錯誤通知

## ⚠️ 需要你手動申請後給我 3 個值

| 工具 | 你做 | 拿到後給我 |
|---|---|---|
| **Meta Pixel** | 1. business.facebook.com 用 FB/IG 帳號登入（不是 Google）2. 商業管理工具 → 資料源 → Datasets → 建立「Pixel」3. 拿 Pixel ID（純數字 16 位） | `XXXXXXXXXXXXXXXX` (16 位數字) |
| **Microsoft Clarity** | 1. clarity.microsoft.com 用 gathertaiwan@gmail.com 2. 新增專案 → 網址 realreal.cc → 類別 E-commerce 3. 拿 Project ID（英數字 10 位） | `XXXXXXXXXX` |
| **LINE Notify Token** | 1. notify-bot.line.me 用 LINE 登入（**不是 Google**）2. 個人頁面 → 發行存取權杖 3. token 名稱「realreal-admin」、選擇「透過 1 對 1 LINE Notify 通知」（送到你個人 LINE）4. 拿 token 字串 | `xxxxx...` (約 43 字元 alphanumeric) |
