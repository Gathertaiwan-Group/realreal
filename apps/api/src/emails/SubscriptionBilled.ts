export function renderSubscriptionBilled(data: { planName: string; amount: string; nextBillingDate: string; orderNumber: string }): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <h2>訂閱扣款成功</h2>
    <p>您的 <strong>${data.planName}</strong> 訂閱已成功扣款。</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;color:#666">扣款金額</td><td style="padding:8px;font-weight:bold">NT$${data.amount}</td></tr>
      <tr><td style="padding:8px;color:#666">訂單編號</td><td style="padding:8px">#${data.orderNumber}</td></tr>
      <tr><td style="padding:8px;color:#666">下次扣款日</td><td style="padding:8px">${data.nextBillingDate}</td></tr>
    </table>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#999">誠真生活股份有限公司 | <a href="https://realreal.cc">realreal.cc</a></p>
  </body></html>`
}
