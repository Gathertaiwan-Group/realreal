import type { Metadata } from "next"
import { getSiteContent } from "@/lib/content"

export const metadata: Metadata = {
  title: "常見問題 | 誠真生活 RealReal",
  description: "關於誠真生活的訂購流程、配送方式、退換貨政策、訂閱制度等常見問題。",
}

type FaqItem = { q: string; a: string }

type FaqSection = {
  title: string
  items: FaqItem[]
}

const hardcodedSections: FaqSection[] = [
  {
    title: "植物蛋白常見問題",
    items: [
      {
        q: "植物蛋白會造成腎臟負擔嗎？",
        a: "任何蛋白質都需要腎臟參與代謝，但植物蛋白在人體內產生的酸負荷較低，也少了過多雜質與身體不需的負擔，是長期補充蛋白質較安全的選擇。",
      },
      {
        q: "一般人每天需要多少蛋白質？",
        a: "多數人每日約需要「體重 x 1.2 – 1.6 公克」的蛋白質，以維持身體機能的運作與修復。一顆雞蛋約含有 7 公克蛋白質，誠真植物蛋白粉一包約含有 21–24 公克蛋白質，大約是 3 顆雞蛋的分量。建議早上喝一杯，啟動一整天的力量。",
      },
      {
        q: "腎臟不好的人可以喝植物蛋白嗎？",
        a: "植物蛋白較動物蛋白溫和，有研究指出攝取黃豆可以有效降低相關指標。不過，腎臟病人會因為疾病進程的不同，在不同階段有不同的蛋白質建議攝取量，因此仍建議有腎臟病疑慮者先諮詢醫生建議。",
      },
      {
        q: "喝蛋白粉時要注意什麼？",
        a: "水分充足（每天至少體重 x 40 ml 的水）；份量剛好（一天一杯為基本，活動量大再增加）；攪拌均勻（用攪拌杯或手動攪拌）；最佳時機為運動後 30–60 分鐘或上午 8–12 點；蛋白粉只是配角，營養均衡加原型食物才是最適合身體的中道。",
      },
      {
        q: "誠真的植物高蛋白有什麼不同？",
        a: "含大豆蛋白、豌豆蛋白、米蛋白、小麥纖維等完整多元植物胺基酸；無額外添加糖、無色素、無香料、無防腐劑；水果口味每一口都吃得到營養香甜的凍乾水果；隨身包一份 50 公克重；不含奶或任何動物成分。",
      },
    ],
  },
  {
    title: "沖泡方式",
    items: [
      {
        q: "如何沖泡最好喝？溫度對蛋白粉有影響嗎？",
        a: "植物蛋白較動物蛋白耐高溫，但仍建議使用溫水（25–60°C）。倒入水或植物奶 300–450 毫升，再加入一份高蛋白 50 公克，用電動攪拌杯攪拌 15 秒或搖搖杯搖勻即可。水果口味不建議使用有彈簧球的搖搖杯，避免果粒卡在彈簧球上。",
      },
      {
        q: "冷水也可以沖泡嗎？",
        a: "可以，但溶解度會變慢。冷水會讓粉末比較慢散開，若想喝冰涼版本，建議先用少量常溫水搖勻，再加冰塊或冷水調整。",
      },
      {
        q: "用什麼液體沖泡最好喝？",
        a: "植物奶是提升風味的好選擇。豆奶口感濃郁、飽足感強；燕麥奶像水果奶昔，口感療癒；杏仁奶清爽輕盈、不膩口。",
      },
    ],
  },
  {
    title: "付款與發票",
    items: [
      {
        q: "可以使用哪些付款方式？",
        a: "目前支援信用卡付款。",
      },
      {
        q: "發票如何開立？",
        a: "訂單成立後即開立電子發票，發票可開立統一編號，電子發票將寄送至您的電子信箱。",
      },
    ],
  },
  {
    title: "配送方式",
    items: [
      {
        q: "有哪些配送方式？",
        a: "提供宅配到府、7-11 超商取貨及全家超商取貨。海外運送採運費到付。如貨物尺寸超過超商取貨限制，將通知您改採用宅配。",
      },
      {
        q: "運費如何計算？",
        a: "宅配運費 NT$150，超商取貨運費 NT$65。消費滿 NT$499 超商取貨免運，消費滿 NT$999 宅配免運。",
      },
      {
        q: "配送需要多久？",
        a: "付款完成即成立訂單，2–5 個工作天出貨（不含例假日），到貨時間依物流公司為準。預購商品以商品頁說明為準。",
      },
    ],
  },
  {
    title: "退換貨政策",
    items: [
      {
        q: "收到商品後可以退貨嗎？",
        a: "依照消費者保護法，您享有收到商品後 7 天的鑑賞期（非試用期）。但食品一經拆封，恕不退換。",
      },
      {
        q: "收到破損或寄錯商品怎麼辦？",
        // TODO: read from app_settings.contact.email
        a: "請於收到商品後 48 小時內聯繫客服處理。可透過官方 LINE 或客服信箱 love@realreal.cc 聯繫我們。",
      },
    ],
  },
  {
    title: "商品說明",
    items: [
      {
        q: "產品真的是純素的嗎？",
        a: "是的。我們所有產品皆為 100% 植物性配方，無動物性製品，亦不經動物實驗。以天然成分、最少量添加物為本。",
      },
      {
        q: "凍乾水果的外觀會有差異嗎？",
        a: "凍乾水果因批次不同，外觀與口感略有差異，屬正常現象。",
      },
      {
        q: "產品為醫療產品嗎？",
        a: "產品為營養補充用途，非醫療產品。特殊體質、孕期或治療中者，請先諮詢專業人士。",
      },
    ],
  },
  {
    title: "包裝與永續",
    items: [
      {
        q: "包裝方式是什麼？",
        a: "以簡化包裝、減少一次性包材為原則。出貨紙箱為原色 AB 楞厚紙箱，可能會使用乾淨之回收包材。食品夾鏈袋可重複使用，兼顧保存與永續。",
      },
      {
        q: "什麼是永續獎勵？",
        a: "夾鏈袋與紙箱歡迎重複利用，拍照分享至社群媒體即可獲得永續獎勵金，讓包裝延續價值。",
      },
    ],
  },
]

export default async function FaqPage() {
  // Try fetching dynamic FAQ items from the API
  const dynamicItems = await getSiteContent<FaqSection[]>("faq_items")
  const sections =
    Array.isArray(dynamicItems) && dynamicItems.length > 0
      ? dynamicItems
      : hardcodedSections

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2 text-center text-[#10305a]">常見問題</h1>
      <p className="text-[#687279] text-center mb-10">
        找不到答案？歡迎透過聯絡頁面與我們聯繫
      </p>

      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-semibold mb-4 border-b pb-2 text-[#10305a]">
              {section.title}
            </h2>
            <div className="space-y-2">
              {section.items.map((item) => (
                <details
                  key={item.q}
                  className="group border rounded-lg bg-[#fffeee]"
                >
                  <summary className="flex cursor-pointer items-center justify-between px-4 py-3 font-medium text-sm text-[#10305a] hover:bg-[#fffeee]/80 transition-colors">
                    <span>{item.q}</span>
                    <span className="ml-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-[#687279] leading-relaxed">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
