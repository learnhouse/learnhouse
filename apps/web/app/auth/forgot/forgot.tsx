'use client'
import Image from 'next/image'
import React from 'react'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import FormLayout, {
    FormField,
    FormLabelAndMessage,
    Input,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { AlertTriangle, Info } from 'lucide-react'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { useRouter } from 'next/navigation'
import { useFormik } from 'formik'
import { sendResetLink } from '@services/auth/auth'

const validate = (values: any) => {
    const errors: any = {}

    if (!values.email) {
        errors.email = 'Required'
    } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
        errors.email = 'Invalid email address'
    }


    return errors
}

function ForgotPasswordClient() {
    const org = useOrg() as any;
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const router = useRouter()
    const [error, setError] = React.useState('')
    const [message, setMessage] = React.useState('')

    const formik = useFormik({
        initialValues: {
            email: ''
        },
        validate,
        validateOnBlur: true,
        onSubmit: async (values) => {
            setIsSubmitting(true)
            let res = await sendResetLink(values.email, org?.id)
            if (res.status == 200) {
                setMessage(res.data + ', please check your email')
                setIsSubmitting(false)
            } else {
                setError(res.data.detail)
                setIsSubmitting(false)
            }
        },
    })
    return (

        <div className="grid grid-flow-col justify-stretch h-screen">
            <div
                className="right-login-part"
                style={{
                    background:
                        'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
                }}
            >
                <div className="login-topbar m-10">
                    <Link prefetch href={getUriWithOrg(org?.slug, '/')}>
                        <Image
                            quality={100}
                            width={30}
                            height={30}
                            src={learnhouseIcon}
                            alt=""
                        />
                    </Link>
                </div>
                <div className="ml-10 h-4/6 flex flex-row text-white">
                    <div className="m-auto flex space-x-4 items-center flex-wrap">

                        <div className="shadow-[0px_4px_16px_rgba(0,0,0,0.02)]">
                            {org?.logo_image ? (
                                <img
                                    src={`${getOrgLogoMediaDirectory(
                                        org?.org_uuid,
                                        org?.logo_image
                                    )}`}
                                    alt="Learnhouse"
                                    style={{ width: 'auto', height: 70 }}
                                    className="rounded-xl shadow-xl inset-0 ring-1 ring-inset ring-black/10 bg-white"
                                />
                            ) : (
                                <Image
                                    quality={100}
                                    width={70}
                                    height={70}
                                    src={learnhouseIcon}
                                    alt=""
                                />
                            )}
                        </div>
                        <div className="font-bold text-xl">{org?.name}</div>
                    </div>
                </div>
            </div>
            <div className="left-login-part bg-white flex flex-row">
                <div className="login-form m-auto w-72">
                    <h1 className="text-2xl font-bold mb-4">Forgot Password</h1>
                    <p className="text-sm mb-4">
                        Enter your email address and we will send you a link to reset your
                        password
                    </p>

                    {error && (
                        <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-xs">
                            <AlertTriangle size={18} />
                            <div className="font-bold text-sm">{error}</div>
                        </div>
                    )}
                    {message && (
                        <div className="flex justify-center bg-green-200 rounded-md text-green-950 space-x-2 items-center p-4 transition-all shadow-xs">
                            <Info size={18} />
                            <div className="font-bold text-sm">{message}</div>
                        </div>
                    )}
                    <FormLayout onSubmit={formik.handleSubmit}>
                        <FormField name="email">
                            <FormLabelAndMessage
                                label="Email"
                                message={formik.errors.email}
                            />
                            <Form.Control asChild>
                                <Input
                                    onChange={formik.handleChange}
                                    value={formik.values.email}
                                    type="email"
                                    required
                                />
                            </Form.Control>
                        </FormField>
                        <div className="flex  py-4">
                            <Form.Submit asChild>
                                <button className="w-full bg-black text-white font-bold text-center p-2 rounded-md shadow-md hover:cursor-pointer">
                                    {isSubmitting ? 'Loading...' : 'Send Reset Link'}
                                </button>
                            </Form.Submit>
                        </div>
                    </FormLayout>

                </div>
            </div>
        </div>
    )
}

export default ForgotPasswordClient