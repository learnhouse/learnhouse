'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wand2 } from 'lucide-react'
import * as Y from 'yjs'
import type { HocuspocusProvider } from '@hocuspocus/provider'

interface BoardEffectsProps {
  ydoc: Y.Doc | null
  provider: HocuspocusProvider | null
}

interface EffectEvent {
  id: string
  type: string
  username: string
  timestamp: number
}

const EFFECT_LIFETIME = 6000
const EFFECT_COOLDOWN = 3000

// ─── Effect definitions ──────────────────────────────────────────────────────

const PAGE_EFFECTS = [
  { id: 'inferno', label: 'boards.effects.inferno', icon: '🌋' },
  { id: 'blizzard', label: 'boards.effects.blizzard', icon: '🏔️' },
  { id: 'matrix', label: 'boards.effects.matrix', icon: '💊' },
  { id: 'fireworks', label: 'boards.effects.fireworks', icon: '🎆' },
  { id: 'earthquake', label: 'boards.effects.earthquake', icon: '💥' },
  { id: 'blackhole', label: 'boards.effects.black_hole', icon: '🕳️' },
  { id: 'aurora', label: 'boards.effects.aurora', icon: '🌌' },
  { id: 'lightning', label: 'boards.effects.lightning', icon: '⚡' },
  { id: 'glitch', label: 'boards.effects.glitch', icon: '📺' },
  { id: 'nuke', label: 'boards.effects.nuke', icon: '☢️' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createOverlay(): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'board-effect-overlay'
  Object.assign(container.style, {
    position: 'fixed', inset: '0', zIndex: '9998',
    pointerEvents: 'none', overflow: 'hidden',
  })
  document.body.appendChild(container)
  return container
}

function addTint(container: HTMLDivElement, css: string, anim?: string) {
  const tint = document.createElement('div')
  Object.assign(tint.style, {
    position: 'absolute', inset: '0', background: css,
    ...(anim ? { animation: anim } : {}),
  })
  container.appendChild(tint)
  return tint
}

function shakeBoard(duration = 2500, intensity = 4) {
  const board = document.querySelector('.board-effect-shake-target') as HTMLElement
  if (!board) return
  board.style.setProperty('--shake-intensity', `${intensity}px`)
  board.classList.add('board-shaking')
  setTimeout(() => board.classList.remove('board-shaking'), duration)
}

// ─── INFERNO ─────────────────────────────────────────────────────────────────
// Intense wall of fire rising from bottom, heavy red/orange tint pulsing,
// heat distortion via blur, embers + sparks flying everywhere

function spawnInferno() {
  const container = createOverlay()

  // Intense pulsing red tint covering whole screen
  addTint(container,
    'linear-gradient(0deg, rgba(255,30,0,0.35) 0%, rgba(255,80,0,0.18) 40%, rgba(255,120,0,0.06) 70%, transparent 100%)',
    'inferno-pulse 0.4s ease-in-out infinite alternate'
  )

  // Second layer — flickering orange glow
  addTint(container,
    'radial-gradient(ellipse 120% 60% at 50% 100%, rgba(255,100,0,0.3) 0%, transparent 70%)',
    'inferno-flicker 0.2s ease-in-out infinite alternate'
  )

  // Fire wall — dense particles from bottom
  for (let i = 0; i < 120; i++) {
    const el = document.createElement('div')
    const x = Math.random() * 100
    const delay = Math.random() * 2000
    const duration = 1200 + Math.random() * 1800
    const size = 8 + Math.random() * 24
    const drift = (Math.random() - 0.5) * 80

    // Mix of glowing circles and fire-colored dots
    const isEmber = Math.random() > 0.5
    if (isEmber) {
      const emberColor = `hsl(${Math.random() * 40 + 10}, 100%, ${50 + Math.random() * 30}%)`
      Object.assign(el.style, {
        position: 'absolute', left: `${x}%`, bottom: '-20px',
        width: `${size * 0.4}px`, height: `${size * 0.4}px`,
        borderRadius: '50%',
        background: emberColor,
        boxShadow: `0 0 ${size}px ${size * 0.5}px ${emberColor}`,
        opacity: '0',
        animation: `effect-rise ${duration}ms ${delay}ms ease-out forwards`,
        '--drift': `${drift}px`,
      } as any)
    } else {
      const colors = ['#ff4400', '#ff6600', '#ff8800', '#ffaa00', '#ffcc00']
      Object.assign(el.style, {
        position: 'absolute', left: `${x}%`, bottom: '-20px',
        width: `${size}px`, height: `${size * 1.4}px`,
        borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
        background: `radial-gradient(ellipse, ${colors[Math.floor(Math.random() * colors.length)]} 0%, transparent 70%)`,
        filter: 'blur(2px)',
        opacity: '0',
        animation: `effect-rise ${duration}ms ${delay}ms ease-out forwards`,
        '--drift': `${drift}px`,
      } as any)
    }
    container.appendChild(el)
  }

  // Top-edge heat shimmer
  const shimmer = document.createElement('div')
  Object.assign(shimmer.style, {
    position: 'absolute', inset: '0',
    backdropFilter: 'blur(0.5px)',
    animation: 'inferno-shimmer 0.3s ease-in-out infinite alternate',
  })
  container.appendChild(shimmer)

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

// ─── BLIZZARD ────────────────────────────────────────────────────────────────
// Whiteout conditions — heavy snow, wind, frost overlay, visibility drop

function spawnBlizzard() {
  const container = createOverlay()

  // Heavy frost/whiteout tint
  addTint(container,
    'linear-gradient(180deg, rgba(200,225,255,0.25) 0%, rgba(220,240,255,0.15) 50%, rgba(200,220,255,0.2) 100%)',
    'blizzard-whiteout 1s ease-in-out infinite alternate'
  )

  // Frost edges — vignette
  addTint(container,
    'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(180,210,255,0.3) 100%)',
  )

  // Dense snow — 150 particles with strong wind
  for (let i = 0; i < 150; i++) {
    const el = document.createElement('div')
    const x = -10 + Math.random() * 120
    const delay = Math.random() * 3000
    const duration = 1500 + Math.random() * 2000
    const size = 3 + Math.random() * 12
    const drift = 60 + Math.random() * 200 // strong rightward wind

    // Mix of dots and unicode snowflakes
    const isFlake = Math.random() > 0.6
    if (isFlake) {
      const flakes = ['❄', '❅', '❆']
      el.textContent = flakes[Math.floor(Math.random() * flakes.length)]
      Object.assign(el.style, {
        position: 'absolute', left: `${x}%`, top: '-30px',
        fontSize: `${size + 8}px`,
        color: `rgba(255,255,255,${0.5 + Math.random() * 0.5})`,
        textShadow: '0 0 6px rgba(180,220,255,0.8)',
        opacity: '0',
        animation: `effect-blizzard ${duration}ms ${delay}ms linear forwards`,
        '--drift': `${drift}px`,
        '--wobble': `${(Math.random() - 0.5) * 40}px`,
      } as any)
    } else {
      Object.assign(el.style, {
        position: 'absolute', left: `${x}%`, top: '-10px',
        width: `${size}px`, height: `${size}px`,
        borderRadius: '50%',
        background: `rgba(255,255,255,${0.4 + Math.random() * 0.5})`,
        boxShadow: `0 0 ${size}px rgba(200,230,255,0.5)`,
        filter: `blur(${Math.random() > 0.7 ? 2 : 0}px)`,
        opacity: '0',
        animation: `effect-blizzard ${duration}ms ${delay}ms linear forwards`,
        '--drift': `${drift}px`,
        '--wobble': `${(Math.random() - 0.5) * 30}px`,
      } as any)
    }
    container.appendChild(el)
  }

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

// ─── MATRIX ──────────────────────────────────────────────────────────────────
// Full digital rain — screen goes dark, green characters stream, glitch flashes

function spawnMatrix() {
  const container = createOverlay()

  // Dark overlay — screen dims dramatically
  addTint(container, 'rgba(0,0,0,0.75)', 'matrix-darken 0.6s ease-out forwards')

  // Scanlines
  const scanlines = document.createElement('div')
  Object.assign(scanlines.style, {
    position: 'absolute', inset: '0',
    background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.03) 2px, rgba(0,255,65,0.03) 4px)',
    animation: 'matrix-scan 4s linear infinite',
  })
  container.appendChild(scanlines)

  // Green glow from center
  addTint(container, 'radial-gradient(ellipse at 50% 50%, rgba(0,255,65,0.08) 0%, transparent 60%)')

  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン01234567890123456789ABCDEF'
  const colCount = Math.floor(window.innerWidth / 20)

  for (let col = 0; col < colCount; col++) {
    const x = (col / colCount) * 100
    const colDelay = Math.random() * 2000
    const speed = 2000 + Math.random() * 2000
    const len = 8 + Math.floor(Math.random() * 16)

    for (let j = 0; j < len; j++) {
      const el = document.createElement('div')
      el.textContent = chars[Math.floor(Math.random() * chars.length)]
      const charDelay = colDelay + j * 60

      const brightness = j === 0 ? 1 : Math.max(0.1, 1 - j * 0.07)
      const isHead = j === 0

      Object.assign(el.style, {
        position: 'absolute', left: `${x}%`, top: '-20px',
        fontSize: `${13 + Math.random() * 5}px`,
        fontFamily: '"Courier New", monospace',
        fontWeight: isHead ? 'bold' : 'normal',
        color: isHead ? '#ffffff' : `rgba(0, ${Math.floor(180 + Math.random() * 75)}, ${Math.floor(20 + Math.random() * 40)}, ${brightness})`,
        textShadow: isHead ? '0 0 12px #00ff41, 0 0 24px #00ff41' : `0 0 4px rgba(0,255,65,${brightness * 0.5})`,
        opacity: '0',
        animation: `matrix-fall ${speed}ms ${charDelay}ms linear forwards`,
      } as any)
      container.appendChild(el)
    }
  }

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

// ─── FIREWORKS ───────────────────────────────────────────────────────────────
// Multiple dramatic bursts with trails, glowing cores, sparkle tails

function spawnFireworks() {
  const container = createOverlay()

  // Darken sky
  addTint(container, 'rgba(0,0,10,0.4)', 'matrix-darken 0.3s ease-out forwards')

  const colors = ['#ff2d2d', '#ff8c00', '#00d4ff', '#ff44ff', '#44ff44', '#ffd700', '#ff4488', '#8844ff', '#00ffaa']

  for (let burst = 0; burst < 8; burst++) {
    const cx = 10 + Math.random() * 80
    const cy = 10 + Math.random() * 55
    const burstDelay = burst * 500 + Math.random() * 300
    const burstColor = colors[Math.floor(Math.random() * colors.length)]
    const particleCount = 40 + Math.floor(Math.random() * 30)

    // Rising trail before burst
    const trail = document.createElement('div')
    Object.assign(trail.style, {
      position: 'absolute',
      left: `${cx}%`, bottom: '0',
      width: '3px', height: '3px',
      borderRadius: '50%',
      background: '#fff',
      boxShadow: `0 0 6px #fff, 0 0 12px ${burstColor}`,
      animation: `firework-trail ${burstDelay + 300}ms ease-out forwards`,
      '--target-y': `${cy}vh`,
    } as any)
    container.appendChild(trail)

    // Core flash — big dramatic glow
    const flash = document.createElement('div')
    Object.assign(flash.style, {
      position: 'absolute',
      left: `${cx}%`, top: `${cy}%`,
      width: '8px', height: '8px',
      borderRadius: '50%',
      background: 'white',
      boxShadow: `0 0 60px 30px ${burstColor}, 0 0 120px 60px ${burstColor}66, 0 0 200px 80px ${burstColor}33`,
      opacity: '0',
      transform: 'translate(-50%, -50%)',
      animation: `firework-flash 500ms ${burstDelay + 300}ms ease-out forwards`,
    })
    container.appendChild(flash)

    // Particles — explode outward
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const dist = 100 + Math.random() * 220
      const dx = Math.cos(angle) * dist
      const dy = Math.sin(angle) * dist + 40
      const size = 2 + Math.random() * 4
      const pColor = Math.random() > 0.2 ? burstColor : colors[Math.floor(Math.random() * colors.length)]

      const p = document.createElement('div')
      Object.assign(p.style, {
        position: 'absolute',
        left: `${cx}%`, top: `${cy}%`,
        width: `${size}px`, height: `${size}px`,
        borderRadius: '50%',
        background: pColor,
        boxShadow: `0 0 ${size * 2}px ${pColor}, 0 0 ${size * 4}px ${pColor}66`,
        opacity: '0',
        animation: `firework-particle 1400ms ${burstDelay + 350}ms ease-out forwards`,
        '--dx': `${dx}px`,
        '--dy': `${dy}px`,
      } as any)
      container.appendChild(p)
    }

    // Sparkle trails — smaller secondary particles
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = 40 + Math.random() * 100
      const dx = Math.cos(angle) * dist
      const dy = Math.sin(angle) * dist + 60

      const s = document.createElement('div')
      Object.assign(s.style, {
        position: 'absolute',
        left: `${cx}%`, top: `${cy}%`,
        width: '2px', height: '2px',
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 0 4px #fff',
        opacity: '0',
        animation: `firework-particle 2000ms ${burstDelay + 600}ms ease-out forwards`,
        '--dx': `${dx}px`,
        '--dy': `${dy}px`,
      } as any)
      container.appendChild(s)
    }
  }

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

// ─── EARTHQUAKE ──────────────────────────────────────────────────────────────
// Violent screen shake, cracks appear, debris flies, screen flickers

function spawnEarthquake() {
  const container = createOverlay()

  shakeBoard(3000, 6)

  // Red danger flash
  const flash = document.createElement('div')
  Object.assign(flash.style, {
    position: 'absolute', inset: '0',
    background: 'rgba(255,0,0,0.15)',
    animation: 'quake-flash 0.3s ease-in-out 8 alternate',
  })
  container.appendChild(flash)

  // Crack lines across screen
  for (let i = 0; i < 12; i++) {
    const crack = document.createElement('div')
    const x = Math.random() * 100
    const y = Math.random() * 100
    const angle = Math.random() * 360
    const len = 100 + Math.random() * 300
    const delay = Math.random() * 1500

    Object.assign(crack.style, {
      position: 'absolute',
      left: `${x}%`, top: `${y}%`,
      width: `${len}px`, height: '2px',
      background: 'linear-gradient(90deg, transparent, rgba(100,80,60,0.6), rgba(60,40,20,0.8), rgba(100,80,60,0.6), transparent)',
      transform: `rotate(${angle}deg)`,
      transformOrigin: 'left center',
      opacity: '0',
      animation: `quake-crack 600ms ${delay}ms ease-out forwards`,
    })
    container.appendChild(crack)
  }

  // Flying debris chunks
  for (let i = 0; i < 50; i++) {
    const el = document.createElement('div')
    const startX = Math.random() * 100
    const size = 4 + Math.random() * 12
    const delay = Math.random() * 2000
    const duration = 1000 + Math.random() * 1500
    const drift = (Math.random() - 0.5) * 200

    Object.assign(el.style, {
      position: 'absolute',
      left: `${startX}%`, bottom: '0',
      width: `${size}px`, height: `${size}px`,
      borderRadius: Math.random() > 0.5 ? '2px' : '50%',
      background: `hsl(${20 + Math.random() * 20}, ${20 + Math.random() * 30}%, ${30 + Math.random() * 30}%)`,
      opacity: '0',
      animation: `effect-rise ${duration}ms ${delay}ms ease-out forwards`,
      '--drift': `${drift}px`,
    } as any)
    container.appendChild(el)
  }

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

// ─── BLACK HOLE ──────────────────────────────────────────────────────────────
// Everything gets pulled to center, spiraling vortex, space distortion

function spawnBlackhole() {
  const container = createOverlay()

  // Dark vignette closing in
  addTint(container,
    'radial-gradient(circle at 50% 50%, transparent 0%, transparent 10%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.9) 100%)',
    'blackhole-collapse 3s ease-in forwards'
  )

  // Central singularity glow
  const core = document.createElement('div')
  Object.assign(core.style, {
    position: 'absolute',
    left: '50%', top: '50%',
    width: '20px', height: '20px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, #000 40%, #4400aa 70%, transparent 100%)',
    boxShadow: '0 0 60px 20px rgba(100,0,255,0.5), 0 0 120px 40px rgba(100,0,255,0.2), inset 0 0 20px rgba(0,0,0,1)',
    transform: 'translate(-50%, -50%) scale(0)',
    animation: 'blackhole-core 3s ease-out forwards',
  })
  container.appendChild(core)

  // Accretion disk — ring of light
  const disk = document.createElement('div')
  Object.assign(disk.style, {
    position: 'absolute',
    left: '50%', top: '50%',
    width: '300px', height: '300px',
    borderRadius: '50%',
    border: '3px solid transparent',
    borderTopColor: 'rgba(255,150,50,0.6)',
    borderRightColor: 'rgba(200,100,255,0.4)',
    boxShadow: '0 0 40px rgba(255,150,50,0.3), inset 0 0 40px rgba(100,0,255,0.2)',
    transform: 'translate(-50%, -50%) scale(0)',
    animation: 'blackhole-disk 4s ease-out forwards, blackhole-spin 2s linear infinite',
  })
  container.appendChild(disk)

  // Debris particles spiraling inward
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div')
    const angle = Math.random() * 360
    const startDist = 400 + Math.random() * 600
    const startX = 50 + Math.cos(angle * Math.PI / 180) * startDist / window.innerWidth * 100
    const startY = 50 + Math.sin(angle * Math.PI / 180) * startDist / window.innerHeight * 100
    const delay = Math.random() * 2500
    const duration = 2000 + Math.random() * 2000
    const size = 2 + Math.random() * 6

    const hue = Math.random() > 0.5 ? `hsl(${270 + Math.random() * 40}, 80%, ${50 + Math.random() * 30}%)` : `hsl(${20 + Math.random() * 30}, 100%, ${50 + Math.random() * 30}%)`

    Object.assign(el.style, {
      position: 'absolute',
      left: `${startX}%`, top: `${startY}%`,
      width: `${size}px`, height: `${size}px`,
      borderRadius: '50%',
      background: hue,
      boxShadow: `0 0 ${size * 2}px ${hue}`,
      opacity: '0',
      animation: `blackhole-pull ${duration}ms ${delay}ms ease-in forwards`,
    } as any)
    container.appendChild(el)
  }

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

// ─── AURORA ──────────────────────────────────────────────────────────────────
// Dramatic northern lights filling the sky — ribbons of color sweeping across

function spawnAurora() {
  const container = createOverlay()

  // Dark sky
  addTint(container, 'rgba(0,5,20,0.4)', 'matrix-darken 0.5s ease-out forwards')

  // Multiple aurora ribbon layers
  const ribbonColors = [
    { h1: 'rgba(0,255,130,0.25)', h2: 'rgba(0,200,255,0.15)' },
    { h1: 'rgba(100,0,255,0.2)', h2: 'rgba(0,255,180,0.15)' },
    { h1: 'rgba(0,200,100,0.2)', h2: 'rgba(255,0,150,0.12)' },
    { h1: 'rgba(0,150,255,0.2)', h2: 'rgba(100,255,0,0.15)' },
    { h1: 'rgba(200,0,255,0.18)', h2: 'rgba(0,255,255,0.12)' },
  ]

  for (let r = 0; r < ribbonColors.length; r++) {
    const ribbon = document.createElement('div')
    const yPos = 5 + r * 12 + Math.random() * 10
    const delay = r * 400

    Object.assign(ribbon.style, {
      position: 'absolute',
      left: '-20%', top: `${yPos}%`,
      width: '140%', height: `${60 + Math.random() * 80}px`,
      background: `linear-gradient(90deg, transparent 0%, ${ribbonColors[r].h1} 20%, ${ribbonColors[r].h2} 50%, ${ribbonColors[r].h1} 80%, transparent 100%)`,
      filter: `blur(${20 + Math.random() * 20}px)`,
      borderRadius: '50%',
      opacity: '0',
      animation: `aurora-ribbon ${4000 + Math.random() * 2000}ms ${delay}ms ease-in-out forwards`,
      '--sway': `${(Math.random() - 0.5) * 15}%`,
    } as any)
    container.appendChild(ribbon)
  }

  // Shimmering star particles
  for (let i = 0; i < 40; i++) {
    const star = document.createElement('div')
    const x = Math.random() * 100
    const y = Math.random() * 60
    const size = 1 + Math.random() * 3
    const delay = Math.random() * 3000

    Object.assign(star.style, {
      position: 'absolute',
      left: `${x}%`, top: `${y}%`,
      width: `${size}px`, height: `${size}px`,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: `0 0 ${size * 2}px rgba(200,255,200,0.8)`,
      animation: `aurora-star ${1500 + Math.random() * 1500}ms ${delay}ms ease-in-out infinite alternate`,
    })
    container.appendChild(star)
  }

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

// ─── LIGHTNING ────────────────────────────────────────────────────────────────
// Multiple dramatic lightning strikes with flash, thunder shake, afterglow

function spawnLightning() {
  const container = createOverlay()

  const strikes = 5 + Math.floor(Math.random() * 3)

  for (let s = 0; s < strikes; s++) {
    const delay = s * 600 + Math.random() * 500
    const x = 15 + Math.random() * 70

    // White flash — entire screen
    const flash = document.createElement('div')
    Object.assign(flash.style, {
      position: 'absolute', inset: '0',
      background: `radial-gradient(ellipse at ${x}% 0%, rgba(255,255,255,0.9) 0%, rgba(200,220,255,0.4) 30%, transparent 60%)`,
      opacity: '0',
      animation: `lightning-flash 250ms ${delay}ms ease-out forwards`,
    })
    container.appendChild(flash)

    // Lightning bolt — jagged SVG path
    const bolt = document.createElement('div')
    const boltPath = generateLightningPath(x)
    bolt.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0">
      <path d="${boltPath}" fill="none" stroke="white" stroke-width="0.4" filter="url(#glow-${s})" opacity="0" style="animation: lightning-bolt 400ms ${delay + 50}ms ease-out forwards"/>
      <path d="${boltPath}" fill="none" stroke="rgba(180,200,255,0.6)" stroke-width="1.2" opacity="0" style="animation: lightning-bolt 500ms ${delay + 50}ms ease-out forwards"/>
      <defs><filter id="glow-${s}"><feGaussianBlur stdDeviation="0.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    </svg>`
    Object.assign(bolt.style, { position: 'absolute', inset: '0' })
    container.appendChild(bolt)

    // Shake on each strike
    if (s < 3) {
      setTimeout(() => shakeBoard(300, 3), delay)
    }
  }

  // Rumble — low intensity sustained shake
  setTimeout(() => shakeBoard(1500, 2), 800)

  // Afterglow ambient
  const afterglow = document.createElement('div')
  Object.assign(afterglow.style, {
    position: 'absolute', inset: '0',
    background: 'rgba(180,200,255,0.06)',
    animation: 'blizzard-whiteout 0.5s ease-in-out 6 alternate',
  })
  container.appendChild(afterglow)

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

function generateLightningPath(startX: number): string {
  let x = startX, y = 0
  let path = `M ${x} ${y}`
  const segments = 8 + Math.floor(Math.random() * 6)
  for (let i = 0; i < segments; i++) {
    x += (Math.random() - 0.5) * 15
    y += (100 / segments) * (0.7 + Math.random() * 0.6)
    x = Math.max(5, Math.min(95, x))
    y = Math.min(100, y)
    path += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
    // Branch
    if (Math.random() > 0.6) {
      const bx = x + (Math.random() - 0.5) * 20
      const by = y + 5 + Math.random() * 10
      path += ` M ${x.toFixed(1)} ${y.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)} M ${x.toFixed(1)} ${y.toFixed(1)}`
    }
  }
  return path
}

// ─── GLITCH ──────────────────────────────────────────────────────────────────
// Screen tears, color channel separation, static noise, random flickers

function spawnGlitch() {
  const container = createOverlay()

  // Persistent noise layer
  const noise = document.createElement('canvas')
  noise.width = 200
  noise.height = 200
  Object.assign(noise.style, {
    position: 'absolute', inset: '0',
    width: '100%', height: '100%',
    opacity: '0.08',
    mixBlendMode: 'overlay',
    imageRendering: 'pixelated',
  })
  const ctx = noise.getContext('2d')!
  const drawNoise = () => {
    const img = ctx.createImageData(200, 200)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }
  drawNoise()
  container.appendChild(noise)
  const noiseInterval = setInterval(drawNoise, 80)

  // Screen tear slices
  for (let wave = 0; wave < 6; wave++) {
    const waveDelay = wave * 700 + Math.random() * 300

    for (let i = 0; i < 8; i++) {
      const slice = document.createElement('div')
      const y = Math.random() * 100
      const h = 2 + Math.random() * 8
      const shiftX = (Math.random() - 0.5) * 30

      Object.assign(slice.style, {
        position: 'absolute',
        left: '0', right: '0',
        top: `${y}%`,
        height: `${h}px`,
        background: `linear-gradient(90deg, rgba(255,0,0,0.15) 33%, rgba(0,255,0,0.15) 33% 66%, rgba(0,0,255,0.15) 66%)`,
        transform: `translateX(${shiftX}px)`,
        opacity: '0',
        animation: `glitch-slice 200ms ${waveDelay + i * 40}ms ease-out forwards`,
      })
      container.appendChild(slice)
    }

    // Full-screen color flash
    const flashColor = ['rgba(255,0,0,0.1)', 'rgba(0,255,0,0.1)', 'rgba(0,0,255,0.12)', 'rgba(255,0,255,0.08)'][Math.floor(Math.random() * 4)]
    const flash = document.createElement('div')
    Object.assign(flash.style, {
      position: 'absolute', inset: '0',
      background: flashColor,
      opacity: '0',
      animation: `glitch-flash 150ms ${waveDelay}ms ease-out forwards`,
    })
    container.appendChild(flash)
  }

  // RGB split text
  const board = document.querySelector('.board-effect-shake-target') as HTMLElement
  if (board) {
    board.style.filter = 'none'
    let glitchFrame = 0
    const glitchInterval = setInterval(() => {
      glitchFrame++
      if (glitchFrame % 3 === 0) {
        const offset = 2 + Math.random() * 4
        board.style.textShadow = `${offset}px 0 rgba(255,0,0,0.5), -${offset}px 0 rgba(0,255,255,0.5)`
      } else {
        board.style.textShadow = 'none'
      }
      if (glitchFrame > 40) {
        clearInterval(glitchInterval)
        board.style.textShadow = 'none'
        board.style.filter = 'none'
      }
    }, 100)
  }

  setTimeout(() => { container.remove(); clearInterval(noiseInterval) }, EFFECT_LIFETIME)
}

// ─── NUKE ────────────────────────────────────────────────────────────────────
// Blinding white flash, massive shockwave ring expanding outward, everything shakes,
// mushroom cloud debris, screen goes dark then slowly recovers

function spawnNuke() {
  const container = createOverlay()

  // Phase 1: Blinding white flash (0-800ms)
  const whiteout = document.createElement('div')
  Object.assign(whiteout.style, {
    position: 'absolute', inset: '0',
    background: 'white',
    opacity: '0',
    animation: 'nuke-flash 3s ease-out forwards',
  })
  container.appendChild(whiteout)

  // Phase 2: Shockwave ring (300ms+)
  for (let ring = 0; ring < 3; ring++) {
    const wave = document.createElement('div')
    Object.assign(wave.style, {
      position: 'absolute',
      left: '50%', top: '50%',
      width: '10px', height: '10px',
      borderRadius: '50%',
      border: `${3 - ring}px solid rgba(255,${150 + ring * 50},0,${0.6 - ring * 0.15})`,
      boxShadow: `0 0 ${40 - ring * 10}px rgba(255,${100 + ring * 50},0,${0.4 - ring * 0.1}), inset 0 0 ${20 - ring * 5}px rgba(255,200,0,0.2)`,
      transform: 'translate(-50%, -50%) scale(0)',
      animation: `nuke-shockwave ${2000 + ring * 400}ms ${300 + ring * 200}ms ease-out forwards`,
    })
    container.appendChild(wave)
  }

  // Massive shake
  setTimeout(() => shakeBoard(3000, 8), 200)

  // Phase 3: Debris cloud (500ms+)
  for (let i = 0; i < 100; i++) {
    const el = document.createElement('div')
    const angle = Math.random() * Math.PI * 2
    const dist = 200 + Math.random() * 500
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist
    const size = 3 + Math.random() * 10
    const delay = 400 + Math.random() * 1000

    const hue = Math.random() > 0.4
      ? `hsl(${20 + Math.random() * 30}, 100%, ${40 + Math.random() * 30}%)`
      : `rgba(${80 + Math.random() * 100}, ${60 + Math.random() * 60}, ${40 + Math.random() * 40}, 0.8)`

    Object.assign(el.style, {
      position: 'absolute',
      left: '50%', top: '50%',
      width: `${size}px`, height: `${size}px`,
      borderRadius: Math.random() > 0.3 ? '50%' : '2px',
      background: hue,
      boxShadow: Math.random() > 0.5 ? `0 0 ${size * 2}px ${hue}` : 'none',
      opacity: '0',
      animation: `firework-particle ${1500 + Math.random() * 1500}ms ${delay}ms ease-out forwards`,
      '--dx': `${dx}px`,
      '--dy': `${dy}px`,
    } as any)
    container.appendChild(el)
  }

  // Mushroom stem — vertical column of fire
  const stem = document.createElement('div')
  Object.assign(stem.style, {
    position: 'absolute',
    left: '50%', bottom: '0',
    width: '80px', height: '0',
    transform: 'translateX(-50%)',
    background: 'linear-gradient(0deg, rgba(255,100,0,0.4) 0%, rgba(255,200,0,0.2) 50%, transparent 100%)',
    filter: 'blur(10px)',
    animation: 'nuke-stem 2s 300ms ease-out forwards',
  })
  container.appendChild(stem)

  setTimeout(() => container.remove(), EFFECT_LIFETIME)
}

// ─── Effect map ──────────────────────────────────────────────────────────────

const EFFECT_MAP: Record<string, () => void> = {
  inferno: spawnInferno,
  blizzard: spawnBlizzard,
  matrix: spawnMatrix,
  fireworks: spawnFireworks,
  earthquake: spawnEarthquake,
  blackhole: spawnBlackhole,
  aurora: spawnAurora,
  lightning: spawnLightning,
  glitch: spawnGlitch,
  nuke: spawnNuke,
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BoardEffects({ ydoc, provider }: BoardEffectsProps) {
  const { t } = useTranslation()
  const [showPicker, setShowPicker] = useState(false)
  const lastTriggeredRef = useRef(0)
  const seenIdsRef = useRef(new Set<string>())

  // Listen for effect events
  useEffect(() => {
    if (!ydoc) return
    const effectsArray = ydoc.getArray<EffectEvent>('board-effects')

    const observer = () => {
      const events = effectsArray.toArray()
      const now = Date.now()

      for (const ev of events) {
        if (seenIdsRef.current.has(ev.id)) continue
        if (now - ev.timestamp > EFFECT_LIFETIME) continue
        seenIdsRef.current.add(ev.id)

        if (EFFECT_MAP[ev.type]) {
          EFFECT_MAP[ev.type]()
        }
      }
    }

    effectsArray.observe(observer)
    observer()
    return () => effectsArray.unobserve(observer)
  }, [ydoc])

  // Clean up old effects from Yjs
  useEffect(() => {
    const timer = setInterval(() => {
      if (!ydoc) return
      const effectsArray = ydoc.getArray<EffectEvent>('board-effects')
      const now = Date.now()
      for (let i = effectsArray.length - 1; i >= 0; i--) {
        if (now - effectsArray.get(i).timestamp > EFFECT_LIFETIME * 2) {
          effectsArray.delete(i, 1)
        }
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [ydoc])

  const triggerEffect = useCallback((type: string) => {
    if (!ydoc || !provider) return
    const now = Date.now()
    if (now - lastTriggeredRef.current < EFFECT_COOLDOWN) return
    lastTriggeredRef.current = now

    const awareness = provider.awareness
    const localState = awareness?.getLocalState()

    const effectsArray = ydoc.getArray<EffectEvent>('board-effects')
    effectsArray.push([{
      id: `${now}-${awareness?.clientID || 0}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      username: localState?.user?.name || 'Anonymous',
      timestamp: now,
    }])

    setShowPicker(false)
  }, [ydoc, provider])

  const frostedStyle = {
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  }

  return (
    <>
      {/* CSS for all effects */}
      <style jsx global>{`
        @keyframes effect-rise {
          0% { opacity: 0.9; transform: translateY(0) translateX(0) scale(1); }
          60% { opacity: 0.6; }
          100% { opacity: 0; transform: translateY(-110vh) translateX(var(--drift, 0px)) scale(0.3); }
        }
        @keyframes inferno-pulse {
          0% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        @keyframes inferno-flicker {
          0% { opacity: 0.3; transform: scaleY(0.95); }
          100% { opacity: 1; transform: scaleY(1.05); }
        }
        @keyframes inferno-shimmer {
          0% { backdrop-filter: blur(0.5px); }
          100% { backdrop-filter: blur(1.5px); }
        }
        @keyframes effect-blizzard {
          0% { opacity: 0; transform: translateY(0) translateX(0); }
          8% { opacity: 0.9; }
          50% { transform: translateY(50vh) translateX(calc(var(--drift, 60px) * 0.6 + var(--wobble, 0px))); }
          80% { opacity: 0.5; }
          100% { opacity: 0; transform: translateY(110vh) translateX(var(--drift, 60px)); }
        }
        @keyframes blizzard-whiteout {
          0% { opacity: 0.3; }
          100% { opacity: 1; }
        }
        @keyframes matrix-darken {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes matrix-fall {
          0% { opacity: 1; transform: translateY(0); }
          85% { opacity: 0.8; }
          100% { opacity: 0; transform: translateY(110vh); }
        }
        @keyframes matrix-scan {
          0% { background-position: 0 0; }
          100% { background-position: 0 100vh; }
        }
        @keyframes firework-trail {
          0% { opacity: 1; transform: translateY(0); }
          80% { opacity: 0.8; }
          100% { opacity: 0; transform: translateY(calc(-1 * var(--target-y, 50vh))); }
        }
        @keyframes firework-flash {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(2.5); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(4); }
        }
        @keyframes firework-particle {
          0% { opacity: 1; transform: translate(0, 0) scale(1); }
          60% { opacity: 0.9; }
          100% { opacity: 0; transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(0.1); }
        }
        @keyframes quake-flash {
          0% { opacity: 0; }
          50% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes quake-crack {
          0% { opacity: 0; width: 0; }
          40% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        @keyframes effect-quake-pop {
          0% { opacity: 0; transform: scale(0.3) rotate(0deg); }
          30% { opacity: 1; transform: scale(1.3) rotate(10deg); }
          100% { opacity: 0; transform: scale(0.6) rotate(-5deg); }
        }
        .board-shaking {
          animation: board-shake 0.12s ease-in-out infinite;
        }
        @keyframes board-shake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(calc(var(--shake-intensity, 4px) * -1), calc(var(--shake-intensity, 4px) * 0.5)); }
          40% { transform: translate(calc(var(--shake-intensity, 4px) * 0.8), calc(var(--shake-intensity, 4px) * -0.7)); }
          60% { transform: translate(calc(var(--shake-intensity, 4px) * -0.5), var(--shake-intensity, 4px)); }
          80% { transform: translate(calc(var(--shake-intensity, 4px) * 0.6), calc(var(--shake-intensity, 4px) * -0.4)); }
        }
        @keyframes blackhole-collapse {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes blackhole-core {
          0% { transform: translate(-50%, -50%) scale(0); }
          60% { transform: translate(-50%, -50%) scale(3); }
          100% { transform: translate(-50%, -50%) scale(2.5); }
        }
        @keyframes blackhole-disk {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
          40% { opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0.6; }
        }
        @keyframes blackhole-spin {
          from { rotate: 0deg; }
          to { rotate: 360deg; }
        }
        @keyframes blackhole-pull {
          0% { opacity: 0.8; transform: translate(0, 0) scale(1); }
          80% { opacity: 0.6; }
          100% { opacity: 0; transform: translate(calc(50vw - 50vw), calc(50vh - 50vh)) scale(0); left: 50%; top: 50%; }
        }
        @keyframes aurora-ribbon {
          0% { opacity: 0; transform: translateX(-10%) translateY(0) scaleY(0.5); }
          20% { opacity: 0.8; transform: translateX(0%) translateY(0) scaleY(1); }
          50% { opacity: 1; transform: translateX(var(--sway, 5%)) translateY(-10px) scaleY(1.2); }
          80% { opacity: 0.7; transform: translateX(calc(var(--sway, 5%) * -0.5)) translateY(5px) scaleY(0.9); }
          100% { opacity: 0; transform: translateX(10%) translateY(0) scaleY(0.5); }
        }
        @keyframes aurora-star {
          0% { opacity: 0.2; transform: scale(0.5); }
          100% { opacity: 1; transform: scale(1.5); }
        }
        @keyframes lightning-flash {
          0% { opacity: 0; }
          10% { opacity: 1; }
          30% { opacity: 0.8; }
          50% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes lightning-bolt {
          0% { opacity: 0; stroke-width: 0.8; }
          10% { opacity: 1; stroke-width: 0.6; }
          40% { opacity: 0.9; }
          100% { opacity: 0; stroke-width: 0.1; }
        }
        @keyframes glitch-slice {
          0% { opacity: 0; }
          30% { opacity: 1; }
          60% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes glitch-flash {
          0% { opacity: 0; }
          30% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes nuke-flash {
          0% { opacity: 0; }
          8% { opacity: 1; }
          20% { opacity: 0.95; }
          40% { opacity: 0.3; }
          100% { opacity: 0; }
        }
        @keyframes nuke-shockwave {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
          70% { opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(200); opacity: 0; }
        }
        @keyframes nuke-stem {
          0% { height: 0; opacity: 0.8; }
          50% { height: 60vh; opacity: 0.6; }
          100% { height: 80vh; opacity: 0; }
        }
      `}</style>

      {/* Effects trigger button */}
      <div className="flex flex-col items-end">
        {showPicker && (
          <div
            className="mb-2 rounded-[15px] px-3 py-3 nice-shadow pointer-events-auto animate-fade-in"
            style={frostedStyle}
          >
            <p className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider mb-2 px-1">{t('boards.effects.title')}</p>
            <div className="grid grid-cols-5 gap-1">
              {PAGE_EFFECTS.map((e) => (
                <button
                  key={e.id}
                  onClick={() => triggerEffect(e.id)}
                  className="w-10 h-10 rounded-lg hover:bg-neutral-100 flex flex-col items-center justify-center transition-all hover:scale-110 gap-0.5"
                  title={t(e.label)}
                >
                  <span className="text-lg leading-none">{e.icon}</span>
                  <span className="text-[7px] text-neutral-400 font-medium leading-none">{t(e.label)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setShowPicker((v) => !v)}
          className="flex items-center gap-1.5 rounded-[15px] px-3 py-2.5 nice-shadow pointer-events-auto transition-colors"
          style={frostedStyle}
        >
          <Wand2 size={13} className={showPicker ? 'text-purple-500' : 'text-neutral-500'} />
          <span className="text-xs font-medium text-neutral-600">{t('boards.effects.title')}</span>
        </button>
      </div>
    </>
  )
}
