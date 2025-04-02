'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import {
  Backpack,
  BadgeDollarSign,
  BookCopy,
  Home,
  School,
  Settings,
  Users,
} from 'lucide-react'
import Link from 'next/link'

function DashMobileMenu() {
  const org = useOrg() as any
  const session = useLHSession() as any

  return (
    <div className="fixed right-0 bottom-0 left-0 bg-black/90 text-white shadow-xl backdrop-blur-lg">
      <div className="flex h-16 items-center justify-around px-2">
        <AdminAuthorization authorizationMode="component">
          <ToolTip content={'Home'} slateBlack sideOffset={8} side="top">
            <Link href={`/`} className="flex flex-col items-center p-2">
              <Home size={20} />
              <span className="mt-1 text-xs">Home</span>
            </Link>
          </ToolTip>
          <ToolTip content={'Courses'} slateBlack sideOffset={8} side="top">
            <Link
              href={`/dash/courses`}
              className="flex flex-col items-center p-2"
            >
              <BookCopy size={20} />
              <span className="mt-1 text-xs">Courses</span>
            </Link>
          </ToolTip>
          <ToolTip content={'Assignments'} slateBlack sideOffset={8} side="top">
            <Link
              href={`/dash/assignments`}
              className="flex flex-col items-center p-2"
            >
              <Backpack size={20} />
              <span className="mt-1 text-xs">Assignments</span>
            </Link>
          </ToolTip>
          <ToolTip content={'Payments'} slateBlack sideOffset={8} side="top">
            <Link
              href={`/dash/payments/customers`}
              className="flex flex-col items-center p-2"
            >
              <BadgeDollarSign size={20} />
              <span className="mt-1 text-xs">Payments</span>
            </Link>
          </ToolTip>
          <ToolTip content={'Users'} slateBlack sideOffset={8} side="top">
            <Link
              href={`/dash/users/settings/users`}
              className="flex flex-col items-center p-2"
            >
              <Users size={20} />
              <span className="mt-1 text-xs">Users</span>
            </Link>
          </ToolTip>
          <ToolTip
            content={'Organization'}
            slateBlack
            sideOffset={8}
            side="top"
          >
            <Link
              href={`/dash/org/settings/general`}
              className="flex flex-col items-center p-2"
            >
              <School size={20} />
              <span className="mt-1 text-xs">Org</span>
            </Link>
          </ToolTip>
        </AdminAuthorization>
        <ToolTip
          content={session.data.user.username + "'s Settings"}
          slateBlack
          sideOffset={8}
          side="top"
        >
          <Link
            href={'/dash/user-account/settings/general'}
            className="flex flex-col items-center p-2"
          >
            <Settings size={20} />
            <span className="mt-1 text-xs">Settings</span>
          </Link>
        </ToolTip>
      </div>
    </div>
  )
}

export default DashMobileMenu
