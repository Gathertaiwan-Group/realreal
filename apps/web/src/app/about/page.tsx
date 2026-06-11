import type { Metadata } from "next"
import Image from "next/image"
import { getSiteContent } from "@/lib/content"

export const metadata: Metadata = {
  title: "品牌故事 | 誠真生活 RealReal",
  description:
    "誠真生活是台灣在地的純素保健食品品牌，堅持以純淨原料與科學配方，為您帶來誠真健康。",
}

type AboutContent = {
  content_html?: string
}

const promises = [
  "合作工廠通過 HACCP 與 ISO22000 品質認證",
  "產品經第三方檢驗機構把關",
  "商品投保產品責任險",
  "持續分享實用、易懂的健康知識",
]

export default async function AboutPage() {
  const content = await getSiteContent<AboutContent>("about_page")
  const hasCustomContent = content?.content_html && content.content_html.trim().length > 0

  if (hasCustomContent) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <div
          className="prose prose-zinc max-w-none
            prose-headings:text-[#10305a] prose-headings:font-bold
            prose-p:text-[#687279] prose-p:leading-relaxed
            prose-a:text-[#10305a] prose-a:underline
            prose-img:rounded-[10px] prose-img:mx-auto
            prose-li:text-[#687279]
            prose-blockquote:border-[#10305a]/30 prose-blockquote:text-[#687279]
            prose-strong:text-[#10305a]"
          dangerouslySetInnerHTML={{ __html: content!.content_html! }}
        />
      </div>
    )
  }

  return (
    <div className="bg-white">

      {/* ── 品牌故事 ── */}
      <section className="container mx-auto px-4 pt-16 pb-12 max-w-3xl">

        {/* Section heading */}
        <h2 className="text-2xl font-bold text-[#10305a] text-center mb-10">
          品牌故事 <span className="font-normal text-[#a09080]">Our Story</span>
        </h2>

        {/* Founder photo + tagline */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative w-52 sm:w-64 rounded-2xl overflow-hidden shadow-md mb-4">
            <Image
              src="https://realreal.cc/wp-content/uploads/2025/09/reallightjpeg-865x1024.webp"
              alt="誠真生活創辦人"
              width={865}
              height={1024}
              className="w-full h-auto object-cover"
              priority
            />
          </div>
          <p className="text-sm text-[#a09080] italic text-center">
            活得像個孩子，樂善好施，自在純真
          </p>
        </div>

        {/* H4 subheading */}
        <h4 className="text-base font-semibold text-[#10305a] mb-5">
          誠真生活，不是因為想創業而誕生
        </h4>

        {/* Story — part 1 */}
        <div className="space-y-4 text-[#687279] leading-relaxed">
          <p>在創立誠真生活之前，我從事法律與海事相關工作，從未想過有一天會投入食品產業。</p>
          <p>一次因緣際會下，我認識了一位食品業前輩。原本只是希望與他合作團購，沒想到在交流過程中，我們發現彼此都有共通點：</p>
          <p className="font-medium text-[#10305a]">希望市場上能有更多成分單純、真正以養生為出發點的產品。</p>
          <p>後來，他看了我分享滋養身心資訊的 Instagram，問我：</p>
          <blockquote className="border-l-4 border-[#10305a]/30 pl-4 italic text-[#687279]">
            「如果你希望大家都能活得更健康自在，為什麼不做自己的品牌？」
          </blockquote>
          <p>這句話，成了誠真生活的起點。</p>
        </div>

        <hr className="my-8 border-zinc-200" />

        {/* Story — part 2 */}
        <div className="space-y-4 text-[#687279] leading-relaxed">
          <p>我是素食者，也長期關注健康與身心平衡。喜歡瑜珈、戶外活動，也一直認為自己算是健康的人。</p>
          <p>直到一次受傷後，我才意識到，即使飲食看似均衡，蛋白質仍可能攝取不足。</p>
          <p>當我開始尋找適合自己的營養補充品時，卻發現許多產品成分複雜、添加物偏多，與自己期待的方向並不一致。</p>
          <p>於是，我們決定先做產品，再決定是否創業。如果要做，就做一款自己願意每天食用，也願意推薦給家人朋友的產品。產品先誕生，而品牌是後來才出現的。</p>
        </div>

        <hr className="my-8 border-zinc-200" />

        {/* Story — part 3: philosophy */}
        <div className="space-y-3 text-[#687279] leading-relaxed">
          <p>我們相信，生活不該建立在複雜與妥協之上。而是從日常的每一次選擇開始。</p>
          <p>選擇更單純的成分。</p>
          <p>選擇更真實的原料。</p>
          <p>選擇更誠實地對待自己的身體。</p>
          <p>這也是「誠真生活」名字所代表的精神。</p>
          <p className="font-medium text-[#10305a]">以更誠實的方式照顧自己，以更真誠的態度面對生活。</p>
        </div>

        <hr className="my-8 border-zinc-200" />

        <p className="text-sm text-[#a09080]">創辦人 尹昕</p>
      </section>

      {/* ── 品牌願景 ── */}
      <section className="border-t border-zinc-100 py-16">
        <div className="container mx-auto px-4 max-w-3xl">

          <h2 className="text-2xl font-bold text-[#10305a] text-center mb-2">
            品牌願景 <span className="font-normal text-[#a09080]">Our Vision</span>
          </h2>

          <h4 className="text-base font-semibold text-[#10305a] text-center mb-8">
            願更多人在照顧自己的同時，也有餘裕照亮他人。
          </h4>

          <p className="text-[#687279] leading-relaxed text-center mb-10">
            我們相信，健康不只是身體的狀態，更是一種生活方式。<br />
            當一個人擁有更好的身心狀態，也更有能力關心家人、支持朋友，甚至幫助需要幫助的人。<br />
            誠真生活希望透過產品、知識與行動，讓照顧自己與照顧世界，成為可以同時存在的選擇。
          </p>

          <div className="relative rounded-2xl overflow-hidden shadow-sm">
            <Image
              src="https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-1024x683.webp"
              alt="品牌願景"
              width={1024}
              height={683}
              className="w-full h-auto object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── 品牌承諾 ── */}
      <section className="border-t border-zinc-100 py-16">
        <div className="container mx-auto px-4 max-w-3xl">

          <h2 className="text-2xl font-bold text-[#10305a] text-center mb-10">
            品牌承諾 <span className="font-normal text-[#a09080]">Our Promises</span>
          </h2>

          <ul className="space-y-4">
            {promises.map((item) => (
              <li key={item} className="flex items-center justify-center gap-3">
                <span className="text-[#10305a] font-bold text-lg leading-none">✓</span>
                <span className="text-[#687279]">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

    </div>
  )
}
