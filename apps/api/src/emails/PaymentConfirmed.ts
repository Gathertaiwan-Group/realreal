export function renderPaymentConfirmed(data: {
  orderNumber: string
  amount: string
  customerName: string
  items: Array<{ name: string; qty: number; price: string }>
  pickupInfo: string
}): string {
  const itemRows = data.items.map(item =>
    `<tr>
      <td style="padding:4px 0;color:#333">${item.name}</td>
      <td style="padding:4px 0;color:#687279;text-align:center;padding-left:12px">× ${item.qty}</td>
      <td style="padding:4px 0;text-align:right;padding-left:12px">NT$${item.price}</td>
    </tr>`
  ).join("")

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <p>親愛的 ${data.customerName}，</p>
    <p>感謝您的訂購！您的訂單已成立，付款成功。</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#687279;width:100px;vertical-align:top">訂單編號</td><td style="padding:6px 0;font-family:monospace;font-weight:bold">${data.orderNumber}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">應付金額</td><td style="padding:6px 0;font-weight:bold;color:#10305a">NT$${data.amount}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">付款方式</td><td style="padding:6px 0">線上付款</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">取貨方式</td><td style="padding:6px 0">${data.pickupInfo}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">商品</td><td style="padding:6px 0"><table style="width:100%">${itemRows}</table></td></tr>
    </table>
    <p>訂單將於 2–5 個工作天備貨出貨。</p>
    <p>如需查詢訂單狀態，請聯絡客服。</p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:13px;color:#555;line-height:2">
      誠真生活 | <a href="https://realreal.cc" style="color:#10305a">realreal.cc</a><br>
      Email: <a href="mailto:love@realreal.cc" style="color:#10305a">love@realreal.cc</a><br>
      Line 真人客服: @900kevgi
    </p>
  </body></html>`
}
