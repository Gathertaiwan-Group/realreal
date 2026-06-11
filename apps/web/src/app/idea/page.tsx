import type { Metadata } from "next"
import { getSiteContent } from "@/lib/content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "公益存款是什麼？| 誠真生活 RealReal",
  description:
    "善意，不必等到富有才開始。每一次消費，都留下看得見的善意足跡。了解誠真生活的公益存款計畫。",
}

type IdeaContent = { content_html?: string }

export default async function IdeaPage() {
  const content = await getSiteContent<IdeaContent>("idea_page")
  if (content?.content_html?.trim()) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div
          className="prose prose-zinc max-w-none
            prose-headings:text-[#10305a] prose-headings:font-bold
            prose-p:text-[#687279] prose-p:leading-relaxed
            prose-blockquote:border-[#10305a]/30 prose-blockquote:text-[#687279]
            prose-strong:text-[#10305a]"
          dangerouslySetInnerHTML={{ __html: content.content_html! }}
        />
      </div>
    )
  }

  return (
    <div className="bg-white">
      <article className="container mx-auto px-4 py-16 max-w-2xl">

        {/* ── 主標題 ── */}
        <header className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-[#10305a] mb-3">
            善意，不必等到富有才開始。
          </h1>
          <p className="text-[#a09080]">每一次消費，都留下看得見的善意足跡。</p>
        </header>

        {/* ── 開場：等待的循環 ── */}
        <section className="space-y-5 text-[#687279] leading-relaxed mb-10">
          <p>很多人認為，要等到自己更有能力、更有時間、更有資源之後，才有資格幫助別人。</p>
          <p>但我發現，真正阻礙善意流動的，往往不是能力不足，而是我們習慣等待。</p>
          <div className="pl-5 space-y-1 border-l-2 border-zinc-200">
            <p>等待別人先做。</p>
            <p>等待企業先做。</p>
            <p>等待有一天條件更好再做。</p>
          </div>
          <p>於是，善意總是停留在想法裡。</p>
        </section>

        <hr className="border-zinc-200 mb-10" />

        {/* ── Section 1 ── */}
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[#10305a] mb-6">
            公益存款，就是一場小小的實驗
          </h2>
          <div className="space-y-5 text-[#687279] leading-relaxed">
            <p>我一直在想：</p>
            <blockquote className="border-l-4 border-[#10305a]/25 pl-5 space-y-2 italic">
              <p>如果行善不必等到未來，而是能成為日常的一部分，會發生什麼事？</p>
              <p>如果每個人都願意多付出一點點，這些微小的力量又能匯聚成什麼模樣？</p>
            </blockquote>
            <p>因此，我們設計了「公益存款」。</p>
            <p>
              每一次消費，誠真生活都會提撥 <strong className="text-[#10305a]">2%～3%</strong> 的金額存入你的公益存款帳戶。
              你可以選擇將它折抵未來消費，也可以讓這份善意持續累積，支持未來的公益行動。
            </p>

            <div className="pt-2 space-y-3">
              <p>許多企業都在做公益。</p>
              <p>但對大多數消費者而言，公益往往停留在品牌端。</p>
              <p>看得到成果，卻感受不到自己的參與。</p>
            </div>

            <p>於是我開始思考：</p>
            <blockquote className="border-l-4 border-[#10305a]/25 pl-5 space-y-2 italic">
              <p>如果每一次消費所累積的善意，都能被看見，會不會不一樣？</p>
              <p>如果人們知道——「原來我也是這件事的一部分。」</p>
              <p>會不會更願意持續參與？</p>
            </blockquote>

            <div className="pt-2 space-y-2">
              <p>公益存款想做的，其實很簡單。</p>
              <p>只是讓善意被看見。</p>
              <p className="font-medium text-[#10305a]">讓每一次選擇，都留下看得見的善意足跡。</p>
            </div>
          </div>
        </section>

        <hr className="border-zinc-200 mb-10" />

        {/* ── Section 2 ── */}
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[#10305a] mb-6">
            為什麼我想做這件事？
          </h2>
          <div className="space-y-5 text-[#687279] leading-relaxed">
            <p>這個想法，其實來自我一路以來收到的善意。</p>
            <p>從小看著父親與免疫疾病和癌症共存，他依然樂觀，總提醒我：</p>
            <blockquote className="border-l-4 border-[#10305a]/25 pl-5 italic">
              「世界上還有許多比我們更需要幫助的人。」
            </blockquote>
            <p>
              求學期間，我幸運地獲得獎學金完成學業，因此始終相信，人生中收到的善意，
              有一天也應該回到社會之中。
            </p>
            <p>後來，我開始經營分享滋養身心資訊的社群媒體，並將團購收益全數捐出。</p>
            <p>創立誠真生活之後，我希望保留這份初衷。</p>
            <p>不只是販售產品，也持續創造讓善意流動的機會。</p>
          </div>
        </section>

        <hr className="border-zinc-200 mb-10" />

        {/* ── Section 3 ── */}
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[#10305a] mb-6">
            符合人性，也相信人性
          </h2>
          <div className="space-y-5 text-[#687279] leading-relaxed">
            <p>我知道，不是每個人都能在每個階段把公益放在優先順位。</p>
            <p>所以公益存款可以折抵消費。</p>
            <p>這不是妥協，而是一種符合人性的設計。</p>
            <p>因為我相信：</p>
            <blockquote className="border-l-4 border-[#10305a]/25 pl-5 space-y-2">
              <p>當一件事情更容易開始，就會有更多人願意參與。</p>
              <p>而當越來越多人加入，善意就有機會流向更遠的地方。</p>
            </blockquote>
          </div>
        </section>

        <hr className="border-zinc-200 mb-10" />

        {/* ── Section 4 ── */}
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[#10305a] mb-6">
            願我們一起，把善意變成習慣
          </h2>
          <div className="space-y-5 text-[#687279] leading-relaxed">
            <p>過去，我曾以社群收益支持腦麻兒庇護家園的興建。</p>
            <p>
              未來，如果發生重大災害、急難救助需求，或有值得支持的弱勢團體與公益計畫，
              誠真生活也希望能夠成為其中的一份力量。
            </p>
            <p>我不知道這場實驗最後會走到哪裡。</p>
            <p>但我相信：</p>
            <blockquote className="border-l-4 border-[#10305a]/25 pl-5">
              <p>
                每一次選擇、每一次支持、每一次願意多付出一點點，<br />
                都能讓世界變得更好一些。
              </p>
            </blockquote>
          </div>
        </section>

      </article>
    </div>
  )
}
