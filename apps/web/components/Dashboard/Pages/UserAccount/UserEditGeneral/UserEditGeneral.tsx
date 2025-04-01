'use client'
import { constructAcceptValue } from '@/lib/constants'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { Textarea } from '@components/ui/textarea'
import { getUriWithoutOrg } from '@services/config/config'
import { updateProfile } from '@services/settings/profile'
import { updateUserAvatar } from '@services/users/users'
import { Form, Formik } from 'formik'
import {
  AlertTriangle,
  ArrowBigUpDash,
  Check,
  FileWarning,
  Info,
  UploadCloud,
} from 'lucide-react'
import { signOut } from 'next-auth/react'
import React, { useEffect } from 'react'
import { toast } from 'react-hot-toast'
import * as Yup from 'yup'

const SUPPORTED_FILES = constructAcceptValue(['image'])

const validationSchema = Yup.object().shape({
  email: Yup.string().email('Invalid email').required('Email is required'),
  username: Yup.string().required('Username is required'),
  first_name: Yup.string().required('First name is required'),
  last_name: Yup.string().required('Last name is required'),
  bio: Yup.string().max(400, 'Bio must be 400 characters or less'),
})

interface FormValues {
  username: string
  first_name: string
  last_name: string
  email: string
  bio: string
}

