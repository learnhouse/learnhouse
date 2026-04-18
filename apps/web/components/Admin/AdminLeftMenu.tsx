'use client'
import {
  Buildings,
  ChartBar,
  SignOut,
  User,
  Users,
} from '@phosphor-icons/react'
import { signOut } from '@components/Contexts/AuthContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import Link from 'next/link'
import React from 'react'

function AdminTopMenu() {
  const session = useLHSession() as any

  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: '/login' })
  }

  if (!session) return null

  const user = session?.data?.user
  const avatarUrl = user?.avatar_image
    ? user.avatar_image.startsWith('http')
      ? user.avatar_image
      : getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image)
    : null

  return (
    <>
      {/* Spacer to push content below the fixed menu */}
      <div className="h-14" />
      {/* Fixed menu bar */}
      <div
        className="fixed top-0 start-0 end-0 h-14 bg-black border-b border-white/[0.08] flex items-center text-white px-4 gap-6"
        style={{ zIndex: 'var(--z-overlay)' }}
      >
        {/* Logo */}
        <Link className="flex items-center gap-2 transition-opacity hover:opacity-70 shrink-0" href="/">
          <img src="/lrn-dash.svg" alt="Learnhouse logo" className="h-7 w-7" />
          <span className="font-semibold text-sm text-white">Admin</span>
          <span className="text-[9px] font-medium uppercase tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
            Superadmin
          </span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          <NavLink
            href="/organizations"
            icon={<Buildings size={16} weight="fill" />}
            label="Organizations"
          />
          <NavLink
            href="/users"
            icon={<Users size={16} weight="fill" />}
            label="Users"
          />
          <NavLink
            href="/analytics"
            icon={<ChartBar size={16} weight="fill" />}
            label="Analytics"
          />
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User section */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-6 h-6 rounded-full object-cover bg-gray-700"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                <User size={14} weight="fill" className="text-white/50" />
              </div>
            )}
            <span className="text-sm text-white/60 hidden sm:inline">
              {user?.username}
            </span>
          </div>
          <button
            onClick={logOutUI}
            className="flex items-center gap-1.5 rounded-lg text-red-500 hover:text-red-400 hover:bg-white/[0.08] transition-all px-2 py-1.5"
            title="Sign Out"
          >
            <SignOut size={16} weight="fill" />
            <span className="text-xs font-medium hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </>
  )
}

const NavLink = ({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) => {
  return (
    <Link aria-label={label} href={href}>
      <div className="flex items-center rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-all px-3 py-1.5 gap-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
    </Link>
  )
}

export default AdminTopMenu
