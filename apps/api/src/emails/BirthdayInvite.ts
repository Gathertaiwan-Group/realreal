/**
 * 生日補填邀請信。
 *
 * 生日禮金的活動與程式邏輯早就上線，但 187 位會員只有 11 位填了生日 —— 前台在
 * 2026-09-04 之前根本沒有輸入欄位。這封信的目的只有一個：把既有會員帶去會員中心
 * 補填。所以主旨與內文都直接講金額，而不是含糊地說「請完善資料」。
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function birthdayInviteSubject(gift: number): string {
  return `【誠真生活】補填生日，生日當月享會員禮金 NT$ ${gift}`
}

export function renderBirthdayInvite(
  name: string,
  tier: string,
  gift: number,
): string {
  return `<div style="font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;line-height:1.8">
  <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px;font-size:22px">誠真生活 RealReal</h1>

  <p>親愛的 ${escapeHtml(name)}，</p>

  <p>我們為會員加上了<strong>生日禮金</strong>：生日當月消費，結帳時自動折抵，不需要輸入任何優惠碼。<br>整個月都算數 —— 生日是 5 月 21 日，5 月 1 日就能用。</p>

  <div style="border:1px solid #d9e2ec;background:#f6f9fc;border-radius:10px;padding:18px 20px;margin:22px 0">
    <p style="margin:0 0 6px;color:#687279;font-size:13px">您目前的會員等級</p>
    <p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#10305a">${escapeHtml(tier)}</p>
    <p style="margin:0 0 6px;color:#687279;font-size:13px">生日禮金</p>
    <p style="margin:0;font-size:26px;font-weight:700;color:#10305a">NT$ ${gift}</p>
  </div>

  <p>
    只是我們手上還沒有您的生日 —— 這份禮金目前送不出去。<br>
    到會員中心補填，之後每年生日都會自動生效。
  </p>

  <!-- 按鈕用 table + bgcolor 屬性，不是 <a> 上的 CSS background。
       Gmail 手機版深色模式會改寫 CSS 顏色：深藍底被留著、白字被改暗，結果整顆
       按鈕在深色背景上等於消失（2026-09-04 實測）。bgcolor 是 HTML 屬性，深色
       模式不會動它；白字加 !important 擋掉文字被改色；外框白線在淺色背景上看不
       出來，在深色背景上正好把按鈕的形狀描出來。 -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto">
    <tr>
      <td bgcolor="#10305a" style="background-color:#10305a;border:2px solid #ffffff;border-radius:10px">
        <a href="https://realreal.cc/my-account#account-settings"
           style="display:inline-block;padding:15px 38px;color:#ffffff !important;
                  text-decoration:none;font-weight:700;font-size:17px;line-height:1">
          <span style="color:#ffffff !important">前往補填生日 →</span>
        </a>
      </td>
    </tr>
  </table>

  <p style="font-size:13px;color:#687279;margin:0 0 4px">
    如果按鈕無法點選，請複製以下網址到瀏覽器開啟：
  </p>
  <p style="font-size:13px;margin:0 0 24px">
    <span style="color:#10305a;word-break:break-all">https://realreal.cc/my-account#account-settings</span>
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 8px">
    <tr>
      <td style="padding:7px 0;color:#687279;width:110px;vertical-align:top">使用期間</td>
      <td style="vertical-align:top">生日當月，整個月都可以使用</td>
    </tr>
    <tr>
      <td style="padding:7px 0;color:#687279;vertical-align:top">使用方式</td>
      <td style="vertical-align:top">結帳時自動折抵，無需優惠碼；<strong>每年限用一次</strong>，不與首購折扣併用</td>
    </tr>
    <tr>
      <td style="padding:7px 0;color:#687279;vertical-align:top">請留意</td>
      <td style="vertical-align:top">生日<strong>設定後無法自行修改</strong>，填寫前請再確認一次；若需更正請聯絡客服</td>
    </tr>
  </table>

  <p style="margin-top:24px">生日快樂要說得剛剛好，我們先把禮金準備好。</p>
  <p>誠真生活 敬上</p>

  <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
  <p style="font-size:13px;color:#555;line-height:2;margin:0">
    誠真生活 | <a href="https://realreal.cc" style="color:#10305a">realreal.cc</a><br>
    Email: <a href="mailto:love@realreal.cc" style="color:#10305a">love@realreal.cc</a><br>
    Line 真人客服: @900kevgi
  </p>
</div>`
}
