'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { HeaderProfileBox } from '@components/Security/HeaderProfileBox'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useTranslation } from 'react-i18next'
import DocSearchBar from './DocSearchBar'
import {
  Question,
  Book,
  Globe,
  ChatCircleDots,
  SquaresFour,
} from '@phosphor-icons/react'
import PhosphorIconRenderer from './PhosphorIconRenderer'
import { DiscordIcon } from '@components/Objects/Icons/DiscordIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { DASHBOARD_MENU_ITEMS, DashboardMenuItem } from '@/lib/dashboard-menu-items'
import { isFeatureAvailable, PlanLevel } from '@services/plans/plans'
import { useJoinBannerVisible, JOIN_BANNER_HEIGHT } from '@components/Objects/Banners/OrgJoinBanner'
import { usePlan } from '@components/Hooks/usePlan'

interface DocOrgMenuProps {
  meta: any
  spaceslug: string
  orgslug: string
  currentSectionSlug?: string
}

const DocOrgMenu = ({
  meta,
  spaceslug,
  orgslug,
  currentSectionSlug,
}: DocOrgMenuProps) => {
  const session = useLHSession() as any
  const org = useOrg() as any
  const { rights } = useAdminStatus()
  const { t } = useTranslation()
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { isVisible: isJoinBannerVisible } = useJoinBannerVisible()
  const topOffset = isJoinBannerVisible ? JOIN_BANNER_HEIGHT : 0

  const plan = usePlan()

  // Filter dashboard menu items by feature enabled + plan availability
  const visibleDashboardItems = DASHBOARD_MENU_ITEMS.filter((item: DashboardMenuItem) => {
    if (!item.featureKey) return true
    const featureConfig = org?.config?.config?.features?.[item.featureKey]
    const isEnabled = item.defaultDisabled ? featureConfig?.enabled === true : featureConfig?.enabled !== false
    return isEnabled && isFeatureAvailable(item.featureKey, plan)
  })

  const sections = meta?.sections || []
  const navConfig = meta?.nav_config

  return (
    <>
      {/* Blur spacer — matches OrgMenu's blur div */}
      <div className="backdrop-blur-lg h-[60px] blur-3xl" style={{ zIndex: 'var(--z-behind)', marginTop: topOffset }} />

      {/* Fixed nav bar */}
      <div
        className="backdrop-blur-lg fixed left-0 right-0 h-[60px] bg-white/90 nice-shadow"
        style={{
          zIndex: 'var(--z-nav)',
          top: topOffset,
        }}
      >
        <div className="flex items-center justify-between w-full max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 h-full">
          {/* Left: Logo + separator + space name */}
          <div className="flex items-center space-x-4 md:w-auto w-full">
            <div className="logo flex md:w-auto w-full justify-center">
              <Link href={getUriWithOrg(orgslug, '/')}>
                <div className="flex w-auto h-9 rounded-md items-center m-auto py-1 justify-center">
                  {org?.logo_image ? (
                    <img
                      src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
                      alt={org.name || 'Home'}
                      style={{ width: 'auto', height: '100%' }}
                      className="rounded-md"
                    />
                  ) : (
                    <span className="font-bold text-base text-gray-900">
                      {org?.name || 'Home'}
                    </span>
                  )}
                </div>
              </Link>
            </div>

            <span className="text-gray-200 text-lg font-light hidden sm:block">/</span>

            <Link
              href={`/docs/${spaceslug}`}
              className="font-semibold text-gray-700 hover:text-black text-sm hidden sm:block truncate max-w-[200px]"
            >
              {meta?.name || 'Documentation'}
            </Link>

            {/* Custom nav links — next to space name */}
            <div className="hidden lg:flex items-center space-x-4 ml-2">
              {navConfig?.links?.map((link: any, i: number) => (
                <a
                  key={i}
                  href={link.url}
                  target={link.new_tab ? '_blank' : undefined}
                  rel={link.new_tab ? 'noopener noreferrer' : undefined}
                  className="text-sm text-gray-500 hover:text-gray-800 font-medium whitespace-nowrap transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          {/* Center: search — matches OrgMenu search placement */}
          <div className="hidden md:flex flex-1 justify-center max-w-lg px-4">
            <DocSearchBar
              docspaceUuid={meta?.docspace_uuid}
              spaceslug={spaceslug}
              inline
            />
          </div>

          {/* Right: dashboard + help + profile */}
          <div className="flex items-center space-x-2">
            {/* Dashboard dropdown */}
            {session?.status === 'authenticated' &&
              rights?.dashboard?.action_access && (
                <div className="hidden md:flex">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-2 rounded-lg transition-colors hover:bg-gray-100 text-gray-600"
                        aria-label={t('common.dashboard')}
                      >
                        <SquaresFour size={20} weight="fill" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="flex items-center gap-2">
                        <SquaresFour size={16} weight="fill" />
                        <span>{t('common.dashboard')}</span>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {visibleDashboardItems.map((item) => {
                        const IconComponent = item.icon
                        return (
                          <DropdownMenuItem key={item.id} asChild>
                            <Link
                              href={item.href}
                              className="flex items-center gap-2"
                            >
                              <IconComponent size={16} weight="fill" />
                              <span>{t(item.labelKey)}</span>
                            </Link>
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

            {/* Help dropdown */}
            {session?.status === 'authenticated' &&
              rights?.dashboard?.action_access && (
                <div className="hidden md:flex">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-2 rounded-lg transition-colors hover:bg-gray-100 text-gray-600"
                        aria-label={t('common.help')}
                      >
                        <Question size={20} weight="fill" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="flex items-center gap-2">
                        <Question size={16} weight="fill" />
                        <span>{t('common.help')}</span>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a
                          href="https://docs.learnhouse.app"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2"
                        >
                          <Book size={16} weight="fill" />
                          <span>{t('common.help_menu.documentation')}</span>
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a
                          href="https://learnhouse.app"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2"
                        >
                          <Globe size={16} weight="fill" />
                          <span>{t('common.help_menu.website')}</span>
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a
                          href="https://discord.gg/learnhouse"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2"
                        >
                          <DiscordIcon size={16} />
                          <span>{t('common.help_menu.discord')}</span>
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setFeedbackModalOpen(true)}
                        className="flex items-center gap-2"
                      >
                        <ChatCircleDots size={16} weight="fill" />
                        <span>{t('common.help_menu.report_feedback')}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

            <div className="hidden md:flex">
              <HeaderProfileBox />
            </div>

            {/* Mobile menu toggle */}
            <button
              className="md:hidden focus:outline-hidden text-gray-600"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Section tabs bar — pinned below the nav bar */}
      {sections.length > 0 && (
        <div
          className="fixed left-0 right-0 bg-white/95 backdrop-blur-sm nice-shadow"
          style={{
            zIndex: 'var(--z-nav)',
            top: topOffset + 60,
          }}
        >
          <div className="max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-1 -mb-px overflow-x-auto">
              {sections.map((section: any) => {
                const isActive = section.slug === currentSectionSlug
                return (
                  <Link
                    key={section.docsection_uuid}
                    href={`/docs/${spaceslug}/${section.slug}`}
                    className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
                      isActive
                        ? 'border-black text-black'
                        : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {section.icon && (
                      <PhosphorIconRenderer
                        iconName={section.icon}
                        size={14}
                        className={isActive ? 'text-black' : 'text-gray-400'}
                      />
                    )}
                    {section.name}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Spacer for fixed elements */}
      <div style={{ height: sections.length > 0 ? 42 : 0 }} />

      {/* Mobile menu dropdown */}
      <div
        className={`fixed inset-x-0 bg-white/80 backdrop-blur-lg md:hidden shadow-lg transition-all duration-300 ease-in-out ${
          isMenuOpen ? 'opacity-100' : '-top-full opacity-0'
        }`}
        style={{
          zIndex: 'var(--z-nav-menu)',
          top: isMenuOpen
            ? topOffset + 60 + (sections.length > 0 ? 42 : 0)
            : undefined,
        }}
      >
        <div className="flex flex-col px-4 py-3 space-y-4 justify-center items-center">
          {/* Mobile search */}
          <div className="w-full px-2">
            <DocSearchBar
              docspaceUuid={meta?.docspace_uuid}
              spaceslug={spaceslug}
            />
          </div>

          {/* Mobile custom links */}
          {navConfig?.links?.map((link: any, i: number) => (
            <a
              key={i}
              href={link.url}
              target={link.new_tab ? '_blank' : undefined}
              rel={link.new_tab ? 'noopener noreferrer' : undefined}
              className="text-sm text-gray-600 hover:text-gray-900 font-semibold"
            >
              {link.label}
            </a>
          ))}

          <div className="border-t border-gray-200 pt-3">
            <HeaderProfileBox />
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      <FeedbackModal
        open={feedbackModalOpen}
        onOpenChange={setFeedbackModalOpen}
        theme="light"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </>
  )
}

export default DocOrgMenu
