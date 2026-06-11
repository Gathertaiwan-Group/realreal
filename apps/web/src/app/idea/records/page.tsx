import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "善意行動紀錄 | 誠真生活 RealReal",
  description:
    "誠真生活公益行動紀錄，記錄每一次善意的流動。支持腦麻兒庇護家園興建，讓善意成為日常。",
}

const contentHtml = `
<img width="576" height="1024" src="https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-576x1024.jpg" alt="" srcset="https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-576x1024.jpg 576w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-169x300.jpg 169w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-768x1366.jpg 768w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-750x1334.jpg 750w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885-600x1068.jpg 600w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0885.jpg 788w" sizes="(max-width: 576px) 100vw, 576px" />

<h2>第一站：飛揚天使莊園工程款</h2>

<p>屏東市私立磐石社會福利事業基金會</p>
<p>【為腦麻兒築一個遮風避雨的家】</p>
<p><b>First Stop: Flying Angels Home Project</b></p>
<p>Pingtung Rock Foundation for Social Welfare</p>
<p><b>[Building a safe haven for children with cerebral palsy]</b></p>
<p>這個名字，你或許沒聽過。</p>
<p>正因如此，我選擇了它。</p>
<p>因為真正需要幫助的人，常常在角落被忽略，而我們想做的，正是雪中送炭的事。</p>
<p>他們的資料被放在公益文宣架的最底層，封面蒙著一層灰。紙張上，是腦麻兒父母的臉龐，寫滿擔憂：</p>
<p>「我們會老，我們不在了，孩子怎麼辦？」</p>
<p>於是，幾個家庭夢想著，為孩子籌建一個能安居的家園。</p>
<p>You may not have heard of this name.</p>
<p>That is exactly why I chose it.</p>
<p>Because those who need help the most are often overlooked in the corners of society—</p>
<p>and what we wish to do, is to bring warmth in the coldest times.</p>
<p>Their brochures lie at the very bottom of the charity stand, covered in dust.</p>
<p>On the faded paper are the faces of parents of children with cerebral palsy, filled with worry:</p>
<p><i>"We will grow old. One day we will be gone. Who will care for our children then?"</i></p>
<p>And so, a few families dreamed of building a home where their children could feel safe and secure.</p>

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
<p><b>"I really want to help them... but what can I do?"</b></p>
<p>This thought took root in May 2023.</p>
<p>By March the following year, I began sharing knowledge about wellness on social media, gradually reaching more people. By August, I donated all the earning to support the construction of this shelter for children with cerebral palsy.</p>
<p>When asked, <i>"Why dedicate so much time and even give away all the earning?"</i></p>
<p>I answered with what I believe:</p>
<ul>
<li>Every person, every life, deserves kindness.</li>
<li>If we are willing, each of us can give a little more—becoming a gentle light in our own lives and in the lives of others.</li>
</ul>
<p>Altruism is not a lofty ideal.</p>
<p>It is a habit we can nurture, day by day.</p>

<img width="610" height="1024" src="https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-610x1024.jpg" alt="" srcset="https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-610x1024.jpg 610w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-179x300.jpg 179w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-768x1289.jpg 768w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-750x1259.jpg 750w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881-600x1007.jpg 600w, https://realreal.cc/wp-content/uploads/2025/09/IMG_0881.jpg 803w" sizes="(max-width: 610px) 100vw, 610px" />

<h2>如果你不知道從哪裡開始，就從這裡開始吧</h2>

<p>每一次消費，我們都會替你將 <strong>2.3-3.3% 的金額存入「公益存款」</strong>，</p>
<p>你可以在會員帳戶中，隨時看見自己累積的善意足跡。</p>
<p>願我們一起，建立一種充滿信任與善意的生活方式——</p>
<p>溫柔而堅定。</p>
<p>讓善意流動，讓希望成真。</p>
<p>每一次支持，都是愛的延續。</p>

<div class="flex gap-4 flex-wrap mt-4">
  <a href="/subscribe" class="inline-block px-6 py-2 bg-[#10305a] text-white rounded-lg no-underline hover:opacity-90">了解會員制度</a>
  <a href="/shop" class="inline-block px-6 py-2 bg-[#10305a] text-white rounded-lg no-underline hover:opacity-90">了解產品</a>
</div>
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
