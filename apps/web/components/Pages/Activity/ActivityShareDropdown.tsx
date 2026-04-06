'use client'

import React, { useState, useRef, useEffect } from 'react'
import { SiX, SiWhatsapp, SiReddit } from '@icons-pack/react-simple-icons'
import { Link2, Check, Share2, Code2 } from 'lucide-react'

const LinkedinIcon = ({ size = 24 }: { size?: number }) => (
  <svg role="img" viewBox="0 0 24 24" width={size} height={size} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);
import { useTranslation } from 'react-i18next'

interface ActivityShareDropdownProps {
  activityName: string
  activityUrl: string
  orgslug: string
  courseUuid: string
  activityId: string
  activityType: string
}

function ActivityShareDropdown({
  activityName,
  activityUrl,
  orgslug,
  courseUuid,
  activityId,
  activityType,
}: ActivityShareDropdownProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const shareText = `Check out this activity: ${activityName}`
  const encodedUrl = encodeURIComponent(activityUrl)
  const encodedText = encodeURIComponent(shareText)

  // Embeddable activity types
  const embeddableTypes = ['TYPE_DYNAMIC', 'TYPE_VIDEO', 'TYPE_DOCUMENT']
  const isEmbeddable = embeddableTypes.includes(activityType)

  // Generate embed URL with course UUID
  const getEmbedUrl = () => {
    if (typeof window === 'undefined') return ''
    const baseUrl = window.location.origin
    const cleanCourseUuid = courseUuid.replace('course_', '')
    return `${baseUrl}/embed/${orgslug}/course/${cleanCourseUuid}/activity/${activityId}`
  }

  const getEmbedCode = () => {
    const embedUrl = getEmbedUrl()
    return `<iframe src="${embedUrl}" width="100%" height="600" frameborder="0" allowfullscreen></iframe>`
  }

  const shareLinks = [
    {
      name: 'LinkedIn',
      icon: LinkedinIcon,
      color: 'hover:bg-[#0A66C2] hover:text-white',
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
    {
      name: 'X',
      icon: SiX,
      color: 'hover:bg-black hover:text-white',
      url: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
    },
    {
      name: 'WhatsApp',
      icon: SiWhatsapp,
      color: 'hover:bg-[#25D366] hover:text-white',
      url: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
    },
    {
      name: 'Reddit',
      icon: SiReddit,
      color: 'hover:bg-[#FF4500] hover:text-white',
      url: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`,
    },
  ]

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(activityUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const copyEmbedCode = async () => {
    try {
      await navigator.clipboard.writeText(getEmbedCode())
      setEmbedCopied(true)
      setTimeout(() => setEmbedCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy embed code:', err)
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close dropdown on Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white nice-shadow text-neutral-600 hover:text-neutral-800 transition-colors text-sm font-medium"
      >
        <Share2 size={14} />
        <span>{t('activities.share')}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-10 z-50 bg-white rounded-lg nice-shadow py-1 min-w-[180px]">
          {shareLinks.map((link) => {
            const Icon = link.icon
            return (
              <a
                key={link.name}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-600 transition-all duration-200 ${link.color}`}
              >
                <Icon size={16} />
                <span>{link.name}</span>
              </a>
            )
          })}

          <div className="border-t border-gray-100 my-1" />

          <button
            onClick={copyToClipboard}
            className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-all duration-200 ${
              copied
                ? 'bg-green-500 text-white'
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {copied ? <Check size={16} /> : <Link2 size={16} />}
            <span>{copied ? t('activities.link_copied') : t('activities.copy_link')}</span>
          </button>

          {isEmbeddable && (
            <button
              onClick={copyEmbedCode}
              className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-all duration-200 ${
                embedCopied
                  ? 'bg-green-500 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {embedCopied ? <Check size={16} /> : <Code2 size={16} />}
              <span>{embedCopied ? t('activities.embed_code_copied') : t('activities.embed')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default ActivityShareDropdown
