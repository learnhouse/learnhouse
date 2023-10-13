"use client";
import { useFormik } from 'formik';
import { useRouter } from 'next/navigation';
import learnhouseIcon from "public/learnhouse_bigicon_1.png";
import React from 'react'
import FormLayout, { ButtonBlack, FormField, FormLabel, FormLabelAndMessage, FormMessage, Input, Textarea } from '@components/StyledElements/Form/Form'
import Image from 'next/image';
import * as Form from '@radix-ui/react-form';
import { getOrgLogoMediaDirectory } from '@services/media/media';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { signup } from '@services/auth/auth';
import { getUriWithOrg } from '@services/config/config';


interface SignUpClientProps {
    org: any;
}

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

    if (!values.full_name) {
        errors.full_name = 'Required';
    }

    if (!values.bio) {
        errors.bio = 'Required';
    }


    return errors;
};


function SignUpClient(props: SignUpClientProps) {
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const router = useRouter();
    const [error, setError] = React.useState('');
    const formik = useFormik({
        initialValues: {
            org_slug: props.org?.slug,
            email: '',
            password: '',
            username: '',
            bio: '',
            full_name: '',
        },
        validate,
        onSubmit: async values => {
            setIsSubmitting(true);
            let res = await signup(values);
            let message = await res.json();
            if (res.status == 200) {
                router.push(`/`);
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

    return (
        <div><div className='grid grid-flow-col justify-stretch h-screen'>
            <div className="right-login-part" style={{ background: "linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)" }} >
                <div className='login-topbar m-10'>
                    <Link prefetch href={getUriWithOrg(props.org.slug, "/")}>
                        <Image quality={100} width={30} height={30} src={learnhouseIcon} alt="" />
                    </Link>
                </div>
                <div className="ml-10 h-4/6 flex flex-row text-white">
                    <div className="m-auto flex space-x-4 items-center flex-wrap">
                        <div>Join </div>
                        <div className="shadow-[0px_4px_16px_rgba(0,0,0,0.02)]" >
                            {props.org?.logo ? (
                                <img
                                    src={`${getOrgLogoMediaDirectory(props.org.org_id, props.org?.logo)}`}
                                    alt="Learnhouse"
                                    style={{ width: "auto", height: 70 }}
                                    className="rounded-md shadow-xl inset-0 ring-1 ring-inset ring-black/10 bg-white"
                                />
                            ) : (
                                <Image quality={100} width={70} height={70} src={learnhouseIcon} alt="" />
                            )}
                        </div>
                        <div className="font-bold text-xl">{props.org?.name}</div>
                    </div>
                </div>
            </div>
            <div className="left-login-part bg-white flex flex-row">
                <div className="login-form m-auto w-72">
                    {error && (
                        <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-sm">
                            <AlertTriangle size={18} />
                            <div className="font-bold text-sm">{error}</div>
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

                        {/* for full name  */}
                        <FormField name="full_name">
                            <FormLabelAndMessage label='Full Name' message={formik.errors.full_name} />

                            <Form.Control asChild>
                                <Input onChange={formik.handleChange} value={formik.values.full_name} type="text" required />
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
                                        : "Create an account"}
                                </button>
                            </Form.Submit>
                        </div>

                    </FormLayout>
                </div>
            </div>
        </div></div>
    )
}

export default SignUpClient