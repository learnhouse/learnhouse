'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  Backpack,
  Book,
  ChevronRight,
  CreditCard,
  School,
  User,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import React from 'react'

type BreadCrumbsProps = {
  type:
    | 'courses'
    | 'user'
    | 'users'
    | 'org'
    | 'orgusers'
    | 'assignments'
    | 'payments'
  last_breadcrumb?: string
}

function BreadCrumbs(props: BreadCrumbsProps) {
  const org = useOrg() as any

  return (
    <div>
      <div className="h-7"></div>
      <div className="flex space-x-1 text-sm font-medium tracking-tight text-gray-400">
        <div className="flex items-center space-x-1">
          {props.type == 'courses' ? (
            <div className="flex items-center space-x-2">
              {' '}
              <Book className="text-gray" size={14}></Book>
              <Link href="/dash/courses">Courses</Link>
            </div>
          ) : (
            ''
          )}
          {props.type == 'assignments' ? (
            <div className="flex items-center space-x-2">
              {' '}
              <Backpack className="text-gray" size={14}></Backpack>
              <Link href="/dash/assignments">Assignments</Link>
            </div>
          ) : (
            ''
          )}
          {props.type == 'user' ? (
            <div className="flex items-center space-x-2">
              {' '}
              <User className="text-gray" size={14}></User>
              <Link href="/dash/user-account/settings/general">
                Account Settings
              </Link>
            </div>
          ) : (
            ''
          )}
          {props.type == 'orgusers' ? (
            <div className="flex items-center space-x-2">
              {' '}
              <Users className="text-gray" size={14}></Users>
              <Link href="/dash/users/settings/users">Organization users</Link>
            </div>
          ) : (
            ''
          )}

          {props.type == 'org' ? (
            <div className="flex items-center space-x-2">
              {' '}
              <School className="text-gray" size={14}></School>
              <Link href="/dash/users">Organization Settings</Link>
            </div>
          ) : (
            ''
          )}
          {props.type == 'payments' ? (
            <div className="flex items-center space-x-2">
              {' '}
              <CreditCard className="text-gray" size={14}></CreditCard>
              <Link href="/dash/payments">Payments</Link>
            </div>
          ) : (
            ''
          )}
          <div className="flex items-center space-x-1 first-letter:uppercase">
            {props.last_breadcrumb ? <ChevronRight size={17} /> : ''}
            <div className="first-letter:uppercase">
              {' '}
              {props.last_breadcrumb}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BreadCrumbs
