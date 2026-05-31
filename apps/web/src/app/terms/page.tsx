import type { Metadata } from "next"
import { getSiteContent } from "@/lib/content"

export const metadata: Metadata = {
  title: "服務條款 | 誠真生活 RealReal",
  description: "誠真生活 RealReal 服務條款，請於使用本網站前詳閱。",
}

export default async function TermsPage() {
  const dbContent = await getSiteContent<{ content_html: string; updated_at?: string }>(
    "terms_of_service",
  )

  if (dbContent?.content_html) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2 text-center text-[#10305a]">服務條款</h1>
        {dbContent.updated_at && (
          <p className="text-[#687279] text-center mb-10">
            最後更新日期：{dbContent.updated_at}
          </p>
        )}
        <div
          className="space-y-10 text-[#687279] leading-relaxed [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-4 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-[#10305a] [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_section]:space-y-3 [&_a]:underline hover:[&_a]:text-[#10305a]"
          dangerouslySetInnerHTML={{ __html: dbContent.content_html }}
        />
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2 text-center text-[#10305a]">服務條款</h1>
      <p className="text-[#687279] text-center mb-10">
        最後更新日期：2025 年 1 月 1 日
      </p>

      <div className="space-y-10">
        <p className="text-[#687279] leading-relaxed">
          歡迎使用誠真生活 RealReal（以下簡稱「本公司」）所提供的網站及相關服務。當您使用本網站時，即表示您已閱讀、瞭解並同意接受以下服務條款。
        </p>

        {/* 服務範圍 */}
        <section>
          <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-[#10305a]">
            一、服務範圍
          </h2>
          <div className="space-y-3 text-[#687279] leading-relaxed">
            <p>本公司透過本網站提供以下服務：</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>純素保健食品之線上展示與銷售</li>
              <li>會員帳戶管理及訂閱制服務</li>
              <li>訂單處理、付款及配送服務</li>
              <li>產品諮詢及售後客服支援</li>
            </ul>
            <p>
              本公司保留隨時修改、暫停或終止全部或部分服務之權利，並將於網站公告。
            </p>
          </div>
        </section>

        {/* 會員帳號 */}
        <section>
          <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-[#10305a]">
            二、會員帳號
          </h2>
          <div className="space-y-3 text-[#687279] leading-relaxed">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                您在註冊帳號時應提供正確、完整且最新的個人資料，並有義務維護資料之正確性。
              </li>
              <li>
                帳號及密碼僅供您個人使用，不得轉讓或授權他人使用。您應妥善保管帳號密碼，因帳號遭盜用所產生之損害，本公司不負賠償責任。
              </li>
              <li>
                如發現帳號遭未經授權使用，請立即通知本公司客服處理。
              </li>
              <li>
                本公司有權於您違反本條款或法令規定時，暫停或終止您的帳號使用權。
              </li>
            </ul>
          </div>
        </section>

        {/* 商品訂購 */}
        <section>
          <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-[#10305a]">
            三、商品訂購
          </h2>
          <div className="space-y-3 text-[#687279] leading-relaxed">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                網站上所展示之商品資訊（包含價格、規格、圖片等）僅供參考，實際商品以出貨時為準。
              </li>
              <li>
                訂單成立後，本公司將以電子郵件通知您訂單確認。本公司保留因商品缺貨、價格標示錯誤或其他不可抗力因素取消訂單之權利。
              </li>
              <li>
                商品售價以下單當時網站顯示之價格為準，本公司有權隨時調整商品售價，調整前已成立之訂單不受影響。
              </li>
            </ul>
          </div>
        </section>

        {/* 付款方式 */}
        <section>
          <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-[#10305a]">
            四、付款方式
          </h2>
          <div className="space-y-3 text-[#687279] leading-relaxed">
            <p>本網站目前提供以下付款方式：</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>信用卡線上刷卡（Visa / Mastercard / JCB）</li>
              <li>LINE Pay 行動支付</li>
              <li>貨到付款（限宅配訂單）</li>
            </ul>
            <p>
              所有線上付款均透過第三方金流平台處理，本公司不會直接儲存您的信用卡資訊。
            </p>
          </div>
        </section>

        {/* 配送政策 */}
        <section>
          <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-[#10305a]">
            五、配送政策
          </h2>
          <div className="space-y-3 text-[#687279] leading-relaxed">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                配送範圍限台灣本島及離島地區（離島配送時間可能較長）。
              </li>
              <li>
                一般訂單於付款完成後 1–3 個工作日內出貨。
              </li>
              <li>
                單筆訂單滿 NT$800 免運費；未達免運門檻，宅配運費 NT$100，超商取貨運費 NT$60。
              </li>
              <li>
                如因不可抗力因素（天災、疫情等）導致配送延遲，本公司將盡速通知並協助處理。
              </li>
            </ul>
          </div>
        </section>

        {/* 退換貨政策 */}
        <section>
          <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-[#10305a]">
            六、退換貨政策
          </h2>
          <div className="space-y-3 text-[#687279] leading-relaxed">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                依據消費者保護法第 19 條規定，您享有收到商品後七日內無條件退貨之權利。
              </li>
              <li>
                退貨商品須保持全新狀態，未經拆封、使用，且包裝完整（含外盒、配件、贈品等）。
              </li>
              <li>
                食品類商品一經拆封即不接受退貨，但商品本身有瑕疵者不在此限。
              </li>
              <li>
                退款將於收到退貨商品並確認無誤後處理，退回原付款方式。
              </li>
            </ul>
          </div>
        </section>

        {/* 智慧財產權 */}
        <section>
          <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-[#10305a]">
            七、智慧財產權
          </h2>
          <div className="space-y-3 text-[#687279] leading-relaxed">
            <p>
              本網站所有內容，包括但不限於文字、圖片、商標、標誌、產品設計、網站版面配置等，均為本公司或其授權人所有，受中華民國著作權法及國際智慧財產權法律保護。
            </p>
            <p>
              未經本公司事前書面同意，不得以任何方式重製、散佈、改作、公開傳輸或為其他侵害智慧財產權之行為。
            </p>
          </div>
        </section>

        {/* 免責聲明 */}
        <section>
          <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-[#10305a]">
            八、免責聲明
          </h2>
          <div className="space-y-3 text-[#687279] leading-relaxed">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                本網站之商品資訊僅供一般參考，不構成醫療建議。如有健康疑慮，請諮詢專業醫療人員。
              </li>
              <li>
                本公司對於因不可抗力因素（包括但不限於天災、戰爭、政府行為、網路中斷等）所造成之服務中斷或延遲，不負賠償責任。
              </li>
              <li>
                本網站可能包含外部連結，該等連結網站之內容及隱私政策不在本公司管理範圍，使用者應自行評估風險。
              </li>
              <li>
                本條款之解釋與適用以中華民國法律為準據法。如有爭議，雙方同意以台灣台北地方法院為第一審管轄法院。
              </li>
            </ul>
          </div>
        </section>

        <div className="border-t pt-6 text-sm text-zinc-500">
          <p>
            如您對本服務條款有任何疑問，歡迎聯繫我們：
            <a
              href="mailto:love@realreal.cc"
              className="underline hover:text-[#10305a]"
            >
              love@realreal.cc
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
