'use client'
import React from 'react'
import { ClosedCaptioning, Plus, X } from '@phosphor-icons/react'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import toast from 'react-hot-toast'

export interface CaptionsValue {
  enabled: boolean
  sourceLang: string
  languages: { code: string; label: string; status?: string }[]
}

export const EMPTY_CAPTIONS: CaptionsValue = { enabled: false, sourceLang: 'auto', languages: [] }

/** Shared "AI Closed Captions" panel used by both the create and edit video modals. */
export default function CaptionsSettings({
  value,
  onChange,
  status,
}: {
  value: CaptionsValue
  onChange: (_next: CaptionsValue) => void
  status?: string | null
}) {
  const [customCode, setCustomCode] = React.useState('')
  const [customLabel, setCustomLabel] = React.useState('')

  const toggleLang = (code: string, label: string) => {
    const on = value.languages.some((l) => l.code === code)
    onChange({
      ...value,
      languages: on
        ? value.languages.filter((l) => l.code !== code)
        : [...value.languages, { code, label }],
    })
  }

  const addCustom = () => {
    const code = customCode.trim()
    if (!/^[A-Za-z0-9-]{2,20}$/.test(code)) {
      toast.error('Enter a valid language code (e.g. sw, es-419)')
      return
    }
    if (value.languages.some((l) => l.code === code)) return
    onChange({ ...value, languages: [...value.languages, { code, label: customLabel.trim() || code }] })
    setCustomCode('')
    setCustomLabel('')
  }

  return (
    <div className="rounded-xl nice-shadow p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <ClosedCaptioning size={18} weight="duotone" className="text-violet-400" />
          AI Closed Captions
        </h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
            className="rounded border-gray-300 text-black focus:ring-black"
          />
          <span className="text-sm text-gray-600">Generate with AI</span>
        </label>
      </div>
      <p className="text-xs text-gray-400 -mt-1">
        Transcribes the video and translates captions into the languages you choose. Uses your
        organization&apos;s AI credits.
      </p>

      {value.enabled && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Spoken language</label>
            <select
              value={value.sourceLang}
              onChange={(e) => onChange({ ...value, sourceLang: e.target.value })}
              className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300"
            >
              <option value="auto">Auto-detect</option>
              {AVAILABLE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.nativeName}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Caption languages</label>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_LANGUAGES.map((l) => {
                const on = value.languages.some((c) => c.code === l.code)
                return (
                  <button
                    type="button"
                    key={l.code}
                    onClick={() => toggleLang(l.code, l.nativeName)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      on
                        ? 'bg-violet-100 text-violet-700 ring-1 ring-violet-200'
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {l.nativeName}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-[11px] text-gray-400">Custom code</label>
              <input
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                placeholder="e.g. sw"
                className="w-full h-8 px-2 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none"
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[11px] text-gray-400">Name</label>
              <input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="e.g. Swahili"
                className="w-full h-8 px-2 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={addCustom}
              className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              <Plus size={14} /> Add
            </button>
          </div>

          {value.languages.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[11px] text-gray-400">Selected ({value.languages.length})</label>
              <div className="flex flex-wrap gap-1.5">
                {value.languages.map((l) => (
                  <span
                    key={l.code}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs bg-gray-100 text-gray-700"
                  >
                    {l.label}
                    {l.status && (
                      <span
                        className={`text-[10px] font-medium ${
                          l.status === 'ready'
                            ? 'text-green-600'
                            : l.status === 'failed'
                              ? 'text-red-500'
                              : 'text-amber-500'
                        }`}
                      >
                        {l.status}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ ...value, languages: value.languages.filter((c) => c.code !== l.code) })
                      }
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {status && <p className="text-xs text-gray-400">Status: {status}</p>}
    </div>
  )
}
