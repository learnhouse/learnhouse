'use client'
import React, { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import '../lib/i18n'
import { SessionProvider } from '@components/Contexts/AuthContext'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import I18nProvider from '@components/Contexts/I18nContext'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { makeQueryClient } from '@/lib/query/client'

// Standalone default — kept in sync with psp-module's buildCapitalThemeOverrides().
// Values are resolved Capital Design System tokens (blurple700 primary, DM Sans).
// The PSP shell overrides this via postMessage when running embedded.
const DEFAULT_OG_THEME = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
:root {
  --primary-color: #4B3FFF;
  --surface-color: #ffffff;
  --text-color: rgba(0, 0, 0, 0.87);
  --font-family-base: 'DM Sans', -apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
body, button, input, select, textarea,
h1, h2, h3, h4, h5, h6 { font-family: var(--font-family-base); }
body {
  color: var(--text-color);
  font-size: 16px;
  line-height: 1.5;
  font-feature-settings: 'ss03' on;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
/* ---- Buttons & icons → Capital Design System -------------------------- */
/* shadcn <Button> (components/ui/button.tsx) default/link variants and focus
   rings derive from these HSL tuples in globals.css. Repoint primary + ring to
   Capital blurple700 (#4B3FFF ≈ hsl(244 100% 62%)); shadcn's hover:bg-primary/90
   then darkens toward blurple on hover. This unlayered :root beats globals.css's
   @layer base :root. */
:root {
  --primary: 244 100% 62%;
  --primary-foreground: 0 0% 100%;
  --ring: 244 100% 62%;
}
/* LearnHouse-native primary buttons are bare Tailwind (New Course/Collection/
   Podcast): a rounded, black, bold, white-text CTA — keyed on those shared
   classes because the shadow class varies (nice-shadow vs drop-shadow-lg).
   Recolor to the Capital action color and darken on hover (blurple900 #19009B)
   — Capital buttons darken, they don't do LH's scale bounce. */
.rounded-lg.bg-black.text-white.font-bold { background-color: #4B3FFF !important; }
.rounded-lg.bg-black.text-white.font-bold:hover {
  background-color: #19009B !important;
  transform: none !important;
}
.rounded-lg.bg-black.text-white.font-bold .bg-neutral-800 {
  background-color: rgba(255, 255, 255, 0.24) !important;
}
/* Soften LH's pure-black Lucide glyphs to the Capital body-text neutral (icons
   are currentColor; intentionally-colored icons are left untouched). */
svg.lucide.text-black { color: rgba(0, 0, 0, 0.87) !important; }
/* Strip the boxed white/shadow chip around icons — Capital shows glyphs inline,
   not in an elevated tile. :has(> svg.lucide) limits this to small surfaces that
   directly wrap a glyph, so real cards/menus keep their elevation. */
.bg-white.nice-shadow:has(> svg.lucide) {
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}
/* Hide top-nav link icons (LH ships Phosphor, which is not a CDS icon set). */
nav[aria-label="Top navigation"] ul li svg { display: none !important; }
/* Top-nav menu links — Capital NavBar tab style: 4px bottom bar, blurple700
   (#4B3FFF) on the active page, faint blurple100 on hover. The active link is
   tagged with data-og-nav-active by Providers on each route change. */
nav[aria-label="Top navigation"] ul a li {
  font-size: 14px;
  height: 60px;
  align-items: center;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
nav[aria-label="Top navigation"] ul a:hover li { border-bottom-color: #EEF1FC; }
nav[aria-label="Top navigation"] ul a[data-og-nav-active] li { border-bottom-color: #4B3FFF; }
/* Replace the org logo with a "Product Enablement" wordmark — sized/colored like
   the Capital NavBar app title (h3 20px, semiBold 600, blurple700). Keep the
   logo's home link in the a11y tree: hide only the graphic inside it (not the
   <a>), and hang the wordmark off the anchor so the generated text becomes the
   link's accessible name (announced by screen readers; the home link stays
   focusable). */
nav[aria-label="Top navigation"] .logo { justify-content: flex-start !important; }
/* Drop the logo graphic AND its h-9/py-1 wrapper box — leaving the wrapper made
   it an empty 36px block that pushed the ::after wordmark onto the next line.
   Lay the anchor out as a centered inline-flex so only the wordmark shows. */
nav[aria-label="Top navigation"] .logo > a > div,
nav[aria-label="Top navigation"] .logo > a img,
nav[aria-label="Top navigation"] .logo > a svg { display: none !important; }
nav[aria-label="Top navigation"] .logo > a {
  display: inline-flex;
  align-items: center;
}
nav[aria-label="Top navigation"] .logo > a::after {
  content: "Product Enablement";
  font-weight: 600;
  font-size: 20px;
  line-height: 1;
  color: #4B3FFF;
  white-space: nowrap;
}
/* Align the page-width containers (top nav + main content) to the Capital
   AdminBar gutter: flat 16px ($unit-2) left/right, full width — dropping LH's
   shared max-w-(--breakpoint-2xl) mx-auto px-4/6/8 centering. */
[class*="max-w-(--breakpoint-2xl)"][class*="mx-auto"] {
  max-width: none !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding-left: 16px !important;
  padding-right: 16px !important;
}
nav[aria-label="Dashboard sidebar navigation"] {
  width: 240px !important;
  min-width: 240px !important;
}
`.trim()

function applyThemeCss(css: string) {
  let style = document.getElementById('og-theme-override') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'og-theme-override'
    document.head.appendChild(style)
  }
  style.textContent = css
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient())
  const pathname = usePathname()

  // Tag the active top-nav menu link so the injected CSS can draw the Capital
  // blurple underline on the selected page. LH ships no active marker of its own.
  // The nav mounts after org data loads (later than this effect), and re-renders,
  // so a debounced MutationObserver re-marks until/while it's present. mark() is a
  // no-op when the active link is unchanged, so setting the attr can't loop.
  useEffect(() => {
    let scheduled = false
    const mark = () => {
      scheduled = false
      const nav = document.querySelector('nav[aria-label="Top navigation"]')
      if (!nav) return
      const anchors = Array.from(nav.querySelectorAll('ul a[href]')) as HTMLAnchorElement[]
      let best: HTMLAnchorElement | null = null
      let bestLen = -1
      for (const a of anchors) {
        const href = (a.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/, '')
        if (!href || href === '/') continue
        if (pathname === href || pathname.startsWith(href + '/')) {
          if (href.length > bestLen) { best = a; bestLen = href.length }
        }
      }
      // Read the current mark from the DOM (not a closure) so stale marks left by
      // a previous route's effect get cleared. No-op when already correct → no loop.
      const marked = Array.from(nav.querySelectorAll('ul a[data-og-nav-active]'))
      if (marked.length === 1 && marked[0] === best) return
      marked.forEach((el) => el.removeAttribute('data-og-nav-active'))
      best?.setAttribute('data-og-nav-active', 'true')
    }
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(mark)
    }
    mark()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [pathname])

  useEffect(() => {
    // Apply Capital branding immediately so it's visible standalone too.
    // The PSP shell overrides it via postMessage when running embedded.
    applyThemeCss(DEFAULT_OG_THEME)

    const allowedOrigin = process.env.NEXT_PUBLIC_PSP_SHELL_ORIGIN || ''
    const handler = (e: MessageEvent) => {
      if (allowedOrigin && e.origin !== allowedOrigin) return
      if (e.data?.type !== 'OG_THEME' || typeof e.data.css !== 'string') return
      applyThemeCss(e.data.css)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider refetchInterval={600000}>
        <LHSessionProvider>
          <I18nProvider>{children}</I18nProvider>
        </LHSessionProvider>
      </SessionProvider>
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
