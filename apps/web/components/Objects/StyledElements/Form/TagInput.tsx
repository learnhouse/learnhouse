import React, { useState, Dispatch, SetStateAction, useEffect, useRef } from 'react'
import { Tag, TagInput } from 'emblor'
import { parseTags, serializeTags } from '@/lib/tags'

interface FormTagInputProps {
  value: string
  onChange: (value: string) => void
  /** @deprecated Tags are always read as "|" or "," lists and written with "|" (see lib/tags). */
  separator?: string
  error?: string
  placeholder?: string
}

const toTags = (value: unknown): Tag[] =>
  parseTags(value).map((text, i) => ({ id: `${i}-${text}`, text }))

// Tag field for course and podcast tags. Reads both "a|b" and the older
// "a,b" form and always writes "a|b", so a comma list stored by an import no
// longer shows up as one long chip.
const FormTagInput = ({ value, onChange, error, placeholder }: FormTagInputProps) => {
  const [tags, setTags] = useState<Tag[]>(() => toTags(value))
  const lastEmitted = useRef<string | null>(null)

  // Follow outside changes (form reset, server data) but not our own echo.
  useEffect(() => {
    if (value === lastEmitted.current) return
    setTags(toTags(value))
  }, [value])

  const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null)

  const handleTagsChange: Dispatch<SetStateAction<Tag[]>> = (newTagsOrUpdater) => {
    const next = typeof newTagsOrUpdater === 'function' ? newTagsOrUpdater(tags) : newTagsOrUpdater
    // A pasted "a|b" or "a, b" becomes separate tags; duplicates are dropped.
    const texts = parseTags(serializeTags(next.flatMap((tag) => tag.text.split(/[|,]/))))
    const normalized = texts.map((text, i) => ({ id: `${i}-${text}`, text }))
    setTags(normalized)
    const serialized = serializeTags(texts)
    lastEmitted.current = serialized
    onChange(serialized)
  }

  return (
    <div className="space-y-2">
      <TagInput
        tags={tags}
        setTags={handleTagsChange}
        placeholder={placeholder}
        addOnPaste
        addTagsOnBlur
        styleClasses={{
          inlineTagsContainer:
            'min-h-9 rounded-lg bg-white ring-1 ring-inset ring-neutral-200 border-0 shadow-none transition-shadow focus-within:ring-2 focus-within:ring-neutral-900/15 p-1 gap-1',
          input: 'w-full min-w-[80px] text-sm shadow-none focus-visible:outline-hidden px-2 h-7 placeholder:text-neutral-400',
          tag: {
            body: 'h-7 relative bg-neutral-100/80 ring-1 ring-inset ring-neutral-900/5 border-0 hover:bg-neutral-50 rounded-md font-medium text-xs text-neutral-700 ps-2 pe-7',
            closeButton:
              'absolute -inset-y-px -end-px p-0 rounded-e-md flex size-7 transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-neutral-900/20 text-neutral-400 hover:text-neutral-900',
          },
        }}
        activeTagIndex={activeTagIndex}
        setActiveTagIndex={setActiveTagIndex}
      />
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  )
}

export default FormTagInput
