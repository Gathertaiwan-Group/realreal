# GTM Tags Setup — Meta Pixel + Microsoft Clarity

本文件說明如何在 realreal.cc 的 Google Tag Manager (GTM) 容器內，加入兩個行銷觀察工具：

1. **Meta Pixel** — Facebook / Instagram 廣告投放與轉換追蹤
2. **Microsoft Clarity** — 使用者錄影與點擊熱圖

> 前置條件：spec L 已將 GTM 容器嵌入 `apps/web`，容器 ID 已設定於 `app_settings.marketing.gtm_container_id`。本文件不涉及任何程式碼修改，**所有設定皆在 GTM workspace 內完成**。
>
> 你需要先在 [Meta Business Manager](https://business.facebook.com) 與 [Microsoft Clarity](https://clarity.microsoft.com) 拿到對應的 ID，分別填入下方的 `{{PIXEL_ID}}` 與 `{{CLARITY_ID}}` 佔位符。

---

## 步驟 0 — 準備兩組 ID

| 工具 | 取得位置 | 格式 |
|---|---|---|
| Meta Pixel ID | business.facebook.com → 商業管理工具 → 資料源 → Datasets | 16 位純數字 |
| Microsoft Clarity Project ID | clarity.microsoft.com → 新增專案 → 設定 → 安裝 | 10 位英數字 |

拿到後也記得回 `/admin/settings` 的「行銷工具」區塊填入留存記錄（實際 tag 仍以 GTM workspace 為準）。

---

## 步驟 1 — 登入 GTM 並進入 workspace

1. 開啟 [tagmanager.google.com](https://tagmanager.google.com)
2. 用具有容器編輯權限的 Google 帳號登入（gathertaiwan@gmail.com）
3. 選擇 **realreal.cc** 容器（容器 ID 形如 `GTM-XXXXXXX`）
4. 進入預設 workspace（左側欄會顯示「Default Workspace」或既有工作空間名稱）
5. 左側選單點 **Tags**（標籤），準備新增三組 tag

---

## 步驟 2 — 建立 Tag「Meta Pixel - Base」

此 tag 負責在所有頁面載入時初始化 Meta Pixel SDK，記錄 PageView。

1. Tags 頁面點右上 **New**
2. Tag 命名為：`Meta Pixel - Base`
3. 點上方 **Tag Configuration** → 選 **Custom HTML**
4. 在 HTML 欄位貼入下列 script（記得把 `{{PIXEL_ID}}` 換成你的 16 位 Pixel ID）：

   ```html
   <!-- Meta Pixel Code -->
   <script>
     !function(f,b,e,v,n,t,s)
     {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
     n.callMethod.apply(n,arguments):n.queue.push(arguments)};
     if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
     n.queue=[];t=b.createElement(e);t.async=!0;
     t.src=v;s=b.getElementsByTagName(e)[0];
     s.parentNode.insertBefore(t,s)}(window, document,'script',
     'https://connect.facebook.net/en_US/fbevents.js');
     fbq('init', '{{PIXEL_ID}}');
     fbq('track', 'PageView');
   </script>
   <noscript><img height="1" width="1" style="display:none"
     src="https://www.facebook.com/tr?id={{PIXEL_ID}}&ev=PageView&noscript=1"
   /></noscript>
   <!-- End Meta Pixel Code -->
   ```

5. **Advanced Settings** → **Tag firing options** → 選 **Once per page**（避免 SPA 重複觸發）
6. 下方 **Triggering** → 選 **All Pages**（內建 trigger，類型為 Page View）
7. 右上 **Save**

---

## 步驟 3 — 建立 Tag「Meta Pixel - Purchase」

此 tag 在使用者完成結帳時觸發，將訂單金額回傳給 Meta，用來計算 ROAS、訓練 Lookalike 廣告。

> 前置：spec L 已在結帳成功頁推送 `dataLayer.push({ event: 'purchase', value: <總金額>, currency: 'TWD' })`。本 tag 監聽此事件。

### 3.1 先建一個 Data Layer Variable 取出 `value`

1. 左側 **Variables** → 下方 **User-Defined Variables** → **New**
2. 命名：`DLV - purchase value`
3. **Variable Configuration** → **Data Layer Variable**
4. Data Layer Variable Name 填：`value`
5. Save

### 3.2 建 Custom Event Trigger

1. 左側 **Triggers** → **New**
2. 命名：`Custom Event - purchase`
3. **Trigger Configuration** → **Custom Event**
4. Event name 填：`purchase`
5. This trigger fires on：**All Custom Events**
6. Save

### 3.3 建 Tag

1. **Tags** → **New**
2. 命名：`Meta Pixel - Purchase`
3. **Tag Configuration** → **Custom HTML**
4. 貼入下列 script（同樣記得把 `{{PIXEL_ID}}` 換成 16 位 Pixel ID）：

   ```html
   <script>
     if (typeof fbq === 'function') {
       fbq('track', 'Purchase', {
         value: {{DLV - purchase value}},
         currency: 'TWD'
       });
     }
   </script>
   ```

   > 注意：`{{DLV - purchase value}}` 是 GTM 變數插值語法，**不是字串佔位符**。GTM 會在執行時自動代換成 dataLayer 裡的 `value` 值。
5. **Tag Sequencing**（可選但建議）→ 勾 **Fire a tag before Meta Pixel - Purchase fires** → 選 `Meta Pixel - Base`，確保 base 先載入再觸發 Purchase
6. **Triggering** → 選 `Custom Event - purchase`
7. Save

---

## 步驟 4 — 建立 Tag「Microsoft Clarity」

Clarity 提供免費的使用者錄影與點擊熱圖，用來看顧客在 cart 卡在哪、商品頁哪段被忽略。

1. **Tags** → **New**
2. 命名：`Microsoft Clarity`
3. **Tag Configuration** → **Custom HTML**
4. 貼入下列 script（記得把 `{{CLARITY_ID}}` 換成你的 10 位 Project ID）：

   ```html
   <!-- Microsoft Clarity -->
   <script type="text/javascript">
     (function(c,l,a,r,i,t,y){
       c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
       t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
       y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
     })(window, document, "clarity", "script", "{{CLARITY_ID}}");
   </script>
   <!-- End Microsoft Clarity -->
   ```

5. **Advanced Settings** → **Tag firing options** → 選 **Once per page**
6. **Triggering** → 選 **All Pages**
7. Save

---

## 步驟 5 — Preview 預覽（強烈建議）

發布前先用 GTM 內建的 Tag Assistant 確認三個 tag 都能正確觸發。

1. 右上 **Preview** → 開啟 Tag Assistant
2. 輸入 `https://realreal.cc`（或 staging 網址）→ Connect
3. 新分頁開啟網站，左下角會出現「Tag Assistant Connected」標記
4. 回到 Tag Assistant 視窗，**Summary** 頁籤應看到：
   - `Meta Pixel - Base` → Fired
   - `Microsoft Clarity` → Fired
5. 走到結帳成功頁（或在 console 手動 `dataLayer.push({ event: 'purchase', value: 999, currency: 'TWD' })`）
6. Tag Assistant 應出現新事件 `purchase`，並顯示 `Meta Pixel - Purchase` → Fired
7. 同時開 [Meta Events Manager](https://business.facebook.com/events_manager) 對應 Pixel 的 **Test Events**，應看到 PageView 與 Purchase 即時進來

若某個 tag 沒 Fired，回到該 tag 檢查 trigger 設定與 HTML 是否有語法錯誤。

---

## 步驟 6 — Submit 與 Publish

確認 Preview 三個 tag 都正常後即可發布。

1. 右上 **Submit**
2. **Version Name** 填：`Add Meta Pixel + Clarity`（或當下日期）
3. **Version Description** 填：`Meta Pixel base + purchase + Clarity heatmap via GTM`
4. **Publish and Create Version** → 確認 **Publish to: Live**
5. 點 **Publish**
6. 發布完成後，GTM 會跳到版本詳情頁，記下 **Version Number**（之後若需回滾，可在 Versions 頁面選舊版本 → Publish）

---

## 驗證（發布後 10 分鐘內）

| 工具 | 驗證方式 |
|---|---|
| Meta Pixel | Meta Events Manager → Diagnostics 應為綠燈；Overview 應看到 PageView 流量 |
| Meta Pixel Purchase | 下一筆真實訂單後，Events Manager 應出現 Purchase 事件並帶 value |
| Microsoft Clarity | clarity.microsoft.com 進專案 Dashboard，10–30 分鐘內應看到第一筆 session 進來 |

若 24 小時後仍無資料，先檢查：

- GTM 容器是否確實 Publish（不是只 Save）
- Pixel ID / Clarity ID 是否填對（純數字 vs 英數字勿混淆）
- Browser 是否裝了廣告攔截器（自測時請用無痕視窗）
- 網站是否真的有人流量

---

## 後續維護

- **新增其他 Meta 事件**（AddToCart、InitiateCheckout 等）：仿步驟 3，建對應 dataLayer event 名稱 + Custom Event trigger + Custom HTML tag
- **暫停某個 tag**：Tags 頁面點 tag → 右上 **Pause** → Submit + Publish
- **更換 Pixel ID / Clarity ID**：直接編輯對應 tag 的 HTML，重 Submit + Publish；**也記得同步更新** `/admin/settings` 的留存記錄
- **權限變更**：GTM 帳號 → Admin → User Management
