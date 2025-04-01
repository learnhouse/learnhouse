import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { getUriWithoutOrg } from '@services/config/config'
import { updatePassword } from '@services/settings/password'
import { Form, Formik } from 'formik'
import { AlertTriangle } from 'lucide-react'
import { signOut } from 'next-auth/react'
import React, { useEffect } from 'react'
import { toast } from 'react-hot-toast'
import * as Yup from 'yup'

const validationSchema = Yup.object().shape({
  old_password: Yup.string().required('Current password is required'),
  new_password: Yup.string()
    .required('New password is required')
    .min(8, 'Password must be at least 8 characters'),
})

function UserEditPassword() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const updatePasswordUI = async (values: any) => {
    const loadingToast = toast.loading('Updating password...')
    try {
      const user_id = session.data.user.id
      const response = await updatePassword(user_id, values, access_token)

      if (response.success) {
        toast.dismiss(loadingToast)

        // Show success message and notify about logout
        toast.success('Password updated successfully', { duration: 4000 })
        toast(
          (t: any) => (
            <div className="flex items-center gap-2">
              <span>Please login again with your new password</span>
            </div>
          ),
          {
            duration: 4000,
            icon: '🔑',
          }
        )

        // Wait for 4 seconds before signing out
        await new Promise((resolve) => setTimeout(resolve, 4000))
        signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
      } else {
        toast.error(response.data.detail || 'Failed to update password', {
          id: loadingToast,
        })
      }
    } catch (error: any) {
      const errorMessage =
        error.data?.detail || 'Failed to update password. Please try again.'
      toast.error(errorMessage, { id: loadingToast })
      console.error('Password update error:', error)
    }
  }

  useEffect(() => {}, [session])

  return (
    <div className="nice-shadow mx-0 rounded-xl bg-white sm:mx-10">
      <div className="flex flex-col">
        <div className="mx-3 my-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
          <h1 className="text-xl font-bold text-gray-800">Change Password</h1>
          <h2 className="text-md text-gray-500">
            Update your password to keep your account secure
          </h2>
        </div>

        <div className="px-8 py-6">
          <Formik
            initialValues={{ old_password: '', new_password: '' }}
            validationSchema={validationSchema}
            onSubmit={(values, { setSubmitting }) => {
              setTimeout(() => {
                setSubmitting(false)
                updatePasswordUI(values)
              }, 400)
            }}
          >
            {({ isSubmitting, handleChange, errors, touched }) => (
              <Form className="mx-auto w-full max-w-2xl space-y-6">
                <div>
                  <Label htmlFor="old_password">Current Password</Label>
                  <Input
                    type="password"
                    id="old_password"
                    name="old_password"
                    onChange={handleChange}
                    className="mt-1"
                  />
                  {touched.old_password && errors.old_password && (
                    <p className="mt-1 text-sm text-red-500">
                      {errors.old_password}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="new_password">New Password</Label>
                  <Input
                    type="password"
                    id="new_password"
                    name="new_password"
                    onChange={handleChange}
                    className="mt-1"
                  />
                  {touched.new_password && errors.new_password && (
                    <p className="mt-1 text-sm text-red-500">
                      {errors.new_password}
                    </p>
                  )}
                </div>

                <div className="flex items-center space-x-2 rounded-md bg-amber-50 p-3 text-amber-600">
                  <AlertTriangle size={16} />
                  <span className="text-sm">
                    You will be logged out after changing your password
                  </span>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-black text-white hover:bg-black/90"
                  >
                    {isSubmitting ? 'Updating...' : 'Update Password'}
                  </Button>
                </div>
              </Form>
            )}
          </Formik>
        </div>
      </div>
    </div>
  )
}

export default UserEditPassword
