'use client';
import { updateProfile } from '@services/settings/profile'
import React, { useEffect } from 'react'
import { Formik, Form } from 'formik'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  ArrowBigUpDash,
  Check,
  FileWarning,
  Info,
  UploadCloud,
  AlertTriangle,
  LogOut
} from 'lucide-react'
import UserAvatar from '@components/Objects/UserAvatar'
import { updateUserAvatar } from '@services/users/users'
import { constructAcceptValue } from '@/lib/constants'
import * as Yup from 'yup'
import { Input } from "@components/ui/input"
import { Textarea } from "@components/ui/textarea"
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import { toast } from 'react-hot-toast'
import { signOut } from 'next-auth/react'
import { getUriWithoutOrg } from '@services/config/config';

const SUPPORTED_FILES = constructAcceptValue(['image'])

const validationSchema = Yup.object().shape({
  email: Yup.string().email('Invalid email').required('Email is required'),
  username: Yup.string().required('Username is required'),
  first_name: Yup.string().required('First name is required'),
  last_name: Yup.string().required('Last name is required'),
  bio: Yup.string().max(400, 'Bio must be 400 characters or less'),
})

interface FormValues {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  bio: string;
}

function UserEditGeneral() {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [localAvatar, setLocalAvatar] = React.useState(null) as any
  const [isLoading, setIsLoading] = React.useState(false) as any
  const [error, setError] = React.useState() as any
  const [success, setSuccess] = React.useState('') as any

  const handleFileChange = async (event: any) => {
    const file = event.target.files[0]
    setLocalAvatar(file)
    setIsLoading(true)
    const res = await updateUserAvatar(session.data.user_uuid, file, access_token)
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
    toast((t) => (
      <div className="flex items-center gap-2">
        <span>Please login again with your new email: {newEmail}</span>
      </div>
    ), { 
      duration: 4000,
      icon: '📧'
    })

    // Wait for 4 seconds before signing out
    await new Promise(resolve => setTimeout(resolve, 4000))
    signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
  }

  useEffect(() => { }, [session, session.data])

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
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
                <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
                  <h1 className="font-bold text-xl text-gray-800">
                    Account Settings
                  </h1>
                  <h2 className="text-gray-500 text-md">
                    Manage your personal information and preferences
                  </h2>
                </div>

                <div className="flex flex-col lg:flex-row mt-0 mx-5 my-5 gap-8">
                  {/* Profile Information Section */}
                  <div className="flex-1 min-w-0 space-y-4">
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
                        <p className="text-red-500 text-sm mt-1">{errors.email}</p>
                      )}
                      {values.email !== session.data.user.email && (
                        <div className="flex items-center space-x-2 mt-2 text-amber-600 bg-amber-50 p-2 rounded-md">
                          <AlertTriangle size={16} />
                          <span className="text-sm">You will be logged out after changing your email</span>
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
                        <p className="text-red-500 text-sm mt-1">{errors.username}</p>
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
                        <p className="text-red-500 text-sm mt-1">{errors.first_name}</p>
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
                        <p className="text-red-500 text-sm mt-1">{errors.last_name}</p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="bio">
                        Bio
                        <span className="text-gray-500 text-sm ml-2">
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
                        <p className="text-red-500 text-sm mt-1">{errors.bio}</p>
                      )}
                    </div>
                  </div>

                  {/* Profile Picture Section */}
                  <div className="lg:w-80 w-full">
                    <div className="bg-gray-50/50 p-6 rounded-lg nice-shadow h-full">
                      <div className="flex flex-col items-center space-y-6">
                        <Label className="font-bold">Profile Picture</Label>
                        {error && (
                          <div className="flex items-center bg-red-200 rounded-md text-red-950 px-4 py-2 text-sm">
                            <FileWarning size={16} className="mr-2" />
                            <span className="font-semibold first-letter:uppercase">{error}</span>
                          </div>
                        )}
                        {success && (
                          <div className="flex items-center bg-green-200 rounded-md text-green-950 px-4 py-2 text-sm">
                            <Check size={16} className="mr-2" />
                            <span className="font-semibold first-letter:uppercase">{success}</span>
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
                          <div className="font-bold animate-pulse antialiased bg-green-200 text-gray text-sm rounded-md px-4 py-2 flex items-center">
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
                              onClick={() => document.getElementById('fileInput')?.click()}
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

                <div className="flex flex-row-reverse mt-0 mx-5 mb-5">
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
