export function renderSubscriptionFailed(data: { planName: string; retryDate: string; manageUrl: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <h2>⚠️ 訂閱扣款失敗</h2>
    <p>您的 <strong>${data.planName}</strong> 訂閱扣款失敗，請更新付款資訊以避免訂閱中斷。</p>
    <p>系統將於 <strong>${data.retryDate}</strong> 再次嘗試扣款。</p>
    <p><a href="${data.manageUrl}" style="background:#e53e3e;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;margin-top:8px">更新付款資訊</a></p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#999">誠真生活股份有限公司 | <a href="https://realreal.cc">realreal.cc</a></p>
  </body></html>`
}
