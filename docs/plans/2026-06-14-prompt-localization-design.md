# 提示語言繁中化（英文瀏覽器才英文）— 設計文件

> 狀態：設計已核准（2026-06-14），尚未實作。下一步：writing-plans 出實作計畫。

## 目標

網站上所有「提示類」文字（表單驗證、後端/Supabase 錯誤訊息、toast 等）預設一律**繁體中文**；只有當訪客的**瀏覽器語言**主要是英文時，這些提示才顯示英文。商品/文章等內容不在範圍內（本來就是繁中）。

## 背景診斷（為什麼會看到英文）

1. **瀏覽器原生 HTML5 驗證訊息**：表單欄位用了 `required` / `minLength` / `type="email"`，欄位不符時由**瀏覽器**用「瀏覽器自己的語言」跳訊息（例：英文瀏覽器顯示 "Please lengthen this text to 8 characters or more"）。這不是網站文字，HTML 無法直接翻譯，需用 JS `setCustomValidity` 覆寫。全站約 18 個表單都用共用元件 `@/components/ui/input`。
2. **Supabase / API 錯誤訊息**：程式把後端回的英文 `error.message`（例 "Invalid login credentials"）直接顯示給客人。
3. 網站**沒有任何 i18n 框架**，文字皆為寫死的繁中。

## 已定決策

- **範圍**：只做「提示 / 驗證 / 錯誤訊息」繁中化，不做整站雙語、不抽商品/文章內容。
- **語系判斷**：瀏覽器語言（client 讀 `navigator.language`、server 讀 `Accept-Language`）。`en-*` → `en`；其餘 → `zh-Hant`（預設）。
- **不引入 i18n 框架**：提示字串量小，自製輕量字典即可（YAGNI）。

## 架構（5 個部分）

1. **語系偵測 `lib/locale.ts`**
   - `resolveLocale(acceptLanguageOrNavLang): 'zh-Hant' | 'en'`（`en-*` → en，否則 zh-Hant）。
   - Root layout 以 `Accept-Language` 算出 locale，放進 React Context 供 client 用，並設 `<html lang>`。Client 端 fallback 讀 `navigator.language`。

2. **提示字典 `lib/messages.ts`**
   - 只含提示類字串的 `zh-Hant` + `en` 兩版（驗證訊息、常見錯誤、少量 hint）。
   - `t(key, locale, params?)` 取字；長度類訊息支援 `{n}` 參數。

3. **瀏覽器原生驗證 → 在地化（改共用 `ui/input`，全站生效）⭐**
   - 強化 `@/components/ui/input`：`onInvalid` 依 `event.target.validity`（`valueMissing` / `typeMismatch` / `tooShort` / `patternMismatch`…）+ locale 呼叫 `setCustomValidity(在地化訊息)`；`onInput` 清空 `setCustomValidity('')` 以便重新驗證。
   - 一處改動 → 全站 18 個表單的原生驗證訊息都在地化。若有 `select` / `textarea` 用到原生驗證，沿用同模式（次要）。

4. **後端 / Supabase 錯誤訊息 → 在地化**
   - `translateError(message, locale)`：已知 Supabase auth / 常見 API 英文錯誤 → 對應字典 key；未知錯誤回傳通用繁中訊息（不外洩原始英文）。
   - 套用在顯示錯誤的點：`auth/actions.ts` 及各 toast/inline error。

5. **稽核殘留英文**
   - 掃 web 端 toast/alert/hardcoded 字串，將漏網英文提示補進字典。

## 不在範圍（YAGNI）

整站雙語、商品/文章內容雙語、IP 地理定位服務、next-intl/i18next 框架。

## 驗收標準

- 繁中瀏覽器：所有提示/驗證/錯誤訊息皆繁中（附圖那段變「請至少輸入 8 個字元」）。
- 英文瀏覽器：同樣訊息顯示英文。
- 商品/文章內容不變。
- `apps/web` tsc + eslint 通過；既有測試不破。
