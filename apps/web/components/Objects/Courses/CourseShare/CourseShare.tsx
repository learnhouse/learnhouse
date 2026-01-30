'use client'

import React, { useState, useRef, useEffect } from 'react'
import { SiX, SiFacebook, SiWhatsapp, SiReddit } from '@icons-pack/react-simple-icons'
import { Link2, Check, Share2, Linkedin } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface CourseShareProps {
  courseName: string
  courseUrl: string
}

function CourseShare({ courseName, courseUrl }: CourseShareProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const shareText = `Check out this course: ${courseName}`
  const encodedUrl = encodeURIComponent(courseUrl)
  const encodedText = encodeURIComponent(shareText)

  const shareLinks = [
    {
      name: 'LinkedIn',
      icon: Linkedin,
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
      name: 'Facebook',
      icon: SiFacebook,
      color: 'hover:bg-[#1877F2] hover:text-white',
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
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
      await navigator.clipboard.writeText(courseUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white nice-shadow text-neutral-600 hover:text-neutral-800 transition-colors text-sm font-medium"
      >
        <Share2 size={14} />
        <span>{t('courses.share_course')}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-10 z-50 bg-white rounded-lg nice-shadow p-2 min-w-[140px]">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {shareLinks.map((link) => {
              const Icon = link.icon
              return (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center justify-center w-8 h-8 rounded-md bg-neutral-100 text-neutral-600 transition-all duration-200 ${link.color}`}
                  title={link.name}
                >
                  <Icon size={14} />
                </a>
              )
            })}

            <button
              onClick={copyToClipboard}
              className={`flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200 ${
                copied
                  ? 'bg-green-500 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
              title={t('courses.copy_link')}
            >
              {copied ? <Check size={14} /> : <Link2 size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CourseShare
