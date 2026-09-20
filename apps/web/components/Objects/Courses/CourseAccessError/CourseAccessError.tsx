'use client'
import Link from 'next/link'
import React from 'react'
import { usePathname } from 'next/navigation'
import { LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUriWithOrg } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'

type CourseAccessErrorProps = {
  error: any
  orgslug: string
}

function CourseAccessError({ error, orgslug }: CourseAccessErrorProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const pathname = usePathname()

  // A signed-out visitor hitting a members-only course isn't an error from
  // their point of view: signing in is the way through, so offer that and
  // bring them back here afterwards.
  const needsSignIn = error?.status === 403 && session?.status === 'unauthenticated'

  if (needsSignIn) {
    const redirect = pathname && /^\/(?!\/)/.test(pathname) ? pathname : '/courses'
    return (
      <GeneralWrapperStyled>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            {t('course.signInRequired')}
          </h2>
          <p className="text-gray-500 mb-6">{t('course.signInRequiredDescription')}</p>
          <Link
            href={getUriWithOrg(orgslug, `/login?redirect=${encodeURIComponent(redirect)}`)}
            className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-black/90"
          >
            <LogIn size={16} />
            {t('course.signInToContinue')}
          </Link>
          <Link
            href={getUriWithOrg(orgslug, '/courses')}
            className="mt-4 text-sm text-gray-500 hover:underline"
          >
            {t('course.backToCourses', 'Back to Courses')}
          </Link>
        </div>
      </GeneralWrapperStyled>
    )
  }

  return (
    <GeneralWrapperStyled>
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
        <h2 className="text-xl font-semibold text-gray-700 mb-2">
          {t('course.accessDenied', 'Unable to access this course')}
        </h2>
        <p className="text-gray-500 mb-4">
          {error?.status === 403
            ? t('course.noPermission', 'You do not have permission to view this course.')
            : t('course.loadError', 'This course could not be found or there was an error loading it.')}
        </p>
        <Link href={getUriWithOrg(orgslug, '/courses')} className="text-blue-600 hover:underline">
          {t('course.backToCourses', 'Back to Courses')}
        </Link>
      </div>
    </GeneralWrapperStyled>
  )
}

export default CourseAccessError
