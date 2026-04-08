'use client'
import React, { useEffect, useRef } from 'react'
import createGlobe from 'cobe'

// Learning subject emojis placed around the world
const STICKER_MARKERS = [
  // Europe — spread across the continent
  { id: 'stk-math', location: [48.86, 2.35] as [number, number], sticker: '📐' },
  { id: 'stk-chemistry', location: [59.33, 18.07] as [number, number], sticker: '⚗️' },
  { id: 'stk-germany', location: [48.14, 11.58] as [number, number], sticker: '🧪' },
  // Asia — well distributed
  { id: 'stk-science', location: [35.68, 139.65] as [number, number], sticker: '🔬' },
  { id: 'stk-astro', location: [28.61, 77.21] as [number, number], sticker: '🔭' },
  { id: 'stk-thailand', location: [13.76, 100.5] as [number, number], sticker: '🎓' },
  { id: 'stk-vietnam', location: [55.75, 37.62] as [number, number], sticker: '🎯' },
  // Americas
  { id: 'stk-art', location: [34.05, -118.24] as [number, number], sticker: '🎨' },
  { id: 'stk-canada', location: [56.13, -106.35] as [number, number], sticker: '🍁' },
  { id: 'stk-nature', location: [19.43, -99.13] as [number, number], sticker: '🌿' },
  { id: 'stk-music', location: [-15.78, -47.93] as [number, number], sticker: '🎵' },
  { id: 'stk-argentina', location: [-34.6, -58.38] as [number, number], sticker: '✏️' },
  // Africa
  { id: 'stk-morocco', location: [33.97, -6.85] as [number, number], sticker: '🏛️' },
  { id: 'stk-kenya', location: [-1.29, 36.82] as [number, number], sticker: '🦁' },
  { id: 'stk-nigeria', location: [9.06, 7.49] as [number, number], sticker: '🌍' },
  { id: 'stk-history', location: [30.04, 31.24] as [number, number], sticker: '📜' },
  // Oceania & Pacific
  { id: 'stk-code', location: [-33.87, 151.21] as [number, number], sticker: '💻' },
  // North Atlantic & Nordic
  { id: 'stk-book', location: [64.15, -21.94] as [number, number], sticker: '📚' },
  { id: 'stk-sports', location: [37.57, 126.98] as [number, number], sticker: '⚽' },
  { id: 'stk-language', location: [41.9, 12.5] as [number, number], sticker: '🗣️' },
]

// Arcs connecting learners across the globe
const COLLABORATION_ARCS = [
  { from: [48.86, 2.35] as [number, number], to: [40.71, -74.01] as [number, number], color: [0.4, 0.6, 1] as [number, number, number] },
  { from: [35.68, 139.65] as [number, number], to: [-33.87, 151.21] as [number, number], color: [0.7, 0.4, 0.9] as [number, number, number] },
  { from: [51.51, -0.13] as [number, number], to: [28.61, 77.21] as [number, number], color: [0.3, 0.8, 0.6] as [number, number, number] },
  { from: [41.9, 12.5] as [number, number], to: [-22.91, -43.17] as [number, number], color: [0.9, 0.5, 0.3] as [number, number, number] },
  { from: [30.04, 31.24] as [number, number], to: [37.57, 126.98] as [number, number], color: [0.9, 0.3, 0.5] as [number, number, number] },
  { from: [19.43, -99.13] as [number, number], to: [64.15, -21.94] as [number, number], color: [0.3, 0.7, 0.9] as [number, number, number] },
]

export default function WelcomeGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pointerDown = useRef(false)
  const lastX = useRef(0)
  const dragVelocity = useRef(0)
  const phiRef = useRef(1.8)

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return
    const container = containerRef.current

    const width = container.offsetWidth
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let phi = 1.8
    phiRef.current = phi
    const autoRotateSpeed = 0.003

    const onDown = (e: PointerEvent) => {
      pointerDown.current = true
      lastX.current = e.clientX
      dragVelocity.current = 0
      container.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!pointerDown.current) return
      const delta = e.clientX - lastX.current
      lastX.current = e.clientX
      dragVelocity.current = delta * 0.005
      phiRef.current += dragVelocity.current
    }
    const onUp = () => {
      pointerDown.current = false
    }

    container.addEventListener('pointerdown', onDown)
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('pointerleave', onUp)

    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: dpr,
      width: width,
      height: width,
      phi: 1.8,
      theta: 0.15,
      dark: 0,
      diffuse: 1.5,
      mapSamples: 16000,
      mapBrightness: 8,
      baseColor: [1, 1, 1],
      markerColor: [0.2, 0.2, 0.2],
      glowColor: [0.95, 0.95, 0.95],
      markerElevation: 0,
      opacity: 0.7,
      markers: STICKER_MARKERS.map((m) => ({
        location: m.location,
        size: 0.03,
        id: m.id,
      })),
      arcs: COLLABORATION_ARCS.map((a) => ({
        from: a.from,
        to: a.to,
        color: a.color,
      })),
      arcWidth: 0.4,
      arcHeight: 0.2,
    })

    let animationId: number
    let frame = 0
    function animate() {
      frame++
      if (!pointerDown.current) {
        if (Math.abs(dragVelocity.current) > 0.0001) {
          phiRef.current += dragVelocity.current
          dragVelocity.current *= 0.95
        } else {
          dragVelocity.current = 0
          phiRef.current += autoRotateSpeed
        }
      }
      const arcHeight = 0.15 + Math.sin(frame * 0.015) * 0.1
      globe.update({ phi: phiRef.current, arcHeight })
      animationId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(animationId)
      container.removeEventListener('pointerdown', onDown)
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('pointerleave', onUp)
      globe.destroy()
    }
  }, [])

  return (
    <div ref={containerRef} className="relative w-full cursor-grab active:cursor-grabbing" style={{ aspectRatio: '1', touchAction: 'none' }}>
      {/* SVG filter for sticker white outline */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="sticker-outline">
            <feMorphology in="SourceAlpha" result="Dilated" operator="dilate" radius="2" />
            <feFlood floodColor="#ffffff" result="OutlineColor" />
            <feComposite in="OutlineColor" in2="Dilated" operator="in" result="Outline" />
            <feMerge>
              <feMergeNode in="Outline" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      <canvas
        ref={canvasRef}
        className="w-full h-full"
      />

      {/* Emoji stickers anchored to globe markers */}
      {STICKER_MARKERS.map((m, i) => (
        <div
          key={m.id}
          className="absolute pointer-events-none"
          style={{
            positionAnchor: `--cobe-${m.id}`,
            bottom: 'anchor(top)',
            left: 'anchor(center)',
            translate: '-50% 0',
            opacity: `var(--cobe-visible-${m.id}, 0)`,
            fontSize: '1.6rem',
            lineHeight: 1,
            transform: `rotate(${i % 3 === 0 ? -8 : i % 4 === 0 ? 6 : i % 5 === 0 ? 10 : -4}deg)`,
            filter: 'url(#sticker-outline) drop-shadow(0 2px 3px rgba(0,0,0,0.15))',
            transition: 'opacity 0.2s',
          } as React.CSSProperties}
        >
          {m.sticker}
        </div>
      ))}
    </div>
  )
}
