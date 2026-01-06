'use client';
import { BookCopy, ChevronRight, CreditCard, School, User, Users, Backpack } from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'

type BreadCrumbsProps = {
  type: 'courses' | 'user' | 'users' | 'org' | 'orgusers' | 'assignments' | 'payments'
  last_breadcrumb?: string
}

function BreadCrumbs(props: BreadCrumbsProps) {
  const { t } = useTranslation()

  const getBreadcrumbConfig = () => {
    switch (props.type) {
      case 'courses':
        return {
          icon: <BookCopy size={13} className="text-black" />,
          label: t('courses.courses'),
          href: '/dash/courses'
        }
      case 'assignments':
        return {
          icon: <Backpack size={13} className="text-black" />,
          label: t('common.assignments'),
          href: '/dash/assignments'
        }
      case 'user':
        return {
          icon: <User size={13} className="text-black" />,
          label: t('user.user_settings'),
          href: '/dash/user-account/settings/general'
        }
      case 'orgusers':
        return {
          icon: <Users size={13} className="text-black" />,
          label: t('common.users'),
          href: '/dash/users/settings/users'
        }
      case 'org':
        return {
          icon: <School size={13} className="text-black" />,
          label: t('common.organization'),
          href: '/dash/org/settings/general'
        }
      case 'payments':
        return {
          icon: <CreditCard size={13} className="text-black" />,
          label: t('common.payments'),
          href: '/dash/payments'
        }
      default:
        return null
    }
  }

  const config = getBreadcrumbConfig()

  return (
    <div className="flex pt-6 items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.2em]">
      {config && (
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white border border-gray-200/60 shadow-xs">
            {config.icon}
          </div>
          <Link 
            href={config.href}
            className="text-gray-400 hover:text-black transition-colors"
          >
            {config.label}
          </Link>
        </div>
      )}
      
      {props.last_breadcrumb && (
        <div className="flex items-center gap-2.5">
          <ChevronRight size={12} className="text-gray-300" />
          <span className="text-gray-900 line-clamp-1">
            {props.last_breadcrumb}
          </span>
        </div>
      )}
    </div>
  )
}

export default BreadCrumbs
