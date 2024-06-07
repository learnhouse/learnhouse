'use client';
import { updateProfile } from '@services/settings/profile'
import React, { useEffect } from 'react'
import { Formik, Form, Field } from 'formik'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  ArrowBigUpDash,
  Check,
  FileWarning,
  Info,
  UploadCloud,
} from 'lucide-react'
import UserAvatar from '@components/Objects/UserAvatar'
import { updateUserAvatar } from '@services/users/users'

function UserEditGeneral() {
  const session = useLHSession() as any;
  const access_token = session.data.tokens.access_token;
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

  useEffect(() => { }, [session, session.data])

  return (
    <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-6 py-5">
      {session.data.user && (
        <Formik
          enableReinitialize
          initialValues={{
            username: session.data.user.username,
            first_name: session.data.user.first_name,
            last_name: session.data.user.last_name,
            email: session.data.user.email,
            bio: session.data.user.bio,
          }}
          onSubmit={(values, { setSubmitting }) => {
            setTimeout(() => {
              setSubmitting(false)
              updateProfile(values, session.data.user.id, access_token)
            }, 400)
          }}
        >
          {({ isSubmitting }) => (
            <div className="flex space-x-8">
              <Form className="max-w-md">
                <label className="block mb-2 font-bold" htmlFor="email">
                  Email
                </label>
                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  type="email"
                  name="email"
                />

                <label className="block mb-2 font-bold" htmlFor="username">
                  Username
                </label>
                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  type="username"
                  name="username"
                />

                <label className="block mb-2 font-bold" htmlFor="first_name">
                  First Name
                </label>

                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  type="first_name"
                  name="first_name"
                />

                <label className="block mb-2 font-bold" htmlFor="last_name">
                  Last Name
                </label>

                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  type="last_name"
                  name="last_name"
                />

                <label className="block mb-2 font-bold" htmlFor="bio">
                  Bio
                </label>

                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  type="bio"
                  name="bio"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-3 text-white bg-black rounded-lg shadow-md hover:bg-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Submit
                </button>
              </Form>
              <div className="flex flex-col grow justify-center align-middle space-y-3">
                <label className="flex mx-auto mb-2 font-bold ">Avatar</label>
                {error && (
                  <div className="flex justify-center mx-auto bg-red-200 rounded-md text-red-950 space-x-1 px-4 items-center p-2 transition-all shadow-sm">
                    <FileWarning size={16} className="mr-2" />
                    <div className="text-sm font-semibold first-letter:uppercase">
                      {error}
                    </div>
                  </div>
                )}
                {success && (
                  <div className="flex justify-center mx-auto bg-green-200 rounded-md text-green-950 space-x-1 px-4 items-center p-2 transition-all shadow-sm">
                    <Check size={16} className="mr-2" />
                    <div className="text-sm font-semibold first-letter:uppercase">
                      {success}
                    </div>
                  </div>
                )}
                <div className="flex flex-col space-y-3">
                  <div className="w-auto bg-gray-50 rounded-xl outline outline-1 outline-gray-200 h-[200px] shadow mx-20">
                    <div className="flex flex-col justify-center items-center mt-10">
                      {localAvatar ? (
                        <UserAvatar
                          border="border-8"
                          width={100}
                          avatar_url={URL.createObjectURL(localAvatar)}
                        />
                      ) : (
                        <UserAvatar border="border-8" width={100} />
                      )}
                    </div>
                    {isLoading ? (
                      <div className="flex justify-center items-center">
                        <input
                          type="file"
                          id="fileInput"
                          style={{ display: 'none' }}
                          onChange={handleFileChange}
                        />
                        <div className="font-bold  animate-pulse antialiased items-center bg-green-200 text-gray text-sm rounded-md px-4 py-2 mt-4 flex">
                          <ArrowBigUpDash size={16} className="mr-2" />
                          <span>Uploading</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-center items-center">
                        <input
                          type="file"
                          id="fileInput"
                          style={{ display: 'none' }}
                          onChange={handleFileChange}
                        />
                        <button
                          className="font-bold antialiased items-center text-gray text-sm rounded-md px-4 py-2 mt-4 flex"
                          onClick={() =>
                            document.getElementById('fileInput')?.click()
                          }
                        >
                          <UploadCloud size={16} className="mr-2" />
                          <span>Change Thumbnail</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex text-xs space-x-2 items-center text-gray-500 justify-center">
                    <Info size={13} />
                    <p>Recommended size 100x100</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Formik>
      )}
    </div>
  )
}

export default UserEditGeneral
