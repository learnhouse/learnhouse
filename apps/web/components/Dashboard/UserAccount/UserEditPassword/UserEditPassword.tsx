import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updatePassword } from '@services/settings/password'
import { Formik, Form, Field } from 'formik'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'

function UserEditPassword() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;

  const updatePasswordUI = async (values: any) => {
    const toastId = toast.loading("changing...");
    try {
      let user_id = session.data.user.id
      await updatePassword(user_id, values, access_token)
      toast.success("Changed", {id:toastId});
    } catch (error) {
      toast.error("Couldn't change", {id:toastId});
    }
  }

  useEffect(() => { }, [session])

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
