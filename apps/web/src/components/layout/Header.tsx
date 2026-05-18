"use client"

import Link from "next/link"
import Image from "next/image"
import { useState, useRef, useEffect } from "react"
import { Menu, X, User, ChevronDown } from "lucide-react"
import { CartButton } from "@/components/cart/CartButton"

const NAV_LINKS = [
  { href: "/", label: "首頁" },
  { href: "/about", label: "品牌故事" },
  {
    href: "/shop",
    label: "了解產品",
    children: [
      { href: "/shop?category=protein", label: "植物蛋白粉" },
      { href: "/shop?category=fruit", label: "凍乾水果" },
    ],
  },
  { href: "/faq", label: "常見問題" },
  { href: "/blog", label: "聰明生活" },
  { href: "/idea", label: "公益里程" },
  { href: "/membership", label: "會員制度" },
]


export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [productOpen, setProductOpen] = useState(false)
  const dropdownTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close mobile menu on route change (resize)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileOpen(false)
      }
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const handleDropdownEnter = () => {
    if (dropdownTimeout.current) clearTimeout(dropdownTimeout.current)
    setProductOpen(true)
  }

  const handleDropdownLeave = () => {
    dropdownTimeout.current = setTimeout(() => setProductOpen(false), 150)
  }

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm">
        <div className="container mx-auto flex h-[72px] items-center justify-between px-4">
          {/* Logo */}
          <Link href="/" className="flex-shrink-0">
            <Image
              src="/logo.svg"
              alt="誠真生活 RealReal"
              width={220}
              height={110}
              className="h-[70px] w-auto"
              priority
            />
          </Link>

          {/* Desktop Nav — center */}
          <nav
            className="hidden items-center gap-1 md:flex"
            style={{ fontFamily: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif" }}
          >
            {NAV_LINKS.map((link) => {
              if (link.children) {
                return (
                  <div
                    key={link.href}
                    className="relative"
                    onMouseEnter={handleDropdownEnter}
                    onMouseLeave={handleDropdownLeave}
                  >
                    <Link
                      href={link.href}
                      className="group inline-flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors hover:text-[#10305a]/70"
                      style={{ color: "#10305a" }}
                    >
                      {link.label}
                      <ChevronDown
                        className="h-3.5 w-3.5 transition-transform duration-200"
                        style={{
                          transform: productOpen ? "rotate(180deg)" : "rotate(0deg)",
                        }}
                      />
                      <span className="absolute bottom-0 left-3 right-3 h-0.5 origin-left scale-x-0 bg-[#10305a] transition-transform duration-200 group-hover:scale-x-100" />
                    </Link>

                    {/* Dropdown */}
                    <div
                      className="absolute left-0 top-full pt-1"
                      style={{
                        opacity: productOpen ? 1 : 0,
                        pointerEvents: productOpen ? "auto" : "none",
                        transition: "opacity 150ms ease",
                      }}
                    >
                      <div className="min-w-[160px] rounded-md border border-gray-100 bg-white py-1 shadow-lg">
                        {link.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            className="block px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
                            style={{ color: "#10305a" }}
                            onClick={() => setProductOpen(false)}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group relative px-3 py-2 text-sm font-medium transition-colors hover:text-[#10305a]/70"
                  style={{ color: "#10305a" }}
                >
                  {link.label}
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 origin-left scale-x-0 bg-[#10305a] transition-transform duration-200 group-hover:scale-x-100" />
                </Link>
              )
            })}
          </nav>

          {/* Right side icons */}
          <div className="flex items-center gap-1">
            <CartButton />
            <Link
              href="/my-account"
              aria-label="我的帳戶"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-gray-100"
            >
              <User className="h-5 w-5" style={{ color: "#10305a" }} />
            </Link>

            {/* Mobile hamburger */}
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-gray-100 md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="選單"
            >
              {mobileOpen ? (
                <X className="h-5 w-5" style={{ color: "#10305a" }} />
              ) : (
                <Menu className="h-5 w-5" style={{ color: "#10305a" }} />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div
            className="border-t border-gray-100 bg-white px-4 pb-4 md:hidden"
            style={{ fontFamily: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif" }}
          >
            <nav className="flex flex-col gap-1 pt-2">
              {NAV_LINKS.map((link) => {
                if (link.children) {
                  return (
                    <div key={link.href}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
                        style={{ color: "#10305a" }}
                        onClick={() => setProductOpen(!productOpen)}
                      >
                        {link.label}
                        <ChevronDown
                          className="h-4 w-4 transition-transform duration-200"
                          style={{
                            transform: productOpen ? "rotate(180deg)" : "rotate(0deg)",
                          }}
                        />
                      </button>
                      {productOpen && (
                        <div className="ml-4 flex flex-col gap-1">
                          {link.children.map((child) => (
                            <Link
                              key={child.href}
                              href={child.href}
                              className="rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
                              style={{ color: "#10305a" }}
                              onClick={() => setMobileOpen(false)}
                            >
                              {child.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-md px-3 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
                    style={{ color: "#10305a" }}
                    onClick={() => setMobileOpen(false)}
                  >
                    {link.label}
                  </Link>
                )
              })}
            </nav>
          </div>
        )}
      </header>

    </>
  )
}
