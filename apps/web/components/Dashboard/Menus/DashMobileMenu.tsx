'use client'
import { createPortal } from 'react-dom'
import { useOrg } from '@components/Contexts/OrgContext'
import { signOut } from '@components/Contexts/AuthContext'
import {
  House,
  BookOpen,
  Files,
  Users,
  CurrencyCircleDollar,
  Buildings,
  Globe,
  Gear,
  SignOut,
  ChatsCircle,
  Headphones,
  ChartBar,
  ChalkboardSimple,
  Cube,
  List,
  X,
  Check,
  ChatCircleDots,
  Book,
  CaretDown,
  MagnifyingGlass,
} from '@phosphor-icons/react'
import { DiscordIcon } from '@components/Objects/Icons/DiscordIcon'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import UserAvatar from '../../Objects/UserAvatar'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg, getDeploymentMode } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/lib/i18n'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'
import { usePlan } from '@components/Hooks/usePlan'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { useCommandPalette } from '@components/Dashboard/CommandPalette/CommandPaletteContext'

function DashMobileMenu() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const { t, i18n } = useTranslation()
  const pathname = usePathname() || ''
  const plan = usePlan()
  const { toggle: openSearch } = useCommandPalette()
  const [menuOpen, setMenuOpen] = useState(false)
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const [langExpanded, setLangExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)

  React.useEffect(() => { setMounted(true) }, [])

  if (!org || !session || !mounted) return null

  const mode = getDeploymentMode()
  const planLabel =
    mode === 'ee' ? 'Enterprise Edition' :
    mode === 'oss' ? 'OSS' :
    plan

  const rf = org?.config?.config?.resolved_features
  const isEnabled = (f: string) => rf?.[f]?.enabled === true

  const isActive = (path: string) => {
    if (path === '/dash') return pathname === '/dash' || pathname === '/dash/'
    return pathname === path || pathname.startsWith(path + '/')
  }

  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: getUriWithOrg(org.slug, '/login') })
  }

  const close = () => { setMenuOpen(false); setLangExpanded(false) }

  return createPortal(
    <>
      {/* Floating pill */}
      <nav
        aria-label="Dashboard mobile navigation"
        className="fixed inset-x-0 mx-auto w-fit z-[9999]"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
      >
        <div
          className="flex items-center gap-0.5 px-1.5 py-1.5 bg-[#111113]/92 backdrop-blur-xl rounded-full border border-white/[0.1]"
          style={{ boxShadow: '0 4px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)' }}
        >
          {/* Home — always visible */}
          <PillLink href="/dash" icon={<House size={18} weight="fill" />} active={isActive('/dash')} />
          {/* Progressive reveal on wider screens */}
          <PillLink href="/dash/courses" icon={<BookOpen size={18} weight="fill" />} active={isActive('/dash/courses')} className="hidden min-[340px]:flex" />
          <PillLink href="/dash/assignments" icon={<Files size={18} weight="fill" />} active={isActive('/dash/assignments')} className="hidden min-[390px]:flex" />
          <PillLink href="/dash/users/settings/users" icon={<Users size={18} weight="fill" />} active={isActive('/dash/users')} className="hidden min-[430px]:flex" />
          {isEnabled('communities') && (
            <PillLink href="/dash/communities" icon={<ChatsCircle size={18} weight="fill" />} active={isActive('/dash/communities')} className="hidden min-[470px]:flex" />
          )}

          <span className="w-px h-4 bg-white/[0.15] mx-1 shrink-0" />

          {/* Search */}
          <button
            onClick={openSearch}
            aria-label="Search"
            className="p-2.5 rounded-full transition-all duration-200 text-white/60 hover:text-white hover:bg-white/[0.1]"
          >
            <MagnifyingGlass size={18} weight="bold" />
          </button>

          {/* Menu toggle */}
          <button
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className={cn(
              'p-2.5 rounded-full transition-all duration-200 overflow-hidden',
              menuOpen ? 'bg-white text-[#111113]' : 'text-white/60 hover:text-white hover:bg-white/[0.1]'
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {menuOpen
                ? <motion.span key="x" className="flex" initial={{ rotate: -45, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 45, opacity: 0 }} transition={{ duration: 0.15 }}><X size={18} weight="bold" /></motion.span>
                : <motion.span key="list" className="flex" initial={{ rotate: 45, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -45, opacity: 0 }} transition={{ duration: 0.15 }}><List size={18} weight="fill" /></motion.span>
              }
            </AnimatePresence>
          </button>
        </div>
      </nav>

      {/* Compact menu panel */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[9997] bg-black/50 backdrop-blur-[3px]"
              onClick={close}
            />

            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ type: 'spring', damping: 28, stiffness: 340 }}
              className="fixed left-4 right-4 z-[9998] max-w-xs mx-auto bg-[#111113] rounded-2xl border border-white/[0.08] overflow-hidden"
              style={{
                bottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)',
                boxShadow: '0 16px 48px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              {/* Org header */}
              <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-white/[0.06]">
                {plan === 'enterprise' && org?.logo_image ? (
                  <img
                    src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
                    alt={org?.name}
                    className="h-6 w-6 object-contain rounded-md"
                  />
                ) : (
                  <img src="/lrn-dash.svg" alt="LearnHouse" className="h-5 w-5" style={{ filter: 'brightness(0) invert(1)' }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white leading-tight truncate">{org?.name}</p>
                  <p className={cn(
                    'text-[9px] font-medium uppercase tracking-wider',
                    mode === 'ee' ? 'text-amber-400' :
                    mode === 'oss' ? 'text-green-400' :
                    plan === 'enterprise' ? 'text-amber-400' :
                    plan === 'pro' ? 'text-purple-400' :
                    plan === 'standard' ? 'text-blue-400' :
                    'text-white/40'
                  )}>{planLabel}</p>
                </div>
              </div>

              {/* Nav items */}
              <div className="py-1.5 px-1.5 max-h-[52vh] overflow-y-auto overscroll-contain space-y-0.5">
                <PanelItem href="/dash" icon={<House size={16} weight="fill" />} label={t('common.home')} active={isActive('/dash')} onClick={close} />
                <PanelItem href="/dash/courses" icon={<BookOpen size={16} weight="fill" />} label={t('courses.courses')} active={isActive('/dash/courses')} onClick={close} />
                <PanelItem href="/dash/assignments" icon={<Files size={16} weight="fill" />} label={t('common.assignments')} active={isActive('/dash/assignments')} onClick={close} />
                {isEnabled('communities') && <PanelItem href="/dash/communities" icon={<ChatsCircle size={16} weight="fill" />} label={t('communities.title')} active={isActive('/dash/communities')} onClick={close} />}
                {isEnabled('podcasts') && <PanelItem href="/dash/podcasts" icon={<Headphones size={16} weight="fill" />} label={t('podcasts.podcasts')} active={isActive('/dash/podcasts')} onClick={close} />}
                {isEnabled('boards') && <PanelItem href="/dash/boards" icon={<ChalkboardSimple size={16} weight="fill" />} label="Boards" active={isActive('/dash/boards')} onClick={close} />}
                {isEnabled('playgrounds') && <PanelItem href="/dash/playgrounds" icon={<Cube size={16} weight="fill" />} label="Playgrounds" active={isActive('/dash/playgrounds')} onClick={close} />}
                <PanelItem href="/dash/users/settings/users" icon={<Users size={16} weight="fill" />} label={t('common.users')} active={isActive('/dash/users')} onClick={close} />
                {isEnabled('payments') && <PanelItem href="/dash/payments/overview" icon={<CurrencyCircleDollar size={16} weight="fill" />} label={t('common.payments')} active={isActive('/dash/payments')} onClick={close} />}
                <PanelItem href="/dash/org/settings/general" icon={<Buildings size={16} weight="fill" />} label={t('common.organization')} active={isActive('/dash/org')} onClick={close} />
                <PanelItem href="/dash/analytics" icon={<ChartBar size={16} weight="fill" />} label="Analytics" active={isActive('/dash/analytics')} onClick={close} />

                <div className="my-1 mx-2 border-t border-white/[0.06]" />

                <PanelItem href="/account/general" icon={<Gear size={16} weight="fill" />} label={t('common.settings')} active={isActive('/account')} onClick={close} />

                {/* Language picker */}
                <button
                  onClick={() => setLangExpanded(v => !v)}
                  className="flex items-center w-full rounded-lg px-2.5 py-2 gap-2 text-white/50 hover:text-white hover:bg-white/[0.06] transition-all"
                >
                  <Globe size={16} weight="fill" />
                  <span className="text-sm font-medium flex-1 text-left">{t('common.language')}</span>
                  <CaretDown size={11} weight="bold" className={cn('text-white/30 transition-transform', langExpanded && 'rotate-180')} />
                </button>
                {langExpanded && (
                  <div className="ml-2 pl-2 border-l border-white/[0.06] space-y-0.5">
                    {AVAILABLE_LANGUAGES.map(lang => (
                      <button
                        key={lang.code}
                        onClick={() => { changeLanguage(lang.code); setLangExpanded(false) }}
                        className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/[0.06] transition-all"
                      >
                        <span className="font-medium">{lang.nativeName}</span>
                        {i18n.language.split('-')[0] === lang.code && <Check size={12} weight="bold" className="text-green-500" />}
                      </button>
                    ))}
                  </div>
                )}

                <a
                  href="https://docs.learnhouse.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center w-full rounded-lg px-2.5 py-2 gap-2 text-white/50 hover:text-white hover:bg-white/[0.06] transition-all"
                >
                  <Book size={16} weight="fill" />
                  <span className="text-sm font-medium">{t('common.help_menu.documentation')}</span>
                </a>
                <a
                  href="https://discord.gg/learnhouse"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center w-full rounded-lg px-2.5 py-2 gap-2 text-white/50 hover:text-white hover:bg-white/[0.06] transition-all"
                >
                  <DiscordIcon size={16} />
                  <span className="text-sm font-medium">{t('common.help_menu.discord')}</span>
                </a>
                <button
                  onClick={() => { setFeedbackModalOpen(true); close() }}
                  className="flex items-center w-full rounded-lg px-2.5 py-2 gap-2 text-white/50 hover:text-white hover:bg-white/[0.06] transition-all"
                >
                  <ChatCircleDots size={16} weight="fill" />
                  <span className="text-sm font-medium">{t('common.help_menu.report_feedback')}</span>
                </button>
              </div>

              {/* User footer */}
              <div className="border-t border-white/[0.06] px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <UserAvatar width={26} rounded="rounded-full" shadow="shadow-none" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white/90 truncate">{session?.data?.user?.username}</p>
                    <p className="text-[10px] text-white/40 truncate">{session?.data?.user?.email}</p>
                  </div>
                  <button
                    onClick={logOutUI}
                    aria-label={t('user.sign_out')}
                    className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-white/[0.05] transition-all"
                  >
                    <SignOut size={15} weight="fill" />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <FeedbackModal
        open={feedbackModalOpen}
        onOpenChange={setFeedbackModalOpen}
        theme="dark"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </>,
    document.body
  )
}

const PillLink = ({
  href,
  icon,
  active,
  className,
}: {
  href: string
  icon: React.ReactNode
  active: boolean
  className?: string
}) => (
  <Link
    href={href}
    className={cn(
      'flex items-center justify-center p-2.5 rounded-full transition-all duration-200',
      active ? 'bg-white/[0.15] text-white' : 'text-white/50 hover:text-white hover:bg-white/[0.08]',
      className
    )}
  >
    {icon}
  </Link>
)

const PanelItem = ({
  href,
  icon,
  label,
  active,
  onClick,
}: {
  href: string
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) => (
  <Link
    href={href}
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={cn(
      'relative flex items-center w-full rounded-lg px-2.5 py-2 gap-2 transition-all',
      active ? 'text-white bg-white/[0.08]' : 'text-white/50 hover:text-white hover:bg-white/[0.06]'
    )}
  >
    {active && (
      <span
        aria-hidden="true"
        className="absolute left-0.5 top-1/2 -translate-y-1/2 h-4 w-[2px] bg-white rounded-full"
      />
    )}
    {icon}
    <span className="text-sm font-medium">{label}</span>
  </Link>
)

export default DashMobileMenu
