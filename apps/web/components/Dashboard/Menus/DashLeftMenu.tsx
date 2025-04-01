'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import useFeatureFlag from '@components/Hooks/useFeatureFlag'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import LearnHouseDashboardLogo from '@public/dashLogo.png'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import {
  Backpack,
  BadgeDollarSign,
  BookCopy,
  Home,
  LogOut,
  Package2,
  School,
  Settings,
  Users,
} from 'lucide-react'
import { signOut } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import React, { useEffect } from 'react'
import UserAvatar from '@components/Objects/UserAvatar'

function DashLeftMenu() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const [loading, setLoading] = React.useState(true)
  const isPaymentsEnabled = useFeatureFlag({
    path: ['features', 'payments', 'enabled'],
    defaultValue: false,
  })

  function waitForEverythingToLoad() {
    if (org && session) {
      return true
    }
    return false
  }

  async function logOutUI() {
    const res = await signOut({
      redirect: true,
      callbackUrl: getUriWithoutOrg('/login?orgslug=' + org.slug),
    })
    if (res) {
      getUriWithOrg(org.slug, '/')
    }
  }

  useEffect(() => {
    if (waitForEverythingToLoad()) {
      setLoading(false)
    }
  }, [loading])

  return (
    <div
      style={{
        background:
          'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(271.56% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(20 19 19)',
      }}
      className="sticky top-0 flex h-screen w-[90px] flex-col bg-black text-white shadow-xl"
    >
      <div className="flex h-full flex-col">
        <div className="mt-6 flex h-20">
          <Link
            className="mx-auto flex flex-col items-center space-y-3"
            href={'/'}
          >
            <ToolTip
              content={'Back to Home'}
              slateBlack
              sideOffset={8}
              side="right"
            >
              <Image
                alt="Learnhouse logo"
                width={40}
                src={LearnHouseDashboardLogo}
              />
            </ToolTip>
            <ToolTip
              content={'Your Organization'}
              slateBlack
              sideOffset={8}
              side="right"
            >
              <div className="justify-center rounded-md bg-black/40 px-3 py-1 text-center text-[10px] opacity-40">
                {org?.name}
              </div>
            </ToolTip>
          </Link>
        </div>
        <div className="mx-auto flex grow flex-col items-center justify-center space-y-5">
          {/* <ToolTip content={"Back to " + org?.name + "'s Home"} slateBlack sideOffset={8} side='right'  >
                        <Link className='bg-white text-black hover:text-white rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/`} ><ArrowLeft className='hover:text-white' size={18} /></Link>
                    </ToolTip> */}
          <AdminAuthorization authorizationMode="component">
            <ToolTip content={'Home'} slateBlack sideOffset={8} side="right">
              <Link
                className="rounded-lg bg-white/5 p-2 transition-all ease-linear hover:bg-white/10"
                href={`/dash`}
              >
                <Home size={18} />
              </Link>
            </ToolTip>
            <ToolTip content={'Courses'} slateBlack sideOffset={8} side="right">
              <Link
                className="rounded-lg bg-white/5 p-2 transition-all ease-linear hover:bg-white/10"
                href={`/dash/courses`}
              >
                <BookCopy size={18} />
              </Link>
            </ToolTip>
            <ToolTip
              content={'Assignments'}
              slateBlack
              sideOffset={8}
              side="right"
            >
              <Link
                className="rounded-lg bg-white/5 p-2 transition-all ease-linear hover:bg-white/10"
                href={`/dash/assignments`}
              >
                <Backpack size={18} />
              </Link>
            </ToolTip>
            <ToolTip content={'Users'} slateBlack sideOffset={8} side="right">
              <Link
                className="rounded-lg bg-white/5 p-2 transition-all ease-linear hover:bg-white/10"
                href={`/dash/users/settings/users`}
              >
                <Users size={18} />
              </Link>
            </ToolTip>
            {isPaymentsEnabled && (
              <ToolTip
                content={'Payments'}
                slateBlack
                sideOffset={8}
                side="right"
              >
                <Link
                  className="rounded-lg bg-white/5 p-2 transition-all ease-linear hover:bg-white/10"
                  href={`/dash/payments/customers`}
                >
                  <BadgeDollarSign size={18} />
                </Link>
              </ToolTip>
            )}
            <ToolTip
              content={'Organization'}
              slateBlack
              sideOffset={8}
              side="right"
            >
              <Link
                className="rounded-lg bg-white/5 p-2 transition-all ease-linear hover:bg-white/10"
                href={`/dash/org/settings/general`}
              >
                <School size={18} />
              </Link>
            </ToolTip>
          </AdminAuthorization>
        </div>
        <div className="mx-auto flex flex-col space-y-2 pb-7">
          <div className="flex flex-col items-center space-y-2">
            <ToolTip
              content={'@' + session.data.user.username}
              slateBlack
              sideOffset={8}
              side="right"
            >
              <div className="mx-auto">
                <UserAvatar border="border-4" width={35} />
              </div>
            </ToolTip>
            <div className="flex flex-col items-center space-y-3">
              <div className="flex flex-col space-y-1 py-1">
                <ToolTip
                  content={session.data.user.username + "'s Owned Courses"}
                  slateBlack
                  sideOffset={8}
                  side="right"
                >
                  <Link href={'/dash/user-account/owned'} className="py-1">
                    <Package2
                      className="mx-auto cursor-pointer text-neutral-400"
                      size={18}
                    />
                  </Link>
                </ToolTip>
                <ToolTip
                  content={session.data.user.username + "'s Settings"}
                  slateBlack
                  sideOffset={8}
                  side="right"
                >
                  <Link
                    href={'/dash/user-account/settings/general'}
                    className="py-1"
                  >
                    <Settings
                      className="mx-auto cursor-pointer text-neutral-400"
                      size={18}
                    />
                  </Link>
                </ToolTip>
              </div>
              <ToolTip
                content={'Logout'}
                slateBlack
                sideOffset={8}
                side="right"
              >
                <LogOut
                  onClick={() => logOutUI()}
                  className="mx-auto cursor-pointer text-neutral-400"
                  size={14}
                />
              </ToolTip>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashLeftMenu
