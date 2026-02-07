'use client'

import React, { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { ImagePlus, ExternalLink } from 'lucide-react'

export const DocImageComponent = ({
  node,
  updateAttributes,
  selected,
}: {
  node: any
  updateAttributes: (attrs: any) => void
  selected: boolean
}) => {
  const { src, alt, title } = node.attrs
  const [isEditing, setIsEditing] = useState(!src)
  const [urlInput, setUrlInput] = useState(src || '')
  const [altInput, setAltInput] = useState(alt || '')

  const handleSave = () => {
    updateAttributes({ src: urlInput, alt: altInput })
    if (urlInput) {
      setIsEditing(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  if (isEditing || !src) {
    return (
      <NodeViewWrapper>
        <div
          className={`border rounded-lg p-4 my-2 bg-gray-50 ${
            selected ? 'ring-2 ring-blue-400' : ''
          }`}
        >
          <div className="flex items-center gap-2 mb-3 text-gray-500">
            <ImagePlus size={16} />
            <span className="text-sm font-medium">Image</span>
          </div>
          <div className="space-y-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste image URL..."
              className="w-full px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              autoFocus
            />
            <input
              type="text"
              value={altInput}
              onChange={(e) => setAltInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Alt text (optional)"
              className="w-full px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleSave}
              disabled={!urlInput}
              className="px-3 py-1.5 text-sm font-medium text-white bg-black rounded-md disabled:opacity-40"
            >
              Embed Image
            </button>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper>
      <div
        className={`my-2 rounded-lg overflow-hidden group relative ${
          selected ? 'ring-2 ring-blue-400' : ''
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || ''}
          title={title || ''}
          className="max-w-full rounded-lg"
        />
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 bg-white/90 rounded-md shadow-sm text-gray-600 hover:text-gray-900"
            title="Edit image"
          >
            <ExternalLink size={14} />
          </button>
        </div>
        {alt && (
          <p className="text-xs text-gray-500 text-center mt-1 px-2">{alt}</p>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default DocImageComponent
