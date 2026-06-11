import type { Metadata } from "next"
import { getSiteContent } from "@/lib/content"

export const metadata: Metadata = {
  title: "品牌故事 | 誠真生活 RealReal",
  description:
    "誠真生活是台灣在地的純素保健食品品牌，堅持以純淨原料與科學配方，為您帶來誠真健康。",
}

type AboutContent = {
  content_html?: string
}

const wpContent = `
<p style="font-size:1.1rem;font-weight:600;color:#10305a;margin-bottom:2rem;">誠真生活，不是因為想創業而誕生</p>

<p>在創立誠真生活之前，我從事的是海事保賠協會（Protection &amp; Indemnity Clubs）相關工作。</p>
<p>當時的我從未想過要創業，更沒有打算成立自己的品牌。</p>

<p>一次因緣際會下，我認識了一位食品大廠的老闆。原本只是希望與他合作團購產品，沒想到在交流過程中，他分享了一個埋藏多年的想法。</p>
<p>他一直希望能開發真正有益健康的產品，但現實市場卻讓他感到兩難。</p>
<p>許多熱銷產品追求的是好吃、口感佳，卻未必符合健康需求；而另一類產品則強調高 CP 值，往往難以兼顧原料品質與營養價值。</p>
<p>他認為自己始終找不到足夠的市場，因此遲遲無法實現這個理想。</p>

<p>後來，他反而問我：</p>
<blockquote>「如果真的相信健康應該有更好的選擇，為什麼不做自己的品牌？」</blockquote>
<p>這句話，成了誠真生活的起點。</p>

<p>我是素食者，也長期關注健康與身心平衡。</p>
<p>在尋找營養補充品的過程中，我發現許多產品成分複雜、添加物偏多，與自己期待的方向並不一致。</p>

<p>我開始思考：</p>
<p>如果市場上缺少自己真正願意長期使用的產品，那麼是否有機會親手把它做出來？</p>

<p>於是，我們決定先做產品，再決定是否創業。</p>
<p>從原料選擇、配方設計到反覆試喝與調整，每一步都回到最初的問題：</p>
<blockquote>這是不是一款我們願意每天食用，也願意推薦給家人朋友的產品？</blockquote>
<p>當答案終於是肯定的，誠真生活才正式誕生。</p>

<hr style="margin:2.5rem 0;border-color:#e5e0d8;" />

<p>我們相信，健康不該建立在複雜與妥協之上。</p>
<p>而是從日常的每一次選擇開始。</p>

<p style="margin-top:1.5rem;">選擇更單純的成分。</p>
<p>選擇更真實的原料。</p>
<p>選擇更誠實地對待自己的身體。</p>

<p style="margin-top:1.5rem;">這也是「誠真生活」名字所代表的精神。</p>
<p>願我們在照顧身體的同時，也能活得自在、真誠而純粹。</p>

<p style="margin-top:2.5rem;font-size:0.9rem;color:#a09080;">創辦人 尹昕</p>
`

export default async function AboutPage() {
  const content = await getSiteContent<AboutContent>("about_page")
  const hasCustomContent = content?.content_html && content.content_html.trim().length > 0

  const htmlContent = hasCustomContent ? content!.content_html! : wpContent

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8 text-[#10305a] text-center">品牌故事</h1>
      <div
        className="prose prose-zinc max-w-none
          prose-headings:text-[#10305a] prose-headings:font-bold
          prose-p:text-[#687279] prose-p:leading-relaxed
          prose-a:text-[#10305a] prose-a:underline
          prose-img:rounded-[10px] prose-img:mx-auto
          prose-li:text-[#687279]
          prose-blockquote:border-[#10305a]/30 prose-blockquote:text-[#687279]
          prose-strong:text-[#10305a]
          prose-b:text-[#10305a]
          prose-i:text-[#687279]"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  )
}
