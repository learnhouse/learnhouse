'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Share2, Copy, Check, Timer, Play, Pause, RotateCcw, X, SkipForward } from 'lucide-react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import PresenceAvatars from './PresenceAvatars'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'

interface BoardTopRightProps {
  provider: HocuspocusProvider
  ydoc: Y.Doc
}

type PomodoroPhase = 'work' | 'shortBreak' | 'longBreak'

interface TimerState {
  endTime: number | null
  duration: number
  paused: boolean
  pausedRemaining: number
  isPomodoro: boolean
  pomodoroPhase: PomodoroPhase
  pomodoroSessions: number
}

const POMODORO_DURATIONS: Record<PomodoroPhase, number> = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
}

const POMODORO_COLORS: Record<PomodoroPhase, { bg: string; on: string; off: string; btnBg: string; text: string; label: string }> = {
  work: { bg: '#2a0808', on: '#ef4444', off: '#3d1818', btnBg: 'rgba(239,68,68,0.15)', text: 'text-red-400', label: 'Focus' },
  shortBreak: { bg: '#082a0e', on: '#22c55e', off: '#183d1e', btnBg: 'rgba(34,197,94,0.15)', text: 'text-green-400', label: 'Short Break' },
  longBreak: { bg: '#08102a', on: '#3b82f6', off: '#18253d', btnBg: 'rgba(59,130,246,0.15)', text: 'text-blue-400', label: 'Long Break' },
}

