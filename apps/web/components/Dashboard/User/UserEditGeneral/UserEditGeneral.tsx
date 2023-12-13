import { useAuth } from '@components/Security/AuthContext';
import { updateProfile } from '@services/settings/profile';
import React, { useEffect } from 'react'
import { Formik, Form, Field, ErrorMessage } from 'formik';

function UserEditGeneral() {
  const auth = useAuth() as any;

  
  useEffect(() => {
  }
    , [auth, auth.user])

  return (
    <div className='ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-6 py-5'>
      {auth.user && (
        <Formik
        enableReinitialize
        initialValues={{
          username: auth.user.username,
          first_name: auth.user.first_name,
          last_name: auth.user.last_name,
          email: auth.user.email,
          bio: auth.user.bio,
        }}
        onSubmit={(values, { setSubmitting }) => {
          setTimeout(() => {

            setSubmitting(false);
            updateProfile(values,auth.user.id)
          }, 400);
        }}
      >
        {({ isSubmitting }) => (
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

        )}
      </Formik>
      )}
    </div>
  )
}

export default UserEditGeneral