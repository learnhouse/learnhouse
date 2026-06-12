'use client'

import Link from 'next/link'

const links = [
  { label: 'Documentation', href: '/' },
  { label: 'GitHub', href: 'https://github.com/learnhouse/learnhouse' },
  { label: 'Discord', href: 'https://discord.gg/CMyZjjYZ6x' },
  { label: 'Twitter', href: 'https://twitter.com/learnhouseapp' },
]

export default function Footer() {
  return (
    <footer className="lh-footer">
      <div className="lh-footer-container">
        <p className="lh-footer-copyright">
          &copy; {new Date().getFullYear()} LearnHouse
        </p>
        <nav className="lh-footer-nav">
          {links.map((link) => {
            const isExternal = link.href.startsWith('http')
            const Tag = isExternal ? 'a' : Link
            const props = isExternal
              ? { href: link.href, target: '_blank', rel: 'noopener noreferrer' }
              : { href: link.href }
            return (
              <Tag key={link.label} {...props} className="lh-footer-link">
                {link.label}
              </Tag>
            )
          })}
        </nav>
      </div>
    </footer>
  )
}