const TIMER_PRESETS = [
  { label: '1m', seconds: 60 },
  { label: '3m', seconds: 180 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
]

const frostedStyle = {
  background: 'rgba(255, 255, 255, 0.95)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
}

// ─── 7-Segment LCD Display ──────────────────────────────────────────────────

// Segments: A=top, B=top-right, C=bottom-right, D=bottom, E=bottom-left, F=top-left, G=middle
const DIGIT_SEGMENTS: Record<string, number[]> = {
  '0': [1,1,1,1,1,1,0],
  '1': [0,1,1,0,0,0,0],
  '2': [1,1,0,1,1,0,1],
  '3': [1,1,1,1,0,0,1],
  '4': [0,1,1,0,0,1,1],
  '5': [1,0,1,1,0,1,1],
  '6': [1,0,1,1,1,1,1],
  '7': [1,1,1,0,0,0,0],
  '8': [1,1,1,1,1,1,1],
  '9': [1,1,1,1,0,1,1],
}

const SEG_PATHS = [
  // A: top horizontal
  'M 1.8,0.2 L 8.2,0.2 L 8.8,0.8 L 8.0,1.6 L 2.0,1.6 L 1.2,0.8 Z',
  // B: top-right vertical
  'M 8.8,1.2 L 9.4,1.8 L 9.4,8.0 L 8.8,8.6 L 8.0,7.8 L 8.0,2.0 Z',
  // C: bottom-right vertical
  'M 8.8,9.4 L 9.4,10.0 L 9.4,16.2 L 8.8,16.8 L 8.0,16.0 L 8.0,10.2 Z',
  // D: bottom horizontal
  'M 2.0,16.4 L 8.0,16.4 L 8.8,17.2 L 8.2,17.8 L 1.8,17.8 L 1.2,17.2 Z',
  // E: bottom-left vertical
  'M 1.2,9.4 L 2.0,10.2 L 2.0,16.0 L 1.2,16.8 L 0.6,16.2 L 0.6,10.0 Z',
  // F: top-left vertical
  'M 1.2,1.2 L 2.0,2.0 L 2.0,7.8 L 1.2,8.6 L 0.6,8.0 L 0.6,1.8 Z',
  // G: middle horizontal
  'M 2.0,8.4 L 8.0,8.4 L 8.8,9.0 L 8.0,9.6 L 2.0,9.6 L 1.2,9.0 Z',
]

const LCD_BG = '#1a3a2a'
const LCD_ON = '#7ec850'
const LCD_OFF = '#284a36'

function LcdDigit({ char, size, onColor = LCD_ON, offColor = LCD_OFF }: { char: string; size: number; onColor?: string; offColor?: string }) {
  const segs = DIGIT_SEGMENTS[char]
  if (!segs) return null
  return (
    <svg width={size} height={size * 1.8} viewBox="0 0 10 18" style={{ display: 'block' }}>
      {SEG_PATHS.map((d, i) => (
        <path key={i} d={d} fill={segs[i] ? onColor : offColor} />
      ))}
    </svg>
  )
}

function LcdColon({ size, color = LCD_ON }: { size: number; color?: string }) {
  return (
    <svg width={size * 0.3} height={size * 1.8} viewBox="0 0 3 18" style={{ display: 'block' }}>
      <circle cx="1.5" cy="5.5" r="0.9" fill={color} />
      <circle cx="1.5" cy="12.5" r="0.9" fill={color} />
    </svg>
  )
}

function LcdPanel({ time, size = 16, bg = LCD_BG, onColor = LCD_ON, offColor = LCD_OFF }: {
  time: string; size?: number; bg?: string; onColor?: string; offColor?: string
}) {
  return (
    <div
      className="flex items-center gap-[1px] rounded-lg px-2.5 py-1.5"
      style={{
        background: bg,
        boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {time.split('').map((ch, i) =>
        ch === ':' ? (
          <LcdColon key={i} size={size} color={onColor} />
        ) : (
          <LcdDigit key={i} char={ch} size={size} onColor={onColor} offColor={offColor} />
        )
      )}
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function BoardTopRight({ provider, ydoc }: BoardTopRightProps) {
  const { t } = useTranslation()
  const [showShare, setShowShare] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showTimerPicker, setShowTimerPicker] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [timerState, setTimerState] = useState<TimerState>({
    endTime: null,
    duration: 0,
    paused: false,
    pausedRemaining: 0,
    isPomodoro: false,
    pomodoroPhase: 'work',
    pomodoroSessions: 0,
  })
  const tickRef = useRef<ReturnType<typeof setInterval>>(null)
  const [timesUpPhase, setTimesUpPhase] = useState<'hidden' | 'dramatic' | 'bar'>('hidden')
  const prevExpiredRef = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const timerMap = ydoc.getMap<any>('board-timer')
    const sync = () => {
      const endTime = timerMap.get('endTime') as number | null ?? null
      const duration = timerMap.get('duration') as number ?? 0
      const paused = timerMap.get('paused') as boolean ?? false
      const pausedRemaining = timerMap.get('pausedRemaining') as number ?? 0
      const isPomodoro = timerMap.get('isPomodoro') as boolean ?? false
      const pomodoroPhase = (timerMap.get('pomodoroPhase') as PomodoroPhase) ?? 'work'
      const pomodoroSessions = timerMap.get('pomodoroSessions') as number ?? 0
      setTimerState({ endTime, duration, paused, pausedRemaining, isPomodoro, pomodoroPhase, pomodoroSessions })
    }
    timerMap.observe(sync)
    sync()
    return () => timerMap.unobserve(sync)
  }, [ydoc])

  useEffect(() => {
    if (timerState.endTime && !timerState.paused) {
      tickRef.current = setInterval(() => setNow(Date.now()), 100)
      return () => { if (tickRef.current) clearInterval(tickRef.current) }
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [timerState.endTime, timerState.paused])

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const startTimer = useCallback((seconds: number) => {
    const timerMap = ydoc.getMap<any>('board-timer')
    timerMap.set('endTime', Date.now() + seconds * 1000)
    timerMap.set('duration', seconds)
    timerMap.set('paused', false)
    timerMap.set('pausedRemaining', 0)
    setShowTimerPicker(false)
  }, [ydoc])

  const pauseTimer = useCallback(() => {
    const timerMap = ydoc.getMap<any>('board-timer')
    const endTime = timerMap.get('endTime') as number | null
    if (!endTime) return
    const remaining = Math.max(0, endTime - Date.now())
    timerMap.set('paused', true)
    timerMap.set('pausedRemaining', remaining)
  }, [ydoc])

  const resumeTimer = useCallback(() => {
    const timerMap = ydoc.getMap<any>('board-timer')
    const remaining = timerMap.get('pausedRemaining') as number ?? 0
    if (remaining <= 0) return
    timerMap.set('endTime', Date.now() + remaining)
    timerMap.set('paused', false)
    timerMap.set('pausedRemaining', 0)
  }, [ydoc])

  const restartTimer = useCallback(() => {
    const timerMap = ydoc.getMap<any>('board-timer')
    const duration = timerMap.get('duration') as number ?? 0
    if (duration <= 0) return
    prevExpiredRef.current = false
    setTimesUpPhase('hidden')
    timerMap.set('endTime', Date.now() + duration * 1000)
    timerMap.set('paused', false)
    timerMap.set('pausedRemaining', 0)
  }, [ydoc])

  const clearTimer = useCallback(() => {
    const timerMap = ydoc.getMap<any>('board-timer')
    timerMap.set('endTime', null)
    timerMap.set('duration', 0)
    timerMap.set('paused', false)
    timerMap.set('pausedRemaining', 0)
    timerMap.set('isPomodoro', false)
    timerMap.set('pomodoroPhase', 'work')
    timerMap.set('pomodoroSessions', 0)
  }, [ydoc])

  const startPomodoro = useCallback(() => {
    const timerMap = ydoc.getMap<any>('board-timer')
    const seconds = POMODORO_DURATIONS.work
    timerMap.set('endTime', Date.now() + seconds * 1000)
    timerMap.set('duration', seconds)
    timerMap.set('paused', false)
    timerMap.set('pausedRemaining', 0)
    timerMap.set('isPomodoro', true)
    timerMap.set('pomodoroPhase', 'work')
    timerMap.set('pomodoroSessions', 0)
    setShowTimerPicker(false)
  }, [ydoc])

  const advancePomodoro = useCallback(() => {
    const timerMap = ydoc.getMap<any>('board-timer')
    const currentPhase = timerMap.get('pomodoroPhase') as PomodoroPhase ?? 'work'
    const sessions = timerMap.get('pomodoroSessions') as number ?? 0
    let nextPhase: PomodoroPhase
    let nextSessions = sessions
    if (currentPhase === 'work') {
      nextSessions = sessions + 1
      nextPhase = nextSessions % 4 === 0 ? 'longBreak' : 'shortBreak'
    } else {
      nextPhase = 'work'
    }
    const seconds = POMODORO_DURATIONS[nextPhase]
    timerMap.set('endTime', Date.now() + seconds * 1000)
    timerMap.set('duration', seconds)
    timerMap.set('paused', false)
    timerMap.set('pausedRemaining', 0)
    timerMap.set('pomodoroPhase', nextPhase)
    timerMap.set('pomodoroSessions', nextSessions)
    prevExpiredRef.current = false
    setTimesUpPhase('hidden')
  }, [ydoc])

  const formatTime = (date: Date) => {
    const h = date.getHours().toString().padStart(2, '0')
    const m = date.getMinutes().toString().padStart(2, '0')
    const s = date.getSeconds().toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  const getTimerRemaining = (): { mm: string; ss: string; totalMs: number } => {
    let remaining = 0
    if (timerState.paused) {
      remaining = timerState.pausedRemaining
    } else if (timerState.endTime) {
      remaining = Math.max(0, timerState.endTime - now)
    }
    const mins = Math.floor(remaining / 60000)
    const secs = Math.floor((remaining % 60000) / 1000)
    return {
      mm: mins.toString().padStart(2, '0'),
      ss: secs.toString().padStart(2, '0'),
      totalMs: remaining,
    }
  }

  const isTimerActive = timerState.endTime !== null
  const isTimerExpired = isTimerActive && !timerState.paused && timerState.endTime! <= now
  const timer = getTimerRemaining()
  const timerDisplay = `${timer.mm}:${timer.ss}`
  const currentTime = formatTime(new Date(now))

  // Pomodoro color scheme
  const pomColors = timerState.isPomodoro ? POMODORO_COLORS[timerState.pomodoroPhase] : null

  // Track "Time's up" banner — phases: 'hidden' → 'dramatic' (50% screen) → 'bar' (small top bar, stays)
  // For pomodoro: auto-advance to the next phase after the dramatic display
  useEffect(() => {
    if (isTimerExpired && !prevExpiredRef.current) {
      prevExpiredRef.current = true
      setTimesUpPhase('dramatic')
      if (timerState.isPomodoro) {
        // Auto-advance pomodoro after 3 seconds
        const autoAdvance = setTimeout(() => {
          advancePomodoro()
        }, 3000)
        return () => clearTimeout(autoAdvance)
      } else {
        const shrinkTimer = setTimeout(() => {
          setTimesUpPhase('bar')
        }, 3000)
        return () => clearTimeout(shrinkTimer)
      }
    }
    if (!isTimerExpired && !isTimerActive) {
      prevExpiredRef.current = false
      setTimesUpPhase('hidden')
    }
  }, [isTimerExpired, isTimerActive, timerState.isPomodoro, advancePomodoro])

  const dismissTimesUp = useCallback(() => {
    setTimesUpPhase('hidden')
    clearTimer()
  }, [clearTimer])

  return (
    <>
      {/* Top right bar */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2 pointer-events-none board-topright">
        {/* Main bar: avatars + clock + timer btn + share */}
        <div
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 nice-shadow pointer-events-auto"
          style={frostedStyle}
        >
          <PresenceAvatars provider={provider} />
          <LcdPanel time={currentTime} size={13} />

          {/* Timer button */}
          <div className="relative">
            <ToolTip content={t('boards.timer.set_timer')}>
              <div
                onClick={() => setShowTimerPicker(!showTimerPicker)}
                className={`editor-tool-btn ${showTimerPicker ? 'is-active' : ''}`}
              >
                <Timer size={15} />
              </div>
            </ToolTip>

            {showTimerPicker && (
              <div
                className="absolute top-full right-0 mt-2 rounded-xl p-3 nice-shadow animate-fade-in"
                style={{
                  ...frostedStyle,
                  background: 'rgba(255, 255, 255, 0.98)',
                  minWidth: 180,
                }}
              >
                <p className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider mb-2 px-1">{t('boards.timer.set_timer_title')}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {TIMER_PRESETS.map((preset) => (
                    <button
                      key={preset.seconds}
                      onClick={() => startTimer(preset.seconds)}
                      className="px-2 py-1.5 rounded-lg text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="border-t border-neutral-100 mt-2 pt-2">
                  <button
                    onClick={startPomodoro}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-red-50 text-red-500"
                  >
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    Pomodoro (25/5)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Share button */}
          <div className="relative">
            <ToolTip content={t('boards.share.share_board')}>
              <div
                onClick={() => setShowShare(!showShare)}
                className="editor-tool-btn"
              >
                <Share2 size={15} />
              </div>
            </ToolTip>

            {showShare && (
              <div
                className="absolute top-full right-0 mt-2 w-64 rounded-xl p-3 nice-shadow animate-fade-in"
                style={{
                  background: 'rgba(255, 255, 255, 0.98)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              >
                <p className="text-xs font-semibold text-neutral-700 mb-2">{t('boards.share.share_this_board')}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={typeof window !== 'undefined' ? window.location.href : ''}
                    className="flex-1 text-xs bg-neutral-100 rounded-lg px-2.5 py-1.5 text-neutral-600 outline-none truncate"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors shrink-0"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timer banner — slides down from top center when active */}
      <style jsx>{`
        @keyframes timer-slide-down {
          from { transform: translateX(-50%) translateY(-100%); }
          to { transform: translateX(-50%) translateY(0); }
        }
        @keyframes timesup-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes timesup-expand {
          from { height: 0; opacity: 0; }
          to { height: 50vh; opacity: 1; }
        }
        @keyframes timesup-shrink-to-bar {
          from { transform: translateX(-50%) translateY(-40px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `}</style>

      {/* Active timer banner */}
      {isTimerActive && !isTimerExpired && (
        <div
          className="absolute top-0 left-1/2 z-30 pointer-events-auto"
          style={{
            animation: 'timer-slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          }}
        >
          <div
            className="flex items-center gap-3 rounded-b-2xl px-5 py-2.5 nice-shadow"
            style={{
              background: pomColors?.bg ?? '#2a0808',
              borderTop: 'none',
              boxShadow: `0 4px 20px rgba(0,0,0,0.3), inset 0 -1px 0 rgba(255,255,255,0.05)`,
            }}
          >
            {/* Pomodoro phase label */}
            {pomColors && (
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: pomColors.on }}>
                {pomColors.label}
              </span>
            )}

            <LcdPanel
              time={timerDisplay}
              size={18}
              bg={pomColors?.bg ?? '#2a0808'}
              onColor={pomColors?.on ?? '#ef4444'}
              offColor={pomColors?.off ?? '#3d1818'}
            />

            {/* Pomodoro session dots */}
            {timerState.isPomodoro && (
              <div className="flex items-center gap-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor: i < (timerState.pomodoroSessions % 4) ? pomColors!.on : pomColors!.off,
                    }}
                  />
                ))}
              </div>
            )}

            {timerState.paused ? (
              <button
                onClick={resumeTimer}
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                style={{ background: pomColors?.btnBg ?? 'rgba(239,68,68,0.15)' }}
                title={t('boards.timer.resume')}
              >
                <Play size={13} className={pomColors?.text ?? 'text-red-400'} />
              </button>
            ) : (
              <button
                onClick={pauseTimer}
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                style={{ background: pomColors?.btnBg ?? 'rgba(239,68,68,0.15)' }}
                title={t('boards.timer.pause')}
              >
                <Pause size={13} className={pomColors?.text ?? 'text-red-400'} />
              </button>
            )}

            <button
              onClick={restartTimer}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
              style={{ background: pomColors?.btnBg ?? 'rgba(239,68,68,0.15)' }}
              title={t('boards.timer.restart')}
            >
              <RotateCcw size={13} className={pomColors?.text ?? 'text-red-400'} />
            </button>

            {/* Skip to next phase (pomodoro only) */}
            {timerState.isPomodoro && (
              <button
                onClick={advancePomodoro}
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                style={{ background: pomColors?.btnBg ?? 'rgba(239,68,68,0.15)' }}
                title="Skip to next phase"
              >
                <SkipForward size={13} className={pomColors?.text ?? 'text-red-400'} />
              </button>
            )}

            <button
              onClick={clearTimer}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
              style={{ background: pomColors?.btnBg ?? 'rgba(239,68,68,0.15)' }}
              title={t('boards.timer.close')}
            >
              <X size={13} className={pomColors?.text ?? 'text-red-400'} />
            </button>
          </div>
        </div>
      )}

      {/* Time's up — dramatic phase: takes 50% of screen */}
      {timesUpPhase === 'dramatic' && (() => {
        const pc = pomColors
        const dramaticBg = pc ? pc.bg : '#1a0505'
        const dramaticOn = pc ? pc.on : '#ff4444'
        const dramaticOff = pc ? pc.off : '#3d1515'
        const dramaticLabel = pc ? (timerState.pomodoroPhase === 'work'
          ? (timerState.pomodoroSessions % 4 === 3 ? 'Long break next' : 'Short break next')
          : 'Back to focus') : null
        return (
          <div
            className="absolute inset-x-0 top-0 z-40 pointer-events-auto flex items-center justify-center"
            style={{
              height: '50vh',
              background: `linear-gradient(180deg, ${dramaticBg} 0%, ${dramaticBg} 70%, transparent 100%)`,
              animation: 'timesup-expand 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div className="flex flex-col items-center gap-4">
              <LcdPanel
                time="00:00"
                size={48}
                bg="transparent"
                onColor={dramaticOn}
                offColor={dramaticOff}
              />
              <span
                className="text-2xl font-black tracking-widest uppercase"
                style={{ color: dramaticOn, animation: 'timesup-pulse 0.6s ease-in-out infinite' }}
              >
                {t('boards.timer.times_up')}
              </span>
              {dramaticLabel && (
                <span className="text-sm font-medium tracking-wide" style={{ color: `${dramaticOn}99` }}>
                  {dramaticLabel}
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {/* Time's up — bar phase: small banner at top, stays permanently (non-pomodoro only) */}
      {timesUpPhase === 'bar' && !timerState.isPomodoro && (
        <div
          className="absolute top-0 left-1/2 z-30 pointer-events-auto"
          style={{
            animation: 'timesup-shrink-to-bar 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          }}
        >
          <div
            className="flex items-center gap-3 rounded-b-2xl px-5 py-2.5 nice-shadow"
            style={{
              background: '#1a0505',
              boxShadow: '0 4px 24px rgba(239,68,68,0.3), inset 0 -1px 0 rgba(239,68,68,0.2)',
            }}
          >
            <LcdPanel
              time="00:00"
              size={16}
              bg="#1a0505"
              onColor="#ff4444"
              offColor="#3d1515"
            />
            <span
              className="text-red-400 text-xs font-bold tracking-wide uppercase"
              style={{ animation: 'timesup-pulse 1s ease-in-out infinite' }}
            >
              {t('boards.timer.times_up')}
            </span>

            <button
              onClick={restartTimer}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
              style={{ background: 'rgba(239,68,68,0.15)' }}
              title={t('boards.timer.restart')}
            >
              <RotateCcw size={13} className="text-red-400" />
            </button>

            <button
              onClick={dismissTimesUp}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
              style={{ background: 'rgba(239,68,68,0.15)' }}
              title={t('boards.timer.close')}
            >
              <X size={13} className="text-red-400" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
