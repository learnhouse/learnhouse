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

  useEffect(() => { }, [session, session.data])

  return (
    <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-6 py-5 sm:mb-0 mb-16">
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
            <div className="flex flex-col lg:flex-row gap-8">
              <Form className="flex-1 min-w-0">
                <div className="space-y-4">
                  {[
                    { label: 'Email', name: 'email', type: 'email' },
                    { label: 'Username', name: 'username', type: 'text' },
                    { label: 'First Name', name: 'first_name', type: 'text' },
                    { label: 'Last Name', name: 'last_name', type: 'text' },
                    { label: 'Bio', name: 'bio', type: 'text' },
                  ].map((field) => (
                    <div key={field.name}>
                      <label className="block mb-2 font-bold" htmlFor={field.name}>
                        {field.label}
                      </label>
                      <Field
                        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        type={field.type}
                        name={field.name}
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-6 px-6 py-3 text-white bg-black rounded-lg shadow-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Submit
                </button>
              </Form>
              <div className="flex-1 min-w-0">
                <div className="flex flex-col items-center space-y-4">
                  <label className="font-bold">Avatar</label>
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
                  <div className="w-full max-w-xs bg-gray-50 rounded-xl outline outline-1 outline-gray-200 shadow p-6">
                    <div className="flex flex-col items-center space-y-4">
                      {localAvatar ? (
                        <UserAvatar
                          border="border-8"
                          width={100}
                          avatar_url={URL.createObjectURL(localAvatar)}
                        />
                      ) : (
                        <UserAvatar border="border-8" width={100} />
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
                            className="hidden"
                            onChange={handleFileChange}
                          />
                          <button
                            className="font-bold antialiased text-gray text-sm rounded-md px-4 py-2 flex items-center"
                            onClick={() => document.getElementById('fileInput')?.click()}
                          >
                            <UploadCloud size={16} className="mr-2" />
                            <span>Change Avatar</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center text-xs text-gray-500">
                    <Info size={13} className="mr-2" />
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
