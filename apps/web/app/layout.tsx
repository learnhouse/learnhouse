import '../styles/globals.css'
import React from 'react'
import type { Metadata, Viewport } from 'next'
import Providers from '@components/Providers'
import ImageFallbackGuard from '@components/Utils/ImageFallbackGuard'
import { Wix_Madefor_Text, Tajawal } from 'next/font/google'
import { dirInitScript, embedBgScript, runtimeConfigScript, themeInitScript, translateGuardScript } from '@/lib/headScripts'

// A blocking head script, inline when its source could be read, else the
// original synchronous tag.
function HeadScript({ file, text }: { file: string; text: string | null }) {
  if (text === null) {
    // eslint-disable-next-line @next/next/no-sync-scripts
    return <script src={file} />
  }
  return <script dangerouslySetInnerHTML={{ __html: text }} />
}

const wixMadeforText = Wix_Madefor_Text({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-default',
})

// Wix Madefor Text has no Arabic subset, so Arabic would otherwise fall back to
// whatever the OS provides (Geeza Pro, Segoe UI, Noto) and look like a
// different product on every platform.
//
// Tajawal is the Arabic face for the whole product. It is FORCED whenever the
// UI is Arabic (see globals.css), not merely offered as a fallback: Tajawal
// ships a Latin subset too, so a mixed Arabic screen renders in one typeface
// instead of switching per glyph between two designs with different
// proportions.
//
// Weights are 200-900 with no 600, so a `font-semibold` element rounds up to 700,
// which is the intended reading.
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '700', '800'],
  display: 'swap',
  variable: '--font-arabic',
  // Only RTL/Arabic screens use it, so don't make every visitor download it.
  preload: false,
})

// viewport-fit=cover lets the phone shell paint under the notch and home
// indicator; the bars pad themselves with env(safe-area-inset-*). Pinch zoom
// stays enabled: inputs are 16px on phones so focusing one never auto-zooms.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
}

// Saved to the home screen, the app opens without browser chrome.
export const metadata: Metadata = {
  appleWebApp: { capable: true, statusBarStyle: 'default' },
  formatDetection: { telephone: false },
}

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
        {/* Run before the body paints and before hydration, in this order:
            dir-init sets <html lang/dir> so an RTL locale never flashes LTR;
            theme-init sets <html data-theme="dark"> for a user who picked
            dark (manual only, never the OS), so dark never flashes white;
            runtime-config must define window.__RUNTIME_CONFIG__ before any
            app JS; embed-bg paints embed routes dark before first paint;
            translate-guard keeps browser page translation from crashing React.
            Inlined (see lib/headScripts.ts): as separate <script src> they were
            blocking round trips each before the first paint. A file that can't be
            read falls back to the old synchronous tag, same order. */}
        <HeadScript file="/dir-init.js" text={dirInitScript()} />
        <HeadScript file="/theme-init.js" text={themeInitScript()} />
        <HeadScript file="/runtime-config.js" text={runtimeConfigScript()} />
        <HeadScript file="/embed-bg.js" text={embedBgScript()} />
        <HeadScript file="/translate-guard.js" text={translateGuardScript()} />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <ImageFallbackGuard />
          <main className="animate-fade-in">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
