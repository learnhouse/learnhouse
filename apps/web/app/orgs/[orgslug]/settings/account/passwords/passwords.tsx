"use client";
import { AuthContext } from '@components/Security/AuthProviderDepreceated';
import React, { useEffect } from 'react'
import { Formik, Form, Field, ErrorMessage } from 'formik';
import { updatePassword } from '@services/settings/password';


function PasswordsClient() {
    const auth: any = React.useContext(AuthContext);

    

    const updatePasswordUI = async (values: any) => {
        let user_id = auth.userInfo.user_object.user_id;
        await updatePassword(user_id, values)
    }


    return (
        <div>

            {auth.isAuthenticated && (
                <div>
                    <h1 className='text-3xl font-bold'>Account Password</h1>
                    <br /><br />

                    <Formik
                        initialValues={{ old_password: '', new_password: '' }}
                        onSubmit={(values, { setSubmitting }) => {
                            setTimeout(() => {
                                alert(JSON.stringify(values, null, 2));
                                setSubmitting(false);
                                updatePasswordUI(values)
                            }, 400);
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
            )}


        </div>

    )
}

export default PasswordsClient