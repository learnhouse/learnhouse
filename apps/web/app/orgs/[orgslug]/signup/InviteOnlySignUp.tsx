"use client";
import { useFormik } from 'formik';
import { useRouter } from 'next/navigation';
import React, { useEffect } from 'react'
import FormLayout, { FormField, FormLabelAndMessage, Input, Textarea } from '@components/StyledElements/Form/Form';
import * as Form from '@radix-ui/react-form';
import { AlertTriangle, Check, User } from 'lucide-react';
import Link from 'next/link';
import { signUpWithInviteCode } from '@services/auth/auth';
import { useOrg } from '@components/Contexts/OrgContext';




const validate = (values: any) => {
    const errors: any = {};

    if (!values.email) {
        errors.email = 'Required';
    }
    else if (
        !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)
    ) {
        errors.email = 'Invalid email address';
    }

    if (!values.password) {
        errors.password = 'Required';
    }
    else if (values.password.length < 8) {
        errors.password = 'Password must be at least 8 characters';
    }

    if (!values.username) {
        errors.username = 'Required';
    }

    if (!values.username || values.username.length < 4) {
        errors.username = 'Username must be at least 4 characters';
    }

    if (!values.bio) {
        errors.bio = 'Required';
    }


    return errors;
};

interface InviteOnlySignUpProps {
    inviteCode: string;
}

function InviteOnlySignUpComponent(props : InviteOnlySignUpProps) {
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const org = useOrg() as any;
    const router = useRouter();
    const [error, setError] = React.useState('');
    const [message, setMessage] = React.useState('');
    const formik = useFormik({
        initialValues: {
            org_slug: org?.slug,
            org_id: org?.id,
            email: '',
            password: '',
            username: '',
            bio: '',
            first_name: '',
            last_name: '',
        },
        validate,
        onSubmit: async values => {
            setError('')
            setMessage('')
            setIsSubmitting(true);
            let res = await signUpWithInviteCode(values, props.inviteCode);
            let message = await res.json();
            if (res.status == 200) {
                //router.push(`/login`);
                setMessage('Your account was successfully created')
                setIsSubmitting(false);
            }
            else if (res.status == 401 || res.status == 400 || res.status == 404 || res.status == 409) {
                setError(message.detail);
                setIsSubmitting(false);
                
            }
            else {
                setError("Something went wrong");
                setIsSubmitting(false);
            }

        },
    });

    useEffect(() => {
       
    }
        , [org]);

    return (
        <div className="login-form m-auto w-72">
                    {error && (
                        <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-sm">
                            <AlertTriangle size={18} />
                            <div className="font-bold text-sm">{error}</div>
                        </div>
                    )}
                    {message && (
                        <div className="flex flex-col space-y-4 justify-center bg-green-200 rounded-md text-green-950 space-x-2 items-center p-4 transition-all shadow-sm">
                            <div className='flex space-x-2'>
                                <Check size={18} />
                                <div className="font-bold text-sm">{message}</div>
                            </div>
                            <hr className='border-green-900/20 800 w-40 border' />
                            <Link className='flex space-x-2 items-center' href={'/login'}><User size={14} /> <div>Login </div></Link>
                        </div>
                    )}
                    <FormLayout onSubmit={formik.handleSubmit}>
                        <FormField name="email">
                            <FormLabelAndMessage label='Email' message={formik.errors.email} />
                            <Form.Control asChild>
                                <Input onChange={formik.handleChange} value={formik.values.email} type="email" required />
                            </Form.Control>
                        </FormField>
                        {/* for password  */}
                        <FormField name="password">
                            <FormLabelAndMessage label='Password' message={formik.errors.password} />

                            <Form.Control asChild>
                                <Input onChange={formik.handleChange} value={formik.values.password} type="password" required />
                            </Form.Control>
                        </FormField>
                        {/* for username  */}
                        <FormField name="username">
                            <FormLabelAndMessage label='Username' message={formik.errors.username} />

                            <Form.Control asChild>
                                <Input onChange={formik.handleChange} value={formik.values.username} type="text" required />
                            </Form.Control>
                        </FormField>

                        {/* for bio  */}
                        <FormField name="bio">
                            <FormLabelAndMessage label='Bio' message={formik.errors.bio} />

                            <Form.Control asChild>
                                <Textarea onChange={formik.handleChange} value={formik.values.bio} required />
                            </Form.Control>
                        </FormField>

                        <div className="flex  py-4">
                            <Form.Submit asChild>
                                <button className="w-full bg-black text-white font-bold text-center p-2 rounded-md shadow-md hover:cursor-pointer" >
                                    {isSubmitting ? "Loading..."
                                        : "Create an account & Join"}
                                </button>
                            </Form.Submit>
                        </div>

                    </FormLayout>
                </div>
    )
}

export default InviteOnlySignUpComponent