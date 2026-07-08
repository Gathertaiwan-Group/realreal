export function renderTierUpgrade(data: { newTier: string; discountRate: number; perks: string[] }): string {
  const discountPercent = Math.round(data.discountRate * 100)
  const perkItems = data.perks.map(p => `<li style="padding:4px 0">${p}</li>`).join("")
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <h2>🎉 恭喜升級為${data.newTier}！</h2>
    <p>感謝您的支持！您已成功升級為 <strong>${data.newTier}</strong>，享有 <strong>${discountPercent}折</strong> 會員優惠。</p>
    ${data.perks.length > 0 ? `<h3>您的專屬權益：</h3><ul>${perkItems}</ul>` : ""}
    <p><a href="https://realreal.cc/shop" style="background:#10305a;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;margin-top:8px">立即購物享優惠</a></p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#999">誠真生活股份有限公司 | <a href="https://realreal.cc">realreal.cc</a></p>
  </body></html>`
}
