import '../styles/globals.css'
import React from 'react'
import Providers from '@components/Providers'
import { Wix_Madefor_Text, Tajawal } from 'next/font/google'

const wixMadeforText = Wix_Madefor_Text({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-default',
})

// Wix Madefor Text has no Arabic subset, so Arabic would otherwise fall back to
// whatever the OS provides — Geeza Pro, Segoe UI, Noto — and look like a
// different product on every platform.
//
// Tajawal is the Arabic face for the whole product. It is FORCED whenever the
// UI is Arabic (see globals.css), not merely offered as a fallback: Tajawal
// ships a Latin subset too, so a mixed Arabic screen renders in one typeface
// instead of switching per glyph between two designs with different
// proportions.
//
// Weights are 200-900 with no 600 — a `font-semibold` element rounds up to 700,
// which is the intended reading.
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '700', '800'],
  display: 'swap',
  variable: '--font-arabic',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `dir` is deliberately absent from the <html> below. React only reconciles
  // attributes present in its virtual tree, so leaving it out means React never
  // clobbers what dir-init.js wrote before paint. `lang="en"` stays as the
  // no-JS baseline for crawlers; the script overwrites it for everyone else.
  return (
    <html
      className={`${wixMadeforText.variable} ${tajawal.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        {/* Synchronous script — sets <html lang/dir> before body paints so an
            RTL locale never flashes an LTR layout. Must run first. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/dir-init.js" />
        {/* Synchronous script — blocks parsing to guarantee window.__RUNTIME_CONFIG__ exists before any JS runs.
            Next.js <Script strategy="beforeInteractive"> is not truly blocking in all browsers (Safari). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
        {/* Prevent white flash on embed routes: set html+body bg before body is painted.
            Reads the optional ?bgcolor param (hex-validated) or defaults to dark. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/embed-bg.js" />
      </head>
      {/* Built-in page translation (Chrome/Edge/Yandex, and Chrome on Android
          where it is on by default) replaces text nodes with <font> wrappers it
          inserts itself. React's fiber tree still points at the originals, so
          the next commit can call insertBefore/removeChild against a node that
          is no longer a child of the parent it recorded, and the page dies on
          "NotFoundError: Failed to execute 'insertBefore'". That is a real and
          documented React failure mode, and this attribute closes it.

          READ THIS BEFORE CITING IT AS A FIX. It is hardening, NOT a diagnosed
          fix for any recorded Sentry issue. It was originally written up as the
          cause of LEARNHOUSE-WEB-5M / -6A / -6J and that attribution does not
          survive its own evidence:

            - The dash subtree has carried BOTH translate="no" and the
              `notranslate` class since 4080d4ca (2026-07-25) — see
              app/orgs/[orgslug]/dash/ClientAdminLayout.tsx. That is a month
              before 6A's first event (2026-08-24). Whatever crashed there was
              already opted out of translation for the issue's entire life.
            - 6A's 14 events are not one route. They span /dash/courses,
              /dash/courses/course/:uuid/{general,content} (inside that
              already-opted-out div), plus /courses, /course/:uuid and /new
              (outside it), across four hosts and Chrome, Edge and Chrome Mobile.
              The "culprit" shown in Sentry is just the first event's route.
            - Every frame in 5M's and 6A's stacks is minified React internals
              (a recursive lo/ll commit pair ending at a root commit) with no app
              frame at all, and this project has no source maps uploaded, so
              there is nothing in the event tying the crash to a translated node,
              a portal, or any component we own.

          So the real cause of 5M/6A/6J is unknown and those issues stay OPEN in
          Sentry. Do not close them against this attribute or this file. The next
          real step is uploading source maps, not another DOM guess.

          Placement is still <body> rather than a subtree, on its own merits:
          React portals (every Radix dialog, dropdown and the toaster) mount into
          document.body, outside any inner wrapper, and `translate` is inherited
          so one attribute covers the whole document including those portals.

          THIS IS DELIBERATELY NOT THE LAST WORD. Turning translation off for the
          whole product would be a real regression: LearnHouse ships 21 locales,
          and users do read the product through the browser translator (the
          events above came from zh-TW and pt-BR readers). `translate` is
          inherited, so the scoping happens by re-enabling downwards. The
          authored course prose — the content a learner most needs machine
          translated — is re-enabled on the ProseMirror surface in
          DynamicCanva.tsx, where React does not reconcile the text nodes and so
          cannot hit this failure mode. Anything else that must stay translatable
          re-enables itself the same way, with translate="yes" on the narrowest
          wrapper React does not own.

          The opt-out here is the `translate` attribute ONLY, deliberately
          without the legacy `notranslate` class. `translate` is defined by HTML
          as an inherited state a descendant can flip back on, which is what
          makes the scoping above possible; `notranslate` is a Google Translate
          convention that makes a traversal skip the subtree outright, with no
          documented way for a descendant to opt back in. Adding it here would
          silently undo DynamicCanva's re-enable. Chrome and Edge both honour the
          attribute on its own. */}
      <body suppressHydrationWarning translate="no">
        <Providers>
          <main className="animate-fade-in">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
