"use client";
import { AuthContext } from '@components/Security/AuthProvider';
import React, { useEffect } from 'react'
import { Formik, Form, Field, ErrorMessage } from 'formik';
import { updateProfile } from '@services/settings/profile';

function ProfileClient() {
    const auth: any = React.useContext(AuthContext);

    return (
        <div>

            {auth.isAuthenticated && (
                <div>
                    <h1 className='text-3xl font-bold'>Profile Settings</h1>
                    <br /><br />

                    <Formik
                        initialValues={auth.userInfo.user_object}

                        onSubmit={(values, { setSubmitting }) => {
                            setTimeout(() => {
                                alert(JSON.stringify(values, null, 2));
                                setSubmitting(false);
                                updateProfile(values)
                            }, 400);
                        }}
                    >
                        {({ isSubmitting }) => (
                            <Form className="max-w-md">
                                <label className="block mb-2 font-bold" htmlFor="full_name">
                                    Full Name
                                </label>
                                <Field
                                    className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    type="textarea"
                                    name="full_name"
                                />

                                <label className="block mb-2 font-bold" htmlFor="email">
                                    Email
                                </label>
                                <Field
                                    className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    type="email"
                                    name="email"
                                />

                                <label className="block mb-2 font-bold" htmlFor="bio">
                                    Bio
                                </label>
                                <Field
                                    as="textarea"
                                    className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    type="textarea"
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
                </div>
            )}


        </div>

    )
}

export default ProfileClient