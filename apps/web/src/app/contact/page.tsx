import { getSiteContent } from "@/lib/content"
import ContactForm from "./contact-form"

type ContactInfo = {
  company_name: string
  email: string
  phone: string
  address: string
  hours: string
}

export default async function ContactPage() {
  const info = await getSiteContent<ContactInfo>("contact_info")

  const email = info?.email ?? "love@realreal.cc"
  const phone = info?.phone ?? "02-66093066"
  const address = info?.address ?? "100 台北市仁愛路二段 25 號 5 樓"
  const hours = info?.hours ?? null

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="text-3xl font-bold mb-2 text-center text-[#10305a]">聯絡我們</h1>
      <p className="text-[#687279] text-center mb-10">
        有任何問題或合作提案，歡迎與我們聯繫
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
        {/* Contact Form */}
        <ContactForm />

        {/* Company Info Sidebar */}
        <aside className="space-y-8">
          <div>
            <h2 className="font-semibold mb-3 text-[#10305a]">聯絡資訊</h2>
            <dl className="space-y-3 text-sm text-[#687279]">
              <div>
                <dt className="font-medium text-[#10305a]">電子信箱</dt>
                <dd>
                  <a
                    href={`mailto:${email}`}
                    className="hover:underline"
                  >
                    {email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[#10305a]">客服電話</dt>
                <dd>{phone}</dd>
              </div>
              <div>
                <dt className="font-medium text-[#10305a]">LINE</dt>
                <dd>
                  <a
                    href="https://line.me/ti/p/@900kevgi"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    @900kevgi
                  </a>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[#10305a]">公司地址</dt>
                <dd>{address}（非對外門市）</dd>
              </div>
            </dl>
          </div>

          <div>
            <h2 className="font-semibold mb-3 text-[#10305a]">公司資訊</h2>
            <dl className="space-y-1 text-sm text-[#687279]">
              <dd>誠真生活有限公司</dd>
              <dd>統一編號：60515111</dd>
              <dd>食品業者登錄字號</dd>
              <dd>A-202321704-00000-8</dd>
            </dl>
          </div>

          <div>
            <h2 className="font-semibold mb-3 text-[#10305a]">營業時間</h2>
            {hours ? (
              <p className="text-sm text-[#687279] whitespace-pre-line">{hours}</p>
            ) : (
              <dl className="space-y-1 text-sm text-[#687279]">
                <div className="flex justify-between">
                  <dt>週一至週五</dt>
                  <dd>09:00 – 18:00</dd>
                </div>
                <div className="flex justify-between">
                  <dt>週日及國定假日</dt>
                  <dd className="text-zinc-400">公休</dd>
                </div>
              </dl>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
