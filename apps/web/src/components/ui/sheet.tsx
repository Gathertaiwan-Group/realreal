"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

interface SheetContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextValue>({
  open: false,
  onOpenChange: () => {},
})

function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <SheetContext.Provider value={{ open, onOpenChange }}>
      {children}
    </SheetContext.Provider>
  )
}

function SheetTrigger({
  children,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { onOpenChange } = React.useContext(SheetContext)
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      onClick: (e: React.MouseEvent) => {
        onOpenChange(true)
        const childProps = (children as React.ReactElement<Record<string, unknown>>).props
        if (typeof childProps.onClick === "function") {
          ;(childProps.onClick as (e: React.MouseEvent) => void)(e)
        }
      },
    })
  }
  return (
    <button type="button" onClick={() => onOpenChange(true)} {...props}>
      {children}
    </button>
  )
}

function SheetContent({
  children,
  className,
  side = "right",
}: {
  children: React.ReactNode
  className?: string
  side?: "left" | "right"
}) {
  const { open, onOpenChange } = React.useContext(SheetContext)

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    if (open) window.addEventListener("keydown", handleEsc)
    return () => window.removeEventListener("keydown", handleEsc)
  }, [open, onOpenChange])

  if (!open || typeof document === "undefined") return null

  // Portal to <body> so the fixed overlay/panel are positioned relative to the
  // viewport — NOT to an ancestor that establishes a containing block for
  // position:fixed descendants. The site header is `sticky … backdrop-blur`,
  // and backdrop-filter (like transform/filter) makes an element such a
  // containing block. Rendered inline, this drawer was trapped inside the 72px
  // header box, which pushed the footer CTAs off-screen on shorter viewports.
  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* backdrop — dim only, no blur (blur made the panel look hazy) */}
      <div
        className="fixed inset-0 bg-black/50 animate-in fade-in-0"
        onClick={() => onOpenChange(false)}
      />
      {/* panel — full width on mobile, 520px on md+ unless overridden.
          Explicit bg-white + h-[100dvh] (not relying on bg-background var or
          inset-y-0 alone) to guarantee a fully opaque panel. Uses dvh (the
          *visible* viewport) rather than h-screen/100vh so the panel — and its
          sticky footer CTAs — stay on-screen as mobile browser chrome shows/
          hides and on short desktop windows.
          A previous build looked translucent because `cn()` merging interacted
          oddly with the consumer's `p-0` override. */}
      <div
        className={cn(
          "fixed top-0 z-50 flex h-[100dvh] flex-col bg-white shadow-2xl",
          "w-full md:max-w-[520px]",
          side === "right"
            ? "right-0 border-l animate-in slide-in-from-right"
            : "left-0 border-r animate-in slide-in-from-left",
          className
        )}
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">關閉</span>
        </button>
        {children}
      </div>
    </div>,
    document.body
  )
}

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-2 p-6 pb-0 shrink-0", className)} {...props} />
}

function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />
}

function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t p-6 shrink-0", className)} {...props} />
}

export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter }
