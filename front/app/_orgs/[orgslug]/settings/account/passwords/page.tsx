"use client";
import { AuthContext } from '@components/Security/AuthProvider';
import React, { useEffect } from 'react'
import { Formik, Form, Field, ErrorMessage } from 'formik';
import { updateProfile } from '@services/settings/profile';
import { updatePassword } from '@services/settings/password';

function SettingsProfilePasswordsPage() {

    const auth: any = React.useContext(AuthContext);

    const updatePasswordUI = async (values: any) => {
        let user_id = auth.userInfo.user_object.user_id;
        console.log(values);
        await updatePassword(user_id, values)
    }


    return (
        <div>

            {auth.isAuthenticated && (
                <div>
                    <h1>Account Password</h1>
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
                            <Form>
                                Old Password  <Field type="password" name="old_password" /><br />
                                New password  <Field type="password" name="new_password" /><br />
                                <button type="submit" disabled={isSubmitting}>
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

export default SettingsProfilePasswordsPage