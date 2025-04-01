import AdminAuthorization from '@components/Security/AdminAuthorization'
import { BookCopy, School, Settings, University, Users } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type React from 'react'
import learnhousetextlogo from '@public/learnhouse_logo.png'

function DashboardHome() {
  return (
    <div className="mx-auto mb-16 flex min-h-screen flex-col items-center justify-center p-4 sm:mb-0">
      <div className="mx-auto pb-6 sm:pb-10">
        <Image
          alt="learnhouse logo"
          width={230}
          src={learnhousetextlogo}
          className="w-48 sm:w-auto"
        />
      </div>
      <AdminAuthorization authorizationMode="component">
        <div className="flex flex-col gap-4 sm:flex-row lg:gap-10">
          {/* Card components */}
          <DashboardCard
            href="/dash/courses"
            icon={<BookCopy className="mx-auto text-gray-500/100" size={50} />}
            title="Courses"
            description="Create and manage courses, chapters and activities"
          />
          <DashboardCard
            href="/dash/org/settings/general"
            icon={<School className="mx-auto text-gray-500/100" size={50} />}
            title="Organization"
            description="Configure your Organization general settings"
          />
          <DashboardCard
            href="/dash/users/settings/users"
            icon={<Users className="mx-auto text-gray-500/100" size={50} />}
            title="Users"
            description="Manage your Organization's users, roles"
          />
        </div>
      </AdminAuthorization>
      <div className="mt-6 flex flex-col gap-6 sm:mt-10 sm:gap-10">
        <AdminAuthorization authorizationMode="component">
          <div className="mx-auto h-1 w-[100px] rounded-full bg-neutral-200/100"></div>
          <div className="flex items-center justify-center">
            <Link
              href={'https://university.learnhouse.io/'}
              target="_blank"
              className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg bg-black px-7 py-3 shadow-lg transition-all ease-linear hover:scale-105 sm:mt-[40px]"
            >
              <University className="text-gray-100/100" size={20} />
              <div className="text-sm font-bold text-gray-100/100">
                LearnHouse University
              </div>
            </Link>
          </div>
          <div className="mx-auto mt-4 h-1 w-28 rounded-full bg-neutral-200/100 sm:mt-[40px]"></div>
        </AdminAuthorization>

        <Link
          href={'/dash/user-account/settings/general'}
          className="mx-auto flex max-w-md cursor-pointer items-center rounded-lg bg-white p-4 shadow-lg transition-all ease-linear hover:scale-105"
        >
          <div className="mx-auto flex flex-col items-center gap-2 text-center sm:flex-row sm:gap-3 sm:text-left">
            <Settings className="text-gray-500/100" size={20} />
            <div>
              <div className="font-bold text-gray-500/100">
                Account Settings
              </div>
              <p className="text-sm text-gray-400/100">
                Configure your personal settings, passwords, email
              </p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}

// New component for dashboard cards
function DashboardCard({
  href,
  icon,
  title,
  description,
}: {
  href: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="mx-auto flex w-full cursor-pointer items-center rounded-lg bg-white p-6 shadow-lg transition-all ease-linear hover:scale-105 sm:w-[250px]"
    >
      <div className="mx-auto flex flex-col gap-2">
        {icon}
        <div className="text-center font-bold text-gray-500/100">{title}</div>
        <p className="text-center text-sm text-gray-400/100">{description}</p>
      </div>
    </Link>
  )
}

export default DashboardHome
