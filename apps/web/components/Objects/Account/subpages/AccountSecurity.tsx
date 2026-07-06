'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updatePassword } from '@services/settings/password'
import { Formik, Form } from 'formik'
import React from 'react'
import { AlertTriangle, Monitor, LogOut } from 'lucide-react'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { Input } from "@components/ui/input"
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import { toast } from 'react-hot-toast'
import { signOut } from '@components/Contexts/AuthContext'
import { getUriWithoutOrg } from '@services/config/config'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import AccountDangerZone from '@components/Objects/Account/subpages/AccountDangerZone'

const validationSchema = Yup.object().shape({
  old_password: Yup.string().required('validation.required'),
  new_password: Yup.string()
    .required('validation.required')
    .min(8, 'validation.password_min_length'),
})

function AccountSecurity() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const { t } = useTranslation();

  // Current device/browser, parsed client-side from the user agent (in an effect
  // to avoid SSR hydration mismatch).
  const [device, setDevice] = React.useState<{ browser: string; os: string } | null>(null)
  React.useEffect(() => {
    const ua = navigator.userAgent
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /OPR\/|Opera/.test(ua) ? 'Opera' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Firefox\//.test(ua) ? 'Firefox' :
      /Safari\//.test(ua) ? 'Safari' : 'Browser'
    const os =
      /Windows/.test(ua) ? 'Windows' :
      /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
      /Linux/.test(ua) ? 'Linux' : ''
    setDevice({ browser, os })
  }, [])

  const updatePasswordUI = async (values: any) => {
    const user_id = session?.data?.user?.id
    if (!user_id) {
      toast.error(t('user.settings.password.update_failed', { defaultValue: 'Could not update password. Please sign in again.' }))
      return
    }
    const loadingToast = toast.loading(t('user.settings.password.updating'))
    try {
      const response = await updatePassword(user_id, values, access_token)

      if (response.success) {
        toast.dismiss(loadingToast)

        toast.success(t('user.settings.password.password_updated'), { duration: 4000 })
        toast(() => (
          <div className="flex items-center gap-2">
            <span>{t('user.settings.password.relogin_message')}</span>
          </div>
        ), {
          duration: 4000,
          icon: '🔑'
        })

        await new Promise(resolve => setTimeout(resolve, 4000))
        signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
      } else {
        toast.error(getErrorMessage(response.data?.detail, 'Failed to update password'), { id: loadingToast })
      }
    } catch (error: any) {
      const errorMessage = getErrorMessage(error?.data?.detail, 'Failed to update password. Please try again.')
      toast.error(errorMessage, { id: loadingToast })
      console.error('Password update error:', error)
    }
  }

  return (
    <>
    <div className="bg-white rounded-xl nice-shadow">
      <div className="flex flex-col gap-0">
        {/* Current session / device */}
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mt-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {t('user.settings.security.current_session_title', { defaultValue: 'Current session' })}
          </h1>
          <h2 className="text-gray-500 text-md">
            {t('user.settings.security.current_session_subtitle', { defaultValue: 'The device you are signed in from right now.' })}
          </h2>
        </div>
        <div className="mx-5 mt-3 mb-6">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <Monitor className="text-gray-400 shrink-0" size={20} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {device ? [device.browser, device.os].filter(Boolean).join(' · ') : '—'}
                </p>
                <p className="text-xs text-gray-500">
                  {t('user.settings.security.this_device', { defaultValue: 'This device' })}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })}
              className="gap-1.5 shrink-0"
            >
              <LogOut size={14} />
              {t('user.settings.security.sign_out', { defaultValue: 'Sign out' })}
            </Button>
          </div>
        </div>

        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {t('user.settings.password.title')}
          </h1>
          <h2 className="text-gray-500 text-md">
            {t('user.settings.password.subtitle')}
          </h2>
        </div>

        <div className="mx-5 mb-5">
          <Formik
            initialValues={{ old_password: '', new_password: '' }}
            validationSchema={validationSchema}
            onSubmit={async (values, { setSubmitting }) => {
              // Keep the form disabled for the WHOLE request (the old 400ms
              // setTimeout released it before the async call even ran, allowing
              // double-submit).
              try {
                await updatePasswordUI(values)
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {({ isSubmitting, handleChange, errors, touched }) => (
              <Form className="w-full max-w-2xl mx-auto space-y-6">
                <div>
                  <Label htmlFor="old_password">{t('user.settings.password.current_password')}</Label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    id="old_password"
                    name="old_password"
                    onChange={handleChange}
                    className="mt-1"
                  />
                  {touched.old_password && errors.old_password && (
                    <p className="text-red-500 text-sm mt-1">{t(errors.old_password as string)}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="new_password">{t('user.settings.password.new_password')}</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    id="new_password"
                    name="new_password"
                    onChange={handleChange}
                    className="mt-1"
                  />
                  {touched.new_password && errors.new_password && (
                    <p className="text-red-500 text-sm mt-1">{t(errors.new_password as string)}</p>
                  )}
                </div>

                <div className="flex items-center space-x-2 text-amber-600 bg-amber-50 p-3 rounded-md">
                  <AlertTriangle size={16} />
                  <span className="text-sm">{t('user.settings.password.logout_warning')}</span>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-black text-white hover:bg-black/90"
                  >
                    {isSubmitting ? t('user.settings.password.updating') : t('user.settings.password.update_password')}
                  </Button>
                </div>
              </Form>
            )}
          </Formik>
        </div>
      </div>
    </div>

    {/* Danger zone — delete account (also deletes solely-owned orgs + content) */}
    <AccountDangerZone />
    </>
  )
}

export default AccountSecurity
