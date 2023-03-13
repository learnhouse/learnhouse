"use client";
import { AuthContext } from '@components/Security/AuthProvider';
import React, { useEffect } from 'react'
import { Formik, Form, Field, ErrorMessage } from 'formik';
import { updateProfile } from '@services/settings/profile';

function SettingsProfilePage() {

    const auth: any = React.useContext(AuthContext);



    return (
        <div>

            {auth.isAuthenticated && (
                <div>
                    <h1>Profile Settings</h1>
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
                            <Form>
                                Full name  <Field type="textarea" name="full_name" /><br />
                                Email  <Field type="email" name="email" /><br />
                                Bio  <Field as="textarea" type="textarea" name="bio" /><br />
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

export default SettingsProfilePage