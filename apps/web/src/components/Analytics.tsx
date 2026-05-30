"use client"

import Script from "next/script"

/**
 * Google Tag Manager bootstrap.
 *
 * Spec L (docs/superpowers/specs/2026-05-31-L-ga4-gtm-sentry-integration-design.md)
 * §1 — GTM 設定.
 *
 *  - Reads NEXT_PUBLIC_GTM_ID at build time (must be set in Vercel env).
 *  - Renders nothing if GTM_ID is missing OR NODE_ENV !== "production",
 *    so dev / preview never pollute analytics with junk events.
 *  - Loads the GTM bootstrap with strategy="afterInteractive" so it never
 *    blocks first paint; GA4 fires through GTM tags configured in the
 *    GTM workspace (we do NOT call gtag directly anywhere).
 *
 * Event helpers live in `@/lib/analytics` and push onto `window.dataLayer`,
 * which the inline script below initialises before the GTM container loads.
 */
export function Analytics() {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID
  if (!gtmId || process.env.NODE_ENV !== "production") return null
  return (
    <>
      <Script
        id="gtm-base"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','${gtmId}');
      `,
        }}
      />
      <noscript
        dangerouslySetInnerHTML={{
          __html: `
        <iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}"
        height="0" width="0" style="display:none;visibility:hidden"></iframe>
      `,
        }}
      />
    </>
  )
}
