export function renderPaymentConfirmed(data: { orderNumber: string; amount: string; method: string }): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <h2>付款成功確認</h2>
    <p>您的訂單 <strong>#${data.orderNumber}</strong> 付款成功。</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;color:#666">付款金額</td><td style="padding:8px;font-weight:bold">NT$${data.amount}</td></tr>
      <tr><td style="padding:8px;color:#666">付款方式</td><td style="padding:8px">${data.method}</td></tr>
    </table>
    <p>我們將盡快為您安排出貨，請耐心等候。</p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#999">誠真生活股份有限公司 | <a href="https://realreal.cc">realreal.cc</a></p>
  </body></html>`
}
