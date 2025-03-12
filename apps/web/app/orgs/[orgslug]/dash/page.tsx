import Image from 'next/image'
import React from 'react'
import learnhousetextlogo from '../../../../public/learnhouse_logo.png'
import { BookCopy, School, Settings, University, Users } from 'lucide-react'
import Link from 'next/link'
import AdminAuthorization from '@components/Security/AdminAuthorization'

function DashboardHome() {
  return (
    <div className="flex items-center justify-center mx-auto min-h-screen flex-col p-4 sm:mb-0 mb-16">
      <div className="mx-auto pb-6 sm:pb-10">
        <Image
          alt="learnhouse logo"
          width={230}
          src={learnhousetextlogo}
          className="w-48 sm:w-auto"
        />
      </div>
      <AdminAuthorization authorizationMode="component">
        <div className="flex flex-col sm:flex-row gap-4 lg:gap-10">
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
      <div className="flex flex-col gap-6 sm:gap-10 mt-6 sm:mt-10">
        <AdminAuthorization authorizationMode="component">
          <div className="h-1 w-[100px] bg-neutral-200/100 rounded-full mx-auto"></div>
          <div className="flex justify-center items-center">
            <Link
              href={'https://university.learnhouse.io/'}
              target='_blank'
              className="flex mt-4 sm:mt-[40px] bg-black gap-2 items-center py-3 px-7 rounded-lg shadow-lg hover:scale-105 transition-all ease-linear cursor-pointer"
            >
              <University className="text-gray-100/100" size={20} />
              <div className="text-sm font-bold text-gray-100/100">
                LearnHouse University
              </div>
            </Link>
          </div>
          <div className="mx-auto mt-4 sm:mt-[40px] w-28 h-1 bg-neutral-200/100 rounded-full"></div>
        </AdminAuthorization>

        <Link
          href={'/dash/user-account/settings/general'}
          className="flex bg-white shadow-lg p-4 items-center rounded-lg mx-auto hover:scale-105 transition-all ease-linear cursor-pointer max-w-md"
        >
          <div className="flex flex-col sm:flex-row mx-auto gap-2 sm:gap-3 items-center text-center sm:text-left">
            <Settings className="text-gray-500/100" size={20} />
            <div>
              <div className="font-bold text-gray-500/100">Account Settings</div>
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
function DashboardCard({ href, icon, title, description }: { href: string, icon: React.ReactNode, title: string, description: string }) {
  return (
    <Link
      href={href}
      className="flex bg-white shadow-lg p-6 w-full sm:w-[250px] rounded-lg items-center mx-auto hover:scale-105 transition-all ease-linear cursor-pointer"
    >
      <div className="flex flex-col mx-auto gap-2">
        {icon}
        <div className="text-center font-bold text-gray-500/100">{title}</div>
        <p className="text-center text-sm text-gray-400/100">{description}</p>
      </div>
    </Link>
  )
}

export default DashboardHome
