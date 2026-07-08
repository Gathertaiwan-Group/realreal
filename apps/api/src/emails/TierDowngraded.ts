export function renderTierDowngraded(data: { fromTier: string; toTier: string; nextRequalifyAmount: number; toPerks: string[] }): string {
  const perkItems = data.toPerks.map(p => `<li style="padding:4px 0">${p}</li>`).join("")
  const formattedAmount = data.nextRequalifyAmount.toLocaleString("en-US")
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <h2>會員等級調整通知</h2>
    <p>期內未累積至 <strong>NT$${formattedAmount}</strong>，已調整為 <strong>${data.toTier}</strong> 等級。</p>
    ${data.toPerks.length > 0 ? `<h3>您目前的會員權益：</h3><ul>${perkItems}</ul>` : ""}
    <p>未來繼續累積至 <strong>NT$${formattedAmount}</strong> 即可升回 <strong>${data.fromTier}</strong>。</p>
    <p><a href="https://realreal.cc/shop" style="background:#10305a;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;margin-top:8px">立即購物累積消費</a></p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#999">誠真生活股份有限公司 | <a href="https://realreal.cc">realreal.cc</a></p>
  </body></html>`
}
