'use client'
import Link from 'next/link'
import React, { ReactNode } from 'react'

export interface BreadcrumbItem {
  label: string
  href?: string
  icon?: ReactNode
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
}

const ChevronDivider = () => (
  <svg
    width="8"
    height="100%"
    viewBox="0 0 8 28"
    fill="none"
    className="h-full text-gray-200"
    preserveAspectRatio="none"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M1 0 L7 14 L1 28" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
)

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav className="flex items-center">
      <ol className="flex items-center text-[13px] font-medium rounded-lg bg-white overflow-hidden nice-shadow">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const isFirst = index === 0

          return (
            <React.Fragment key={index}>
              {index > 0 && (
                <li className="flex items-center h-8">
                  <ChevronDivider />
                </li>
              )}
              <li className="flex items-center h-8">
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className={`flex items-center h-full text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors ${
                      isFirst && item.icon ? 'gap-1.5 px-2.5' : 'px-2.5'
                    }`}
                  >
                    {item.icon}
                    <span className="truncate max-w-[150px]">{item.label}</span>
                  </Link>
                ) : (
                  <span className={`flex items-center h-full text-gray-900 ${
                    isFirst && item.icon ? 'gap-1.5 px-2.5' : 'px-2.5'
                  }`}>
                    {item.icon}
                    <span className="truncate max-w-[200px]">{item.label}</span>
                  </span>
                )}
              </li>
            </React.Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumbs
