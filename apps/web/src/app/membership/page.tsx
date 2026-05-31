import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

export const metadata: Metadata = {
  title: "會員制度 | 誠真生活 RealReal",
  description:
    "了解誠真生活 RealReal 會員制度，從初心之友到同心之友，享受專屬折扣、公益存款與生日禮遇。",
}

const membershipImages = [
  {
    src: "https://realreal.cc/wp-content/uploads/2025/12/會員制度表_沒有按鈕_會員圖1.jpg",
    alt: "會員制度表",
    width: 1800,
    height: 1350,
  },
  {
    src: "/brand/membership-table.png",
    alt: "會員制度表",
    width: 1800,
    height: 1350,
  },
]

const tiers = [
  {
    emoji: "⭐",
    name: "Firstheart Friend",
    requirement: "Free to Join",
    tagline: "Where goodwill begins, and intention takes root.",
    benefits: [
      "NT$50 off your first purchase",
      "2% cashback on every purchase — redeemable as store credit or Charity Savings",
      "Birthday Gift: NT$50 credit",
    ],
    validity: "Lifetime membership",
    quote: "A gentle first step into sincere living.",
  },
  {
    emoji: "⭐⭐",
    name: "Kindred Friend",
    requirement: "Accumulated spend of NT$3,500 within 6 months",
    tagline: "Growing together, heart to heart.",
    benefits: [
      "2.5% cashback on every purchase — redeemable as store credit or Charity Savings",
      "Birthday Gift: NT$100 credit",
      "Exclusive member-only promotions",
    ],
    validity: "1 year from upgrade date",
    quote: "A deeper connection built on trust and care.",
  },
  {
    emoji: "⭐⭐⭐",
    name: "Soulbound Friend",
    requirement: "Accumulated spend of NT$12,000 within 12 months",
    tagline: "Walking together toward a kinder world.",
    benefits: [
      "3% cashback on every purchase — redeemable as store credit or Charity Savings",
      "Birthday Gift: NT$150 credit",
      "Exclusive VIP-only promotions",
    ],
    validity: "3 years from upgrade date",
    quote: "When goodness compounds, beautiful things happen.",
  },
]

export default function MembershipPage() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-3xl font-bold mb-10 text-center text-[#10305a]">
        會員制度
      </h1>

      {/* Membership tier images from WordPress */}
      <div className="space-y-6 mb-12">
        {membershipImages.map((img) => (
          <Image
            key={img.src}
            src={img.src}
            alt={img.alt}
            width={img.width}
            height={img.height}
            className="w-full h-auto rounded-[10px]"
            unoptimized
          />
        ))}
      </div>

      {/* CTA */}
      <div className="text-center mb-12">
        <Link
          href="/auth/register"
          className="inline-block rounded-full bg-[#10305a] px-8 py-3 text-white font-semibold hover:bg-[#10305a]/90 transition-colors"
        >
          開啟旅程
        </Link>
      </div>

      {/* Notes */}
      <div className="mb-12 text-sm text-[#687279] space-y-1">
        <p>
          <strong className="text-[#10305a]">*</strong>{" "}
          公益存款按實際消費金額扣除運費後計算
        </p>
        <p>
          <strong className="text-[#10305a]">*</strong>{" "}
          記得於會員資料中填寫生日，才能收到專屬生日禮喔
        </p>
      </div>

      {/* Tier details */}
      <div className="space-y-10">
        {tiers.map((tier) => (
          <section
            key={tier.name}
            className="rounded-lg border border-[#10305a]/10 p-6 sm:p-8"
          >
            <h2 className="text-xl font-bold text-[#10305a] mb-1">
              {tier.emoji} {tier.name}
            </h2>
            <p className="text-sm font-semibold text-[#687279] mb-2">
              ({tier.requirement})
            </p>
            <p className="text-[#687279] italic mb-4">
              💛 {tier.tagline}
            </p>

            <ul className="space-y-2 mb-4">
              {tier.benefits.map((benefit) => (
                <li
                  key={benefit}
                  className="flex items-start gap-2 text-[#687279]"
                >
                  <span className="text-[#10305a] mt-0.5">•</span>
                  <span dangerouslySetInnerHTML={{ __html: benefit.replace(/^(.+?)(saved as|:)/, '<strong>$1</strong>$2') }} />
                </li>
              ))}
            </ul>

            <p className="text-sm font-semibold text-[#10305a] mb-3">
              {tier.validity}
            </p>

            <blockquote className="border-l-4 border-[#10305a]/30 pl-4 text-[#687279] italic">
              {tier.quote}
            </blockquote>
          </section>
        ))}
      </div>
    </div>
  )
}
