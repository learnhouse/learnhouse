import React, { useState, Dispatch, SetStateAction, useEffect } from 'react'
import { Tag, TagInput } from 'emblor'

interface FormTagInputProps {
  value: string
  onChange: (value: string) => void
  separator?: string
  error?: string
	placeholder?: string
}

const FormTagInput = ({
  value,
  onChange,
  separator = '|',
  error,
	placeholder,
}: FormTagInputProps) => {
  const [tags, setTags] = useState<Tag[]>(() =>
    value && typeof value === 'string'
      ? value.split(separator).filter(text => text.trim()).map((text, i) => ({
          id: i.toString(),
          text: text.trim(),
        }))
      : []
  );

  useEffect(() => {
    if (value && typeof value === 'string') {
      const newTags = value.split(separator)
        .filter(text => text.trim())
        .map((text, i) => ({
          id: i.toString(),
          text: text.trim(),
        }));
      setTags(newTags);
    } else {
      setTags([]);
    }
  }, [value, separator]);

  const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null)

  const handleTagsChange: Dispatch<SetStateAction<Tag[]>> = (
    newTagsOrUpdater
  ) => {
    const newTags =
      typeof newTagsOrUpdater === 'function'
        ? newTagsOrUpdater(tags)
        : newTagsOrUpdater

    setTags(newTags)
    onChange(newTags.map((tag) => tag.text).join(separator))
  }

  return (
		<div>
			<div className="space-y-2">
				<TagInput
					tags={tags}
					setTags={handleTagsChange}
					placeholder={placeholder}
					styleClasses={{
						inlineTagsContainer:
							'border-input rounded-lg bg-background shadow-xs transition-shadow focus-within:border-ring/40 focus-within:outline-hidden focus-within:ring-[3px] ring-ring/8 dark:ring-ring/12 p-1 gap-1',
						input:
							'w-full min-w-[80px] focus-visible:outline-hidden shadow-none px-2 h-7',
						tag: {
							body: 'h-7 relative bg-background border border-input hover:bg-background rounded-md font-medium text-xs ps-2 pe-7',
							closeButton:
								'absolute -inset-y-px -end-px p-0 rounded-e-lg flex size-7 transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 dark:focus-visible:ring-ring/40 text-muted-foreground/80 hover:text-foreground',
						},
					}}
					activeTagIndex={activeTagIndex}
					setActiveTagIndex={setActiveTagIndex}
				/>
				{error && <p className="text-sm font-medium text-destructive">{error}</p>}
			</div>
		</div>
  )
}

export default FormTagInput
