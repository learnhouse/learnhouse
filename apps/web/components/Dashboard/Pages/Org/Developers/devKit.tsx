'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Eye, EyeSlash, Warning } from '@phosphor-icons/react'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'

// Developer-facing building blocks for the Developers space: copy buttons
// with a "Copied" state, mono value fields, dark code blocks with light syntax
// colours, kbd hints and HTTP method badges. They sit on top of DashKit and
// only live here because no other area needs them.

// ---------- copy ----------

export function useCopy(timeout = 1600) {
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const copy = React.useCallback(
    async (text: string, key = 'default') => {
      try {
        await navigator.clipboard.writeText(text)
        setCopiedKey(key)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopiedKey(null), timeout)
        return true
      } catch {
        return false
      }
    },
    [timeout]
  )
  return { copiedKey, copy, isCopied: (key = 'default') => copiedKey === key }
}

export function CopyButton({
  value,
  label,
  size = 'sm',
  variant = 'secondary',
  disabled,
  className = '',
}: {
  value: string
  // Shown next to the icon; pass `false` for an icon-only button.
  label?: string | false
  size?: 'sm' | 'md' | 'icon'
  variant?: 'secondary' | 'ghost' | 'primary'
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const { copy, isCopied } = useCopy()
  const copied = isCopied()
  const text = label === false ? null : copied ? t('dashboard.developers.kit.copied') : label || t('dashboard.developers.kit.copy')
  return (
    <Button
      variant={variant}
      size={label === false ? 'icon' : size}
      disabled={disabled || !value}
      onClick={() => copy(value)}
      aria-label={copied ? t('dashboard.developers.kit.copied') : t('dashboard.developers.kit.copy')}
      title={copied ? t('dashboard.developers.kit.copied') : t('dashboard.developers.kit.copy')}
      icon={
        copied ? (
          <Check size={13} weight="bold" className="text-emerald-600" />
        ) : (
          <Copy size={13} />
        )
      }
      className={className}
    >
      {text}
    </Button>
  )
}

// Read-only mono value with a copy button tucked inside, for keys, URLs and
// ids. `secret` masks the value until revealed.
export function MonoField({
  label,
  value,
  hint,
  secret,
  defaultRevealed,
  copyable = true,
  placeholder = '…',
  className = '',
}: {
  label?: React.ReactNode
  value: string
  hint?: React.ReactNode
  secret?: boolean
  defaultRevealed?: boolean
  copyable?: boolean
  placeholder?: string
  className?: string
}) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = React.useState(!secret || !!defaultRevealed)
  const shown = value ? (revealed ? value : '•'.repeat(Math.min(Math.max(value.length, 12), 40))) : placeholder
  return (
    <div className={`min-w-0 ${className}`}>
      {label && <div className="mb-1.5 text-xs font-medium text-neutral-500">{label}</div>}
      <div className="flex items-center gap-1 h-9 ps-3 pe-1 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200/80 min-w-0">
        <code dir="ltr" className="flex-1 min-w-0 truncate font-mono text-[12.5px] text-neutral-800" title={revealed ? value : undefined}>
          {shown}
        </code>
        {secret && value && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? t('dashboard.developers.kit.hide') : t('dashboard.developers.kit.reveal')}
            title={revealed ? t('dashboard.developers.kit.hide') : t('dashboard.developers.kit.reveal')}
            icon={revealed ? <EyeSlash size={14} /> : <Eye size={14} />}
          />
        )}
        {copyable && <CopyButton value={value} label={false} variant="ghost" />}
      </div>
      {hint && <p className="mt-1.5 text-xs text-neutral-400">{hint}</p>}
    </div>
  )
}

// Shown once, right after a secret is minted: amber warning, the value and a
// copy button. Nothing here is stored, so closing loses the value for good.
export function SecretOnce({
  title,
  hint,
  label,
  value,
}: {
  title: React.ReactNode
  hint: React.ReactNode
  label: React.ReactNode
  value: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-600/15 px-3.5 py-3">
        <Warning size={18} weight="fill" className="text-amber-500 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">{title}</p>
          <p className="mt-0.5 text-xs text-amber-800/80">{hint}</p>
        </div>
      </div>
      <div className="flex items-end gap-2">
        {/* Shown in clear: the user is about to copy it, and it never comes back. */}
        <MonoField label={label} value={value} secret defaultRevealed copyable={false} className="flex-1" />
        <CopyButton value={value} size="md" variant="primary" />
      </div>
    </div>
  )
}

// ---------- kbd / method / dots ----------

export function Kbd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-md bg-white text-[10px] font-semibold font-mono text-neutral-500 ring-1 ring-inset ring-neutral-200 shadow-[0_1px_0_rgba(0,0,0,0.06)] ${className}`}
    >
      {children}
    </kbd>
  )
}

const METHOD_TONES: Record<string, string> = {
  GET: 'text-sky-700 bg-sky-50 ring-sky-600/20',
  POST: 'text-emerald-700 bg-emerald-50 ring-emerald-600/20',
  PUT: 'text-amber-700 bg-amber-50 ring-amber-600/20',
  PATCH: 'text-violet-700 bg-violet-50 ring-violet-600/20',
  DELETE: 'text-rose-700 bg-rose-50 ring-rose-600/20',
}

export function MethodBadge({ method, className = '' }: { method: string; className?: string }) {
  const m = method.toUpperCase()
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[52px] h-5 px-1.5 rounded-md font-mono text-[10.5px] font-bold tracking-wide ring-1 ring-inset ${
        METHOD_TONES[m] || 'text-neutral-600 bg-neutral-50 ring-neutral-900/10'
      } ${className}`}
    >
      {m}
    </span>
  )
}