function UserEditGeneral() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [localAvatar, setLocalAvatar] = React.useState(null) as any
  const [isLoading, setIsLoading] = React.useState(false) as any
  const [error, setError] = React.useState() as any
  const [success, setSuccess] = React.useState('') as any

  const handleFileChange = async (event: any) => {
    const file = event.target.files[0]
    setLocalAvatar(file)
    setIsLoading(true)
    const res = await updateUserAvatar(
      session.data.user_uuid,
      file,
      access_token
    )
    // wait for 1 second to show loading animation
    await new Promise((r) => setTimeout(r, 1500))
    if (res.success === false) {
      setError(res.HTTPmessage)
    } else {
      setIsLoading(false)
      setError('')
      setSuccess('Avatar Updated')
    }
  }

  const handleEmailChange = async (newEmail: string) => {
    toast.success('Profile Updated Successfully', { duration: 4000 })

    // Show message about logging in with new email
    toast(
      (t: any) => (
        <div className="flex items-center gap-2">
          <span>Please login again with your new email: {newEmail}</span>
        </div>
      ),
      {
        duration: 4000,
        icon: '📧',
      }
    )

    // Wait for 4 seconds before signing out
    await new Promise((resolve) => setTimeout(resolve, 4000))
    signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
  }

  useEffect(() => {}, [session, session.data])

  return (
    <div className="nice-shadow mx-0 rounded-xl bg-white sm:mx-10">
      {session.data.user && (
        <Formik<FormValues>
          enableReinitialize
          initialValues={{
            username: session.data.user.username,
            first_name: session.data.user.first_name,
            last_name: session.data.user.last_name,
            email: session.data.user.email,
            bio: session.data.user.bio || '',
          }}
          validationSchema={validationSchema}
          onSubmit={(values, { setSubmitting }) => {
            const isEmailChanged = values.email !== session.data.user.email
            const loadingToast = toast.loading('Updating profile...')

            setTimeout(() => {
              setSubmitting(false)
              updateProfile(values, session.data.user.id, access_token)
                .then(() => {
                  toast.dismiss(loadingToast)
                  if (isEmailChanged) {
                    handleEmailChange(values.email)
                  } else {
                    toast.success('Profile Updated Successfully')
                  }
                })
                .catch(() => {
                  toast.error('Failed to update profile', { id: loadingToast })
                })
            }, 400)
          }}
        >
          {({ isSubmitting, values, handleChange, errors, touched }) => (
            <Form>
              <div className="flex flex-col gap-0">
                <div className="mx-3 my-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
                  <h1 className="text-xl font-bold text-gray-800">
                    Account Settings
                  </h1>
                  <h2 className="text-md text-gray-500">
                    Manage your personal information and preferences
                  </h2>
                </div>

                <div className="mx-5 my-5 mt-0 flex flex-col gap-8 lg:flex-row">
                  {/* Profile Information Section */}
                  <div className="min-w-0 flex-1 space-y-4">
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        value={values.email}
                        onChange={handleChange}
                        placeholder="Your email address"
                      />
                      {touched.email && errors.email && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.email}
                        </p>
                      )}
                      {values.email !== session.data.user.email && (
                        <div className="mt-2 flex items-center space-x-2 rounded-md bg-amber-50 p-2 text-amber-600">
                          <AlertTriangle size={16} />
                          <span className="text-sm">
                            You will be logged out after changing your email
                          </span>
                        </div>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="username">Username</Label>
                      <Input
                        id="username"
                        name="username"
                        value={values.username}
                        onChange={handleChange}
                        placeholder="Your username"
                      />
                      {touched.username && errors.username && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.username}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="first_name">First Name</Label>
                      <Input
                        id="first_name"
                        name="first_name"
                        value={values.first_name}
                        onChange={handleChange}
                        placeholder="Your first name"
                      />
                      {touched.first_name && errors.first_name && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.first_name}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="last_name">Last Name</Label>
                      <Input
                        id="last_name"
                        name="last_name"
                        value={values.last_name}
                        onChange={handleChange}
                        placeholder="Your last name"
                      />
                      {touched.last_name && errors.last_name && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.last_name}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="bio">
                        Bio
                        <span className="ml-2 text-sm text-gray-500">
                          ({400 - (values.bio?.length || 0)} characters left)
                        </span>
                      </Label>
                      <Textarea
                        id="bio"
                        name="bio"
                        value={values.bio}
                        onChange={handleChange}
                        placeholder="Tell us about yourself"
                        className="min-h-[150px]"
                        maxLength={400}
                      />
                      {touched.bio && errors.bio && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.bio}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Profile Picture Section */}
                  <div className="w-full lg:w-80">
                    <div className="nice-shadow h-full rounded-lg bg-gray-50/50 p-6">
                      <div className="flex flex-col items-center space-y-6">
                        <Label className="font-bold">Profile Picture</Label>
                        {error && (
                          <div className="flex items-center rounded-md bg-red-200 px-4 py-2 text-sm text-red-950">
                            <FileWarning size={16} className="mr-2" />
                            <span className="font-semibold first-letter:uppercase">
                              {error}
                            </span>
                          </div>
                        )}
                        {success && (
                          <div className="flex items-center rounded-md bg-green-200 px-4 py-2 text-sm text-green-950">
                            <Check size={16} className="mr-2" />
                            <span className="font-semibold first-letter:uppercase">
                              {success}
                            </span>
                          </div>
                        )}
                        {localAvatar ? (
                          <UserAvatar
                            border="border-8"
                            width={120}
                            avatar_url={URL.createObjectURL(localAvatar)}
                          />
                        ) : (
                          <UserAvatar border="border-8" width={120} />
                        )}
                        {isLoading ? (
                          <div className="text-gray flex animate-pulse items-center rounded-md bg-green-200 px-4 py-2 text-sm font-bold antialiased">
                            <ArrowBigUpDash size={16} className="mr-2" />
                            <span>Uploading</span>
                          </div>
                        ) : (
                          <>
                            <input
                              type="file"
                              id="fileInput"
                              accept={SUPPORTED_FILES}
                              className="hidden"
                              onChange={handleFileChange}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                document.getElementById('fileInput')?.click()
                              }
                              className="w-full"
                            >
                              <UploadCloud size={16} className="mr-2" />
                              Change Avatar
                            </Button>
                          </>
                        )}
                        <div className="flex items-center text-xs text-gray-500">
                          <Info size={13} className="mr-2" />
                          <p>Recommended size 100x100</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mx-5 mt-0 mb-5 flex flex-row-reverse">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-black text-white hover:bg-black/90"
                  >
                    {isSubmitting ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </Form>
          )}
        </Formik>
      )}
    </div>
  )
}

export default UserEditGeneral
