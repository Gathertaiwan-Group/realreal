export function renderOrderConfirmation(data: { orderNumber: string; items: Array<{ name: string; qty: number; price: string }>; total: string; address: string }): string {
  const itemRows = data.items.map(item =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eee">${item.name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${item.qty}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">NT$${item.price}</td></tr>`
  ).join("")

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <h2>訂單確認</h2>
    <p>感謝您的訂購！您的訂單編號為 <strong>#${data.orderNumber}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">商品</th><th style="padding:8px">數量</th><th style="padding:8px;text-align:right">金額</th></tr></thead>
      <tbody>${itemRows}</tbody>
      <tfoot><tr><td colspan="2" style="padding:8px;font-weight:bold">總計</td><td style="padding:8px;text-align:right;font-weight:bold">NT$${data.total}</td></tr></tfoot>
    </table>
    <p><strong>送貨地址：</strong>${data.address}</p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#999">誠真生活股份有限公司 | <a href="https://realreal.cc">realreal.cc</a></p>
  </body></html>`
}
