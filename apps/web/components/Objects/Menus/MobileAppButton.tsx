'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, DeviceMobile, DownloadSimple, Link as LinkIcon } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@components/ui/hover-card'
import { getBackendUrl, getUriWithOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'

// The link the LearnHouse mobile app understands when it scans a QR code
// (mobile: src/lib/connectLink.ts): which server to talk to and which org.
export function mobileConnectLink(server: string, orgslug: string): string {
  const base = server.replace(/\/+$/, '')
  return `learnhouse://connect?server=${encodeURI(base)}&org=${encodeURIComponent(orgslug)}`
}

type QrMatrix = { size: number; get: (row: number, col: number) => boolean }

// Builds the QR matrix only when the card opens, so the header stays light.
// Level Q keeps the code small (bigger dots) and still leaves room for the logo.
function useQrMatrix(text: string, enabled: boolean): QrMatrix | null {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null)
  useEffect(() => {
    if (!enabled || matrix) return
    let cancelled = false
    import('qrcode')
      .then((QR) => {
        const { modules } = QR.create(text, { errorCorrectionLevel: 'Q' })
        if (!cancelled) setMatrix({ size: modules.size, get: (r, c) => Boolean(modules.get(r, c)) })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [text, enabled, matrix])
  return matrix
}

const INK = '#111318'

// The LearnHouse mark, inlined once so a saved or copied PNG keeps it
// (an <image> pointing at a URL is dropped when the SVG is drawn to a canvas).
function useLogoDataUri(enabled: boolean): string {
  const [uri, setUri] = useState('/lrn.svg')
  useEffect(() => {
    if (!enabled || uri.startsWith('data:')) return
    let cancelled = false
    fetch('/lrn.svg')
      .then((r) => r.text())
      .then((svg) => { if (!cancelled) setUri(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [enabled, uri])
  return uri
}

// Draws the QR the way the card shows it: a rounded white tile with a thin
// border, centred on a transparent canvas with some breathing room around it.
async function qrToPng(svg: SVGSVGElement, size = 1024): Promise<Blob> {
  const xml = new XMLSerializer().serializeToString(svg)
  const src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('render')); img.src = src })
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  // Same proportions as the on-screen tile (336px wide, 30px radius, 2px border, 12px inset).
  const pad = Math.round(size * 0.07)
  const card = size - pad * 2
  const unit = card / 336
  const radius = 30 * unit
  const border = Math.max(2, 2 * unit)
  const inset = 12 * unit
  const rounded = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
  rounded(pad, pad, card, card, radius)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.save()
  rounded(pad, pad, card, card, radius)
  ctx.clip()
  ctx.drawImage(img, pad + inset, pad + inset, card - inset * 2, card - inset * 2)
  ctx.restore()
  rounded(pad + border / 2, pad + border / 2, card - border, card - border, radius - border / 2)
  ctx.lineWidth = border
  ctx.strokeStyle = '#e5e5e5'
  ctx.stroke()
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
}

// A rounder QR code: dots instead of squares, soft finder "eyes" and the
// LearnHouse mark in the middle. Still a standard QR, scannable by any reader.
function CustomQr({ matrix, label, logo }: { matrix: QrMatrix; label: string; logo: string }) {
  const n = matrix.size
  const margin = 1.5
  const view = n + margin * 2
  const inEye = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
  // Clear a centred square for the logo (~18% of the code, safe at level Q).
  const hole = Math.max(5, Math.round(n * 0.18) | 1)
  const h0 = Math.floor((n - hole) / 2)
  const inHole = (r: number, c: number) => r >= h0 && r < h0 + hole && c >= h0 && c < h0 + hole

  const dots: React.ReactNode[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix.get(r, c) || inEye(r, c) || inHole(r, c)) continue
      dots.push(<circle key={`${r}-${c}`} cx={c + margin + 0.5} cy={r + margin + 0.5} r={0.47} />)
    }
  }
  const eye = (r: number, c: number) => {
    const x = c + margin
    const y = r + margin
    return (
      <g key={`eye-${r}-${c}`}>
        <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.9} fill="none" stroke={INK} strokeWidth={1} />
        <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.95} fill={INK} />
      </g>
    )
  }
  const lx = h0 + margin
  const pad = 0.7
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${view} ${view}`} className="w-full h-full" role="img" aria-label={label} shapeRendering="geometricPrecision">
      <defs>
        <filter id="lh-qr-invert">
          <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
        </filter>
      </defs>
      <rect width={view} height={view} rx={2.2} fill="#ffffff" />
      <g fill={INK} fillOpacity={0.84}>{dots}</g>
      <g opacity={0.88}>
        {eye(0, 0)}
        {eye(0, n - 7)}
        {eye(n - 7, 0)}
      </g>
      <rect x={lx + pad} y={lx + pad} width={hole - pad * 2} height={hole - pad * 2} rx={(hole - pad * 2) * 0.28} fill={INK} />
      <image
        href={logo}
        x={lx + hole * 0.24}
        y={lx + hole * 0.36}
        width={hole * 0.52}
        height={hole * 0.28}
        preserveAspectRatio="xMidYMid meet"
        filter="url(#lh-qr-invert)"
      />
    </svg>
  )
}

export default function MobileAppButton({
  org,
  orgslug,
  className,
}: {
  org: { name?: string; org_uuid?: string; logo_image?: string | null; description?: string | null } | null | undefined
  orgslug: string
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const link = useMemo(() => mobileConnectLink(getBackendUrl() || '', orgslug), [orgslug])
  const qr = useQrMatrix(link, open)
  const logo = useLogoDataUri(open)
  const qrBox = useRef<HTMLButtonElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  // Where the right-click happened, relative to the QR box (the menu opens there).
  const [menuAt, setMenuAt] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [spinning, setSpinning] = useState(false)
  const autoFlipped = useRef(false)
  const flip = () => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    setSpinning(false)
    requestAnimationFrame(() => setSpinning(true))
  }
  // The first time the card opens, the code flips once by itself, in place
  // (shows the handle on the back, then returns to the code). Once per session.
  useEffect(() => {
    if (!open || !qr || autoFlipped.current) return
    autoFlipped.current = true
    try {
      if (sessionStorage.getItem('lh:qr-flip-seen')) return
      sessionStorage.setItem('lh:qr-flip-seen', '1')
    } catch {
      // storage blocked: still flip once for this page view
    }
    const id = window.setTimeout(flip, 450)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qr])
  useEffect(() => { if (!open) setMenu(false) }, [open])
  const fileName = `${(orgslug || 'learnhouse').replace(/[^a-z0-9-]+/gi, '-')}-mobile-app-qr.png`
  const png = async () => {
    const svg = qrBox.current?.querySelector('svg')
    if (!svg) throw new Error('qr')
    return qrToPng(svg as SVGSVGElement)
  }
  const copyImage = async () => {
    setMenu(false)
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })])
      toast.success(t('mobile_app.copied_image', 'QR code copied'))
    } catch {
      toast.error(t('mobile_app.copy_failed', "Couldn't copy the image. Try Download instead."))
    }
  }
  const download = async () => {
    setMenu(false)
    try {
      const url = URL.createObjectURL(await png())
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch {
      toast.error(t('mobile_app.download_failed', "Couldn't save the image."))
    }
  }
  const copyLink = async () => {
    setMenu(false)
    try {
      await navigator.clipboard.writeText(link)
      toast.success(t('mobile_app.copied_link', 'App link copied'))
    } catch {
      toast.error(t('mobile_app.copy_failed', "Couldn't copy the image. Try Download instead."))
    }
  }
  const address = useMemo(() => {
    try {
      return new URL(getUriWithOrg(orgslug, '/'), typeof window !== 'undefined' ? window.location.origin : 'http://localhost').host
    } catch {
      return orgslug
    }
  }, [orgslug])
  const name = org?.name || orgslug
  // The handle on the back of the card; long ones shrink and wrap onto two lines.
  const handle = `@${orgslug}`
  const handleSize = handle.length <= 12 ? 30 : handle.length <= 18 ? 26 : handle.length <= 26 ? 21 : 18
  const handleLong = handle.length > 22

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={80} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={className}
          aria-label={t('mobile_app.title', 'Get the mobile app')}
        >
          <DeviceMobile size={20} weight="fill" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="center" sideOffset={8} collisionPadding={16} className="w-72 rounded-2xl p-0 overflow-visible">
        <div className="flex flex-col items-center text-center px-5 pt-5 pb-5">
          <span className="w-11 h-11 rounded-xl bg-white ring-1 ring-inset ring-neutral-200 flex items-center justify-center overflow-hidden">
            {org?.logo_image && org.org_uuid ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)} alt="" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-sm font-semibold text-neutral-700">{name.slice(0, 1).toUpperCase()}</span>
            )}
          </span>
          <span className="mt-2.5 block max-w-full text-sm font-semibold text-neutral-900 truncate" dir="auto">{name}</span>
          <span className="block max-w-full text-xs text-neutral-500 truncate" dir="ltr">{address}</span>
          <div
            className="group relative mt-4 w-[176px] h-[176px]"
            onPointerMove={(e) => {
              // Tilt toward the pointer and slide the holographic sheen with it.
              const el = tiltRef.current
              if (!el) return
              const r = e.currentTarget.getBoundingClientRect()
              const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1)
              const y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)
              el.style.setProperty('--mx', String(x))
              el.style.setProperty('--my', String(y))
              el.style.setProperty('--ry', `${(x - 0.5) * 14}deg`)
              el.style.setProperty('--rx', `${(0.5 - y) * 14}deg`)
            }}
            onPointerLeave={() => {
              const el = tiltRef.current
              if (!el) return
              el.style.setProperty('--rx', '0deg')
              el.style.setProperty('--ry', '0deg')
            }}
          >
            <button
              type="button"
              ref={qrBox}
              onContextMenu={(e) => {
                // Right-click (or the context-menu key) opens Copy / Download / Copy link
                // where the pointer is, and the code stays zoomed.
                e.preventDefault()
                if (!qr) return
                const rect = e.currentTarget.parentElement?.getBoundingClientRect() // the fixed 176px box
                const keyboard = e.clientX === 0 && e.clientY === 0
                setMenuAt(
                  rect && !keyboard
                    ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
                    : { x: 88, y: 88 },
                )
                setMenu(true)
              }}
              onClick={() => {
                if (menu) { setMenu(false); return }
                // A left click flips the card: it slows on the back to show @orgslug, then spins on.
                flip()
              }}
              aria-haspopup="menu"
              aria-expanded={menu}
              // No native tooltip: it covered the code. The hint stays for screen readers.
              aria-description={t('mobile_app.qr_actions', 'Save or copy the QR code')}
              className={`absolute left-1/2 top-1/2 w-[336px] h-[336px] -translate-x-1/2 -translate-y-1/2 rounded-[30px] origin-center cursor-pointer [perspective:1100px] transition-[scale] duration-200 ease-out outline-none focus-visible:ring-4 focus-visible:ring-neutral-900 ${menu ? 'scale-100 z-10' : 'scale-[0.524] group-hover:scale-100 group-hover:z-10'}`}
              data-testid="mobile-app-qr"
            >
              {/* The button stays flat so the click target never moves; only the
                  visuals inside tilt toward the pointer and flip. */}
              <span ref={tiltRef} aria-hidden={false} className="lh-qr-tilt pointer-events-none absolute inset-0 [transform-style:preserve-3d]">
                <span
                  className={`absolute inset-0 [transform-style:preserve-3d] ${spinning ? 'lh-qr-taz' : ''}`}
                  onAnimationEnd={(e) => { if (e.animationName === 'lh-qr-taz') setSpinning(false) }}
                >
                      {/* Front: the QR code, with a holographic sheen that follows the pointer */}
                      <span className={`absolute inset-0 overflow-hidden rounded-[30px] bg-white ring-2 ring-inset ring-neutral-200 p-3 [backface-visibility:hidden] transition-shadow duration-200 ${menu ? 'shadow-2xl' : 'group-hover:shadow-2xl'}`}>
                        {qr ? (
                          <CustomQr matrix={qr} logo={logo} label={t('mobile_app.qr_alt', 'QR code to open this school in the LearnHouse app')} />
                        ) : (
                          <span className="block w-full h-full rounded-xl bg-neutral-100 animate-pulse" />
                        )}
                        <span aria-hidden className="lh-qr-holo pointer-events-none absolute inset-0 rounded-[30px]" />
                      </span>
                      {/* Back: the org's handle, seen mid-flip */}
                      <span
                        aria-hidden
                        className="lh-qr-back absolute inset-0 overflow-hidden rounded-[30px] ring-2 ring-inset ring-neutral-200 shadow-2xl flex flex-col items-center justify-center gap-6 px-6 [backface-visibility:hidden] [transform-style:preserve-3d] [transform:rotateY(180deg)]"
                      >
                        <span aria-hidden className="lh-qr-holo pointer-events-none absolute inset-0 rounded-[30px]" />
                        <span aria-hidden className="lh-qr-pattern pointer-events-none absolute -inset-1/4" />
                        <span className="w-[72px] h-[72px] rounded-[22px] bg-[#111318] flex items-center justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/lrn.svg" alt="" className="w-9 invert" />
                        </span>
                        {/* The handle pops out of the card as a rounded badge */}
                        <span
                      style={{ fontSize: handleSize }}
                      className={`max-w-[300px] whitespace-normal break-words text-center leading-tight ${handleLong ? 'rounded-[26px]' : 'rounded-full'} bg-[#111318] px-7 py-3 font-semibold tracking-tight text-white shadow-[0_20px_44px_-10px_rgba(17,19,24,0.5)] ring-2 ring-white/10 ${spinning ? 'lh-qr-badge' : '[transform:translateZ(68px)]'}`}
                          dir="ltr"
                        >
                      <span className="line-clamp-2">{handle}</span>
                        </span>
                      </span>
                </span>
              </span>
            </button>
            <style>{`
              .lh-qr-tilt { --mx: .5; --my: .5; --rx: 0deg; --ry: 0deg; transform: rotateX(var(--rx)) rotateY(var(--ry)); transition: transform .25s cubic-bezier(.2,.8,.2,1); }
              .lh-qr-back {
                background:
                  linear-gradient(135deg, rgba(255,255,255,.9) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,.75) 52%, rgba(255,255,255,0) 66%),
                  linear-gradient(160deg, #f4f5f8 0%, #e9ebf1 45%, #f6f7fa 70%, #e4e7ee 100%);
              }
              .lh-qr-pattern {
                /* The LearnHouse mark repeated diagonally, like printed sticker backing paper */
                background-image: url('/lrn.svg'), url('/lrn.svg');
                background-size: 30px 15px, 30px 15px;
                background-position: 0 0, 27px 24px;
                background-repeat: space;
                opacity: .05;
                transform: rotate(-24deg);
              }
              .lh-qr-holo {
                /* Sticker-like foil: three soft pastel washes on the white, multiplied so
                   the ink stays dark. Only on hover, drifting with the pointer. */
                mix-blend-mode: multiply;
                opacity: 0;
                background:
                  radial-gradient(48% 42% at calc(18% + var(--mx) * 30%) calc(22% + var(--my) * 25%), #d9f7ff 0%, rgba(217,247,255,0) 72%),
                  radial-gradient(46% 40% at calc(82% - var(--mx) * 25%) calc(35% + var(--my) * 20%), #fde3f4 0%, rgba(253,227,244,0) 72%),
                  radial-gradient(52% 46% at calc(40% + var(--mx) * 30%) calc(82% - var(--my) * 22%), #ebe3ff 0%, rgba(235,227,255,0) 74%);
                transition: opacity .35s ease;
              }
              .group:hover .lh-qr-holo { opacity: .8; }
              @keyframes lh-qr-taz {
                0%   { transform: rotateY(0deg);   animation-timing-function: cubic-bezier(.3,.6,.6,1); }
                15%  { transform: rotateY(165deg); animation-timing-function: cubic-bezier(.2,.7,.3,1); }
                24%  { transform: rotateY(180deg); animation-timing-function: linear; }
                54%  { transform: rotateY(186deg); animation-timing-function: cubic-bezier(.5,0,.8,.4); }
                62%  { transform: rotateY(215deg); animation-timing-function: cubic-bezier(.2,.5,.2,1); }
                100% { transform: rotateY(720deg); }
              }
              @keyframes lh-qr-badge {
                0%, 16%  { transform: translateZ(0) scale(.5); opacity: 0; }
                28%      { transform: translateZ(92px) scale(1.08); opacity: 1; }
                34%, 52% { transform: translateZ(68px) scale(1); opacity: 1; }
                62%      { transform: translateZ(20px) scale(.85); opacity: 0; }
                100%     { transform: translateZ(0) scale(.5); opacity: 0; }
              }
              .lh-qr-taz { animation: lh-qr-taz 2s both; will-change: transform; }
              .lh-qr-badge { animation: lh-qr-badge 2s both; }
              @media (prefers-reduced-motion: reduce) {
                .lh-qr-taz, .lh-qr-badge { animation: none; }
                .lh-qr-tilt { transform: none; }
              }
            `}</style>
            {menu && (
              <div
                role="menu"
                className="absolute z-30 w-48 rounded-xl bg-white p-1 text-start shadow-lg ring-1 ring-neutral-200"
                style={{ left: Math.min(Math.max(menuAt.x, -60), 120), top: menuAt.y }}
                data-testid="mobile-app-qr-menu"
              >
                <button type="button" role="menuitem" onClick={copyImage} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
                  <Copy size={15} /> {t('mobile_app.copy_image', 'Copy image')}
                </button>
                <button type="button" role="menuitem" onClick={download} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
                  <DownloadSimple size={15} /> {t('mobile_app.download_png', 'Download PNG')}
                </button>
                <button type="button" role="menuitem" onClick={copyLink} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
                  <LinkIcon size={15} /> {t('mobile_app.copy_link', 'Copy app link')}
                </button>
              </div>
            )}
          </div>
          <p className="mt-4 text-sm font-medium text-neutral-900">{t('mobile_app.heading', 'Learn on your phone')}</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500 max-w-[15rem]">
            {t('mobile_app.body', 'Open the LearnHouse app and scan this code to connect to this school.')}
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
