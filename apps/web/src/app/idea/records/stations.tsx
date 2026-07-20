import type { ReactNode } from "react"

export type BadgeKey = "member" | "brand" | "founder" | "urgent"

export const BADGES: Record<BadgeKey, { emoji: string; label: string; bg: string; text: string }> = {
  member: { emoji: "🟢", label: "會員公益存款支持", bg: "bg-emerald-50", text: "text-emerald-800" },
  brand: { emoji: "🟡", label: "品牌自發公益行動", bg: "bg-amber-50", text: "text-amber-800" },
  founder: { emoji: "🔵", label: "創辦人／品牌共同支持", bg: "bg-sky-50", text: "text-sky-800" },
  urgent: { emoji: "🟠", label: "緊急公益行動", bg: "bg-orange-50", text: "text-orange-800" },
}

export function Badge({ badge }: { badge: BadgeKey }) {
  const b = BADGES[badge]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold ${b.bg} ${b.text}`}
    >
      {b.emoji} {b.label}
    </span>
  )
}

export type Station = {
  slug: string
  tabLabel: string
  title: string
  dateLabel: string
  badge: BadgeKey
  note?: string
  content: ReactNode
}

const proseP = "text-[#687279] leading-relaxed"
const quote = "border-l-4 border-[#10305a]/25 pl-5 italic"
const factItem = (label: string, value: string) => (
  <p className="text-sm">
    <strong className="text-[#10305a]">{label}</strong>
    <span className="text-[#687279]">｜{value}</span>
  </p>
)

export const STATIONS: Station[] = [
  {
    slug: "station-1",
    tabLabel: "第一站",
    title: "為腦麻兒築一個遮風避雨的家",
    dateLabel: "2024",
    badge: "member",
    content: (
      <>
        <img
          width={576}
          height={1024}
          src="https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/idea/1b03c54a36356fc1dfda299015074d6f.jpg"
          alt=""
          className="mx-auto rounded-[10px] mb-8"
        />

        <div className={`space-y-5 ${proseP} mb-10`}>
          <p>屏東市私立磐石社會福利事業基金會</p>
          <p className="font-medium text-[#10305a]">【為腦麻兒築一個遮風避雨的家】</p>
          <p>這個名字，你或許沒聽過。</p>
          <p>正因如此，我選擇了它。</p>
          <p>因為真正需要幫助的人，常常在角落被忽略，而我們想做的，正是雪中送炭的事。</p>
          <p>他們的資料被放在公益文宣架的最底層，封面蒙著一層灰。紙張上，是腦麻兒父母的臉龐，寫滿擔憂：</p>
          <blockquote className={quote}>「我們會老，我們不在了，孩子怎麼辦？」</blockquote>
          <p>於是，幾個家庭夢想著，為孩子籌建一個能安居的家園。</p>
        </div>

        <h3 className="text-xl font-bold text-[#10305a] mb-4">「好想幫他們啊，但我能做什麼呢？」</h3>
        <div className={`space-y-5 ${proseP} mb-10`}>
          <p>2023年5月，這個念頭在心裡落下。</p>
          <p>隔年3月，我在社群上分享身心滋養的知識，慢慢被更多人看見。到了8月，我捐出收益，支持腦麻兒蓋起這個遮風避雨的家。</p>
          <p>有人問：</p>
          <blockquote className={quote}>「為什麼花心力分享，還把收益全數捐出去？」</blockquote>
          <p>因為我相信——</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>每個人、每個生命，都值得被善待；</li>
            <li>而只要願意，我們都能多付出一點點，成為自己與他人生命中的溫柔光亮。</li>
          </ul>
          <p>利他，不是遙遠的理想，而是日常裡可以養成的習慣。</p>
        </div>

        <img
          width={610}
          height={1024}
          src="https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/idea/7b5a736b3e787985b7993e0e263c4775.jpg"
          alt=""
          className="mx-auto rounded-[10px] mb-10"
        />

        <h3 className="text-xl font-bold text-[#10305a] mb-4">如果你不知道從哪裡開始，就從這裡開始吧</h3>
        <div className={`space-y-5 ${proseP}`}>
          <p>
            每一次消費，我們都會替你將 <strong className="text-[#10305a]">2-3% 的金額存入「公益存款」</strong>，
          </p>
          <p>你可以在會員帳戶中，隨時看見自己累積的善意足跡。</p>
          <p>願我們一起，建立一種充滿信任與善意的生活方式——</p>
          <p>溫柔而堅定。</p>
          <p>讓善意流動，讓希望成真。</p>
          <p>每一次支持，都是愛的延續。</p>
        </div>
      </>
    ),
  },
  {
    slug: "station-2",
    tabLabel: "第二站",
    title: "把夏日的水果，送給花蓮的孩子",
    dateLabel: "2026.06.15",
    badge: "brand",
    note: "本次行動由誠真生活自發投入，未使用會員公益存款。",
    content: (
      <>
        <div className={`space-y-5 ${proseP} mb-10`}>
          <p>我們將凍乾水果捐贈至：</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>基督教門諾會花蓮善牧中心</li>
            <li>花蓮縣私立原住民少年兒童之家</li>
          </ul>
          <p>這個夏天，我們挑選了草莓、水蜜桃與哈密瓜三種口味，希望把一份簡單的水果滋味，送到花蓮後山的孩子手中，也與他們一起慶祝誠真生活正式上線。</p>
        </div>

        <h3 className="text-xl font-bold text-[#10305a] mb-4">你可能不知道，誠真生活是從一顆水果開始的</h3>
        <div className={`space-y-5 ${proseP} mb-10`}>
          <p>很多人好奇：</p>
          <blockquote className={quote}>「為什麼誠真生活會賣凍乾水果？這和植物蛋白有什麼關係？」</blockquote>
          <p>其實，凍乾水果才是誠真生活最初的起點。</p>
          <p>在創業以前，我曾經在街頭工作，販售凍乾水果。</p>
          <p>那段日子裡，我看過無數孩子吃到凍乾水果時，臉上藏不住的喜悅；也聽過許多爸爸媽媽、爺爺奶奶，一次次詢問成分、口感，只為了替孩子找到一份「好吃、單純，也能放心分享」的零食。</p>
          <p>那時候我慢慢發現：</p>
          <p>如果有一種食物，能代表單純的快樂與愛，凍乾水果或許就是其中之一。</p>
          <p>它不分年齡。</p>
          <p>小朋友喜歡，大人也能享受。</p>
          <p>而這份「全年齡友善」的初心，也延伸到了後來的植物蛋白。</p>
          <p>我們希望做的，不只是某一個年齡層或某一種生活方式的產品，而是讓更多人都能找到適合自己的選擇。</p>
        </div>

        <h3 className="text-xl font-bold text-[#10305a] mb-4">這個夏天，把喜歡的水果分享出去</h3>
        <div className={`space-y-5 ${proseP} mb-10`}>
          <p>因此，在誠真生活正式上線的這個夏天，我們想做的第一件事之一，就是把自己喜歡的東西分享出去。</p>
          <p>這一次，我們選擇了草莓、水蜜桃、蘋果與哈密瓜，送到花蓮善牧中心與原住民少年兒童之家。</p>
          <p>或許只是一份小小的水果零食，</p>
          <p>但我們希望孩子們收到時，也能像我們曾經看過的那些孩子一樣，露出單純而快樂的笑容。</p>
          <p>
            因為誠真生活相信，<br />有些美好，不需要太複雜。<br />一顆水果、一份分享、一個笑容，<br />就能讓平凡的一天，多一點甜。
          </p>
        </div>

        <div className="rounded-xl bg-[#f9f8f5] px-7 py-6 space-y-2 text-left">
          <h3 className="text-lg font-bold text-[#10305a] mb-2">這次的善意行動</h3>
          {factItem("行動日期", "2026.06.15")}
          {factItem("捐贈物資", "凍乾草莓、凍乾水蜜桃、凍乾哈密瓜")}
          {factItem("捐贈單位", "基督教門諾會花蓮善牧中心、花蓮縣私立原住民少年兒童之家")}
          {factItem("行動性質", "誠真生活品牌自發公益行動")}
          {factItem("公益存款", "本次未使用會員公益存款")}
        </div>
      </>
    ),
  },
]
