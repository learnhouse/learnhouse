import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updatePassword } from '@services/settings/password'
import { Formik, Form, Field } from 'formik'
import React, { useEffect } from 'react'

function UserEditPassword() {
  const session = useLHSession() as any

  const updatePasswordUI = async (values: any) => {
    let user_id = session.data.user.id
    await updatePassword(user_id, values)
  }

  useEffect(() => {}, [session])

  return (
    <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-6 py-5">
      <Formik
        initialValues={{ old_password: '', new_password: '' }}
        enableReinitialize
        onSubmit={(values, { setSubmitting }) => {
          setTimeout(() => {
            setSubmitting(false)
            updatePasswordUI(values)
          }, 400)
        }}
      >
        {({ isSubmitting }) => (
          <Form className="max-w-md">
            <label className="block mb-2 font-bold" htmlFor="old_password">
              Old Password
            </label>
            <Field
              className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              type="password"
              name="old_password"
            />

            <label className="block mb-2 font-bold" htmlFor="new_password">
              New Password
            </label>
            <Field
              className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              type="password"
              name="new_password"
            />

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 text-white bg-black rounded-lg shadow-md hover:bg-black focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Submit
            </button>
          </Form>
        )}
      </Formik>
    </div>
  )
}

export default UserEditPassword
