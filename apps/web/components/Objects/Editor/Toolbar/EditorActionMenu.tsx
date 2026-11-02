import React from 'react'
import { ChevronDown } from 'lucide-react'

export type EditorActionMenuItem = {
  key: string
  label: string
  icon: React.ReactNode
  onSelect?: () => void
  disabled?: boolean
  badge?: React.ReactNode
}

type EditorActionMenuProps = {
  label: string
  items: EditorActionMenuItem[]
  className?: string
}

// The caret half of a split button in the editor header: opens a small menu of
// secondary actions, closed by clicking outside or pressing Escape.
export default function EditorActionMenu({ label, items, className = '' }: EditorActionMenuProps) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative flex">
      <div
        role="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 items-center px-1.5 rounded-e-lg transition-all ease-linear hover:cursor-pointer ${className}`}
      >
        <ChevronDown size={14} />
      </div>
      {open && (
        <div role="menu" className="absolute end-0 top-full mt-2 min-w-[200px] rounded-lg bg-white p-1 shadow-xl ring-1 ring-black/5 z-50">
          {items.map((item) => (
            <div
              key={item.key}
              role="menuitem"
              aria-disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return
                setOpen(false)
                item.onSelect?.()
              }}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs whitespace-nowrap ${
                item.disabled ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="flex text-gray-500">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
