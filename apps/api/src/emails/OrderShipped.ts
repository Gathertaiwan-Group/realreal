export function renderOrderShipped(data: { orderNumber: string; customerName: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <p>親愛的 ${data.customerName}，</p>
    <p>訂單 <strong>#${data.orderNumber}</strong> 已出貨，感謝您的耐心等待。</p>
    <p>請留意手機通知到貨訊息。</p>
    <p>如有任何問題，歡迎與我們聯繫。</p>
    <p>我們會用誠真，回覆您。</p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:13px;color:#555;line-height:2">
      誠真生活 | <a href="https://realreal.cc" style="color:#10305a">realreal.cc</a><br>
      Email: <a href="mailto:love@realreal.cc" style="color:#10305a">love@realreal.cc</a><br>
      Line 真人客服: @900kevgi<br>
      Tel: 02-66093066
    </p>
  </body></html>`
}
