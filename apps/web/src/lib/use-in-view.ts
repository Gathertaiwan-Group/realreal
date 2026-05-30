import { useEffect, useRef, useState } from "react"

/**
 * IntersectionObserver hook — sets `inView` to true the first time the
 * referenced element enters the viewport (then disconnects). Used by
 * scroll-triggered fade-in / slide-up animations in category landing pages.
 *
 * Per spec J Section 5.
 */
export function useInView<T extends HTMLElement = HTMLElement>(threshold = 0.1) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])

  return { ref, inView }
}
