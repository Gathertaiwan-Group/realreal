export function renderOrderShipped(data: { orderNumber: string; customerName: string }): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <h2>您的訂單已出貨！</h2>
    <p>親愛的 ${data.customerName}，</p>
    <p>訂單 <strong>#${data.orderNumber}</strong> 已出貨，感謝您的耐心等待。</p>
    <p>商品已送出，請留意手機通知到貨訊息。</p>
    <p>如有任何問題，歡迎透過官網與我們聯繫。</p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#999">誠真生活股份有限公司 | <a href="https://realreal.cc">realreal.cc</a></p>
  </body></html>`
}
