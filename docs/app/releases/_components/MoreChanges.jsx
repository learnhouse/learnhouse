'use client'

import { useId, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/ssr'

/**
 * The tail of a long release. It is always in the HTML (so search indexes it)
 * and only hidden until expanded.
 */
export default function MoreChanges({ label, children }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <div id={id} hidden={!open} className="lhr-more-body">
        {children}
      </div>
      <button
        type="button"
        className="lhr-more-btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Show fewer' : label}
        <CaretDown size={12} weight="bold" className={open ? 'lhr-more-caret is-open' : 'lhr-more-caret'} />
      </button>
    </>
  )
}
