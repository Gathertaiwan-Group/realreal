import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "善意行動紀錄 | 誠真生活 RealReal",
  description:
    "誠真生活公益行動紀錄，記錄每一次善意的流動。支持腦麻兒庇護家園興建，讓善意成為日常。",
}

const contentHtml = `
<img width="576" height="1024" src="https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-576x1024.jpg" alt="" srcset="https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-576x1024.jpg 576w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-169x300.jpg 169w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-768x1366.jpg 768w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-750x1334.jpg 750w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-600x1068.jpg 600w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885.jpg 788w" sizes="(max-width: 576px) 100vw, 576px" />

<h2>第一站｜為腦麻兒築一個遮風避雨的家</h2>
<p style="color:#a09080;margin-top:-0.5rem;margin-bottom:1.5rem;">2024</p>

<p>屏東市私立磐石社會福利事業基金會</p>
<p>【為腦麻兒築一個遮風避雨的家】</p>

<p>這個名字，你或許沒聽過。</p>
<p>正因如此，我選擇了它。</p>
<p>因為真正需要幫助的人，常常在角落被忽略，而我們想做的，正是雪中送炭的事。</p>
<p>他們的資料被放在公益文宣架的最底層，封面蒙著一層灰。紙張上，是腦麻兒父母的臉龐，寫滿擔憂：</p>
<p>「我們會老，我們不在了，孩子怎麼辦？」</p>
<p>於是，幾個家庭夢想著，為孩子籌建一個能安居的家園。</p>

<h2>「好想幫他們啊，但我能做什麼呢？」</h2>

<p>2023年5月，這個念頭在心裡落下。</p>
<p>隔年3月，我在社群上分享身心滋養的知識，慢慢被更多人看見。到了8月，我捐出收益，支持腦麻兒蓋起這個遮風避雨的家。</p>
<p>有人問：</p>
<p>「為什麼花心力分享，還把收益全數捐出去？」</p>
<p>因為我相信——</p>
<ul>
<li>每個人、每個生命，都值得被善待；</li>
<li>而只要願意，我們都能多付出一點點，成為自己與他人生命中的溫柔光亮。</li>
</ul>
<p>利他，不是遙遠的理想，而是日常裡可以養成的習慣。</p>

<img width="610" height="1024" src="https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-610x1024.jpg" alt="" srcset="https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-610x1024.jpg 610w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-179x300.jpg 179w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-768x1289.jpg 768w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-750x1259.jpg 750w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-600x1007.jpg 600w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881.jpg 803w" sizes="(max-width: 610px) 100vw, 610px" />

<h2>如果你不知道從哪裡開始，就從這裡開始吧</h2>

<p>每一次消費，我們都會替你將 <strong>2-3% 的金額存入「公益存款」</strong>，</p>
<p>你可以在會員帳戶中，隨時看見自己累積的善意足跡。</p>
<p>願我們一起，建立一種充滿信任與善意的生活方式——</p>
<p>溫柔而堅定。</p>
<p>讓善意流動，讓希望成真。</p>
<p>每一次支持，都是愛的延續。</p>
`

export default function RecordsPage() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8 text-center text-[#10305a]">
        善意行動紀錄
      </h1>
      <div
        className="prose prose-zinc max-w-none
          prose-headings:text-[#10305a] prose-headings:font-bold
          prose-p:text-[#687279] prose-p:leading-relaxed
          prose-a:text-[#10305a] prose-a:underline
          prose-img:rounded-[10px] prose-img:mx-auto
          prose-li:text-[#687279]
          prose-blockquote:border-[#10305a]/30 prose-blockquote:text-[#687279]
          prose-strong:text-[#10305a]"
        style={{ textAlign: "center" }}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
    </div>
  )
}
