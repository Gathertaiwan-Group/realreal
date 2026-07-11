export function renderPaymentReminder(data: {
  orderNumber: string
  customerName: string
  amount: string
  items: Array<{ name: string; qty: number; price: string }>
  pickupInfo: string
  repayUrl: string
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
    <p>您的訂單 <strong>#${data.orderNumber}</strong> 已成立，但我們尚未收到您的付款。為保留您的商品，請盡快完成付款。</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#687279;width:100px;vertical-align:top">訂單編號</td><td style="padding:6px 0;font-family:monospace;font-weight:bold">${data.orderNumber}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">應付金額</td><td style="padding:6px 0;font-weight:bold;color:#10305a">NT$${data.amount}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">取貨方式</td><td style="padding:6px 0">${data.pickupInfo}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">商品</td><td style="padding:6px 0"><table style="width:100%">${itemRows}</table></td></tr>
    </table>
    <p style="text-align:center;margin:28px 0">
      <a href="${data.repayUrl}" style="background:#10305a;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">立即完成付款</a>
    </p>
    <p style="font-size:13px;color:#687279">若按鈕無法點擊，請複製以下連結至瀏覽器開啟：<br><a href="${data.repayUrl}" style="color:#10305a;word-break:break-all">${data.repayUrl}</a></p>
    <p>若您已完成付款，請忽略此信。如有任何問題，歡迎與我們聯繫。</p>
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