// HTTP status as a chip-like mono label: 2xx green, 4xx/5xx red, rest amber.
export function StatusCode({ code, children }: { code: number | string | null; children?: React.ReactNode }) {
  const n = typeof code === 'string' ? parseInt(code, 10) : code ?? 0
  const tone =
    n >= 200 && n < 300
      ? 'text-emerald-700 bg-emerald-50 ring-emerald-600/20'
      : n >= 400 || n === 0
        ? 'text-rose-700 bg-rose-50 ring-rose-600/20'
        : 'text-amber-700 bg-amber-50 ring-amber-600/20'
  return (
    <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md font-mono text-[11px] font-semibold ring-1 ring-inset ${tone}`}>
      <span>{code ?? '—'}</span>
      {children && <span className="font-medium opacity-80">{children}</span>}
    </span>
  )
}

// ---------- code ----------

export type CodeLang = 'bash' | 'js' | 'python' | 'json' | 'text'

// A deliberately small tokenizer: strings, JSON keys, keywords, flags,
// numbers and whole-line comments. Enough for snippets, not a real lexer.
const TOKEN_RE =
  /(^[ \t]*(?:\/\/|#(?!!))[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')(\s*:)?|\b(const|let|await|async|return|import|from|print|new|true|false|null|None|True|False)\b|((?<=\s)--?[a-zA-Z][\w-]*)|(\b\d+(?:\.\d+)?\b)/gm

export function highlight(code: string, lang: CodeLang): React.ReactNode {
  if (lang === 'text') return code
  const out: React.ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of code.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0
    if (start > last) out.push(code.slice(last, start))
    const [whole, comment, str, colon, keyword, flag, num] = m
    if (comment) out.push(<span key={i++} className="text-neutral-500 italic">{comment}</span>)
    else if (str) {
      if (colon) {
        out.push(<span key={i++} className="text-sky-300">{str}</span>)
        out.push(colon)
      } else out.push(<span key={i++} className="text-emerald-300">{str}</span>)
    } else if (keyword) out.push(<span key={i++} className="text-violet-300">{keyword}</span>)
    else if (flag) out.push(<span key={i++} className="text-amber-200/90">{flag}</span>)
    else if (num) out.push(<span key={i++} className="text-amber-300">{num}</span>)
    else out.push(whole)
    last = start + whole.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

export interface CodeTab {
  key: string
  label: string
  code: string
  lang: CodeLang
}

// Dark code panel. With several tabs it shows a language switcher; with one it
// shows `title` (a filename or a short label) instead.
export function CodeBlock({
  tabs,
  title,
  initial,
  maxHeight = 'max-h-[360px]',
  className = '',
}: {
  tabs: CodeTab[]
  title?: React.ReactNode
  initial?: string
  maxHeight?: string
  className?: string
}) {
  const { t } = useTranslation()
  const [active, setActive] = React.useState(initial ?? tabs[0]?.key)
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0]
  const { copy, isCopied } = useCopy()
  if (!current) return null
  const copied = isCopied()
  return (
    <div className={`rounded-xl bg-neutral-950 ring-1 ring-black/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-2 h-10 ps-2 pe-1.5 border-b border-white/[0.07]">
        {tabs.length > 1 ? (
          <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-hide" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={tab.key === current.key}
                onClick={() => setActive(tab.key)}
                className={`h-7 px-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  tab.key === current.key ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 ps-1.5 min-w-0">
            <span className="flex gap-1 shrink-0" aria-hidden>
              <span className="w-2 h-2 rounded-full bg-white/15" />
              <span className="w-2 h-2 rounded-full bg-white/15" />
              <span className="w-2 h-2 rounded-full bg-white/15" />
            </span>
            <span className="text-xs font-mono text-white/45 truncate">{title ?? current.label}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => copy(current.code)}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
        >
          {copied ? <Check size={13} weight="bold" className="text-emerald-300" /> : <Copy size={13} />}
          {copied ? t('dashboard.developers.kit.copied') : t('dashboard.developers.kit.copy')}
        </button>
      </div>
      <pre dir="ltr" className={`px-4 py-3.5 text-[12.5px] leading-relaxed font-mono text-neutral-200 whitespace-pre overflow-auto text-start ${maxHeight}`}>
        <code>{highlight(current.code, current.lang)}</code>
      </pre>
    </div>
  )
}

// ---------- misc ----------

// The API base, made absolute: on custom domains getAPIUrl() is relative so
// requests go through the Next proxy, but snippets need a full URL.
export function absoluteApiBase(apiUrl: string): string {
  if (/^https?:\/\//.test(apiUrl)) return apiUrl
  if (typeof window === 'undefined') return apiUrl
  return `${window.location.origin}${apiUrl.startsWith('/') ? '' : '/'}${apiUrl}`
}

export const DOCS_URL = 'https://docs.learnhouse.app'
export const DOCS = {
  apiOverview: `${DOCS_URL}/developers/api`,
  apiAuth: `${DOCS_URL}/developers/api/authentication`,
  apiEndpoints: `${DOCS_URL}/developers/api/endpoints`,
  apiReference: `${DOCS_URL}/reference`,
  mcp: `${DOCS_URL}/platform/ai/connect-ai-apps`,
  webhooks: `${DOCS_URL}/platform/automations/webhooks`,
  domains: `${DOCS_URL}/platform/organizations/custom-domains`,
  sso: `${DOCS_URL}/enterprise/sso`,
  lti: `${DOCS_URL}/enterprise/lti`,
} as const
