import React, { useState, useEffect } from 'react'
import { CheckIcon, Cross2Icon } from '@radix-ui/react-icons'

interface LinkInputTooltipProps {
  onSave: (url: string) => void
  onCancel: () => void
  currentUrl?: string
}

const LinkInputTooltip: React.FC<LinkInputTooltipProps> = ({ onSave, onCancel, currentUrl }) => {
  const [url, setUrl] = useState(currentUrl || '')

  useEffect(() => {
    setUrl(currentUrl || '')
  }, [currentUrl])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (url) {
      // Ensure the URL has a protocol
      const formattedUrl = url.startsWith('http://') || url.startsWith('https://')
        ? url
        : `https://${url}`
      onSave(formattedUrl)
    }
  }

  return (
    <div className="absolute top-full left-0 bg-white border border-gray-300/50 rounded-md shadow-sm p-2 mt-1" style={{ zIndex: 'var(--z-editor-bubble)' }}>
      <form onSubmit={handleSubmit} className="flex items-center gap-1">
        <input
          type="text"
          placeholder="Enter URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
          className="py-1 px-2 border border-gray-300/50 rounded text-xs w-[200px] focus:outline-none focus:border-gray-300/80"
        />
        <div className="flex gap-0.5">
          <button
            type="submit"
            disabled={!url}
            className="flex items-center justify-center p-1 border-none rounded cursor-pointer bg-gray-300/25 transition-colors hover:bg-gray-300/50 disabled:opacity-50 disabled:cursor-not-allowed text-[#4CAF50]"
          >
            <CheckIcon />
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center p-1 border-none rounded cursor-pointer bg-gray-300/25 transition-colors hover:bg-gray-300/50 text-[#F44336]"
          >
            <Cross2Icon />
          </button>
        </div>
      </form>
    </div>
  )
}

export default LinkInputTooltip
