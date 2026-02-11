'use client'
import React from 'react'
import FormLayout, {
    FormField,
    FormLabelAndMessage,
    Input,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { AlertTriangle, ArrowLeft, CheckCircle, X } from 'lucide-react'
import Link from 'next/link'
import { useFormik } from 'formik'
import { sendResetLink } from '@services/auth/auth'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'

const validate = (values: any, t: any) => {
    const errors: any = {}

    if (!values.email) {
        errors.email = t('validation.required')
    } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
        errors.email = t('validation.invalid_email')
    }

    return errors
}

interface ForgotPasswordClientProps {
    org: any
}

function ForgotPasswordClient({ org }: ForgotPasswordClientProps) {
    const { t } = useTranslation();
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [error, setError] = React.useState('')
    const [message, setMessage] = React.useState('')
    const [showMessage, setShowMessage] = React.useState(false)

    const formik = useFormik({
        initialValues: {
            email: ''
        },
        validate: (values) => validate(values, t),
        validateOnBlur: true,
        onSubmit: async (values) => {
            setIsSubmitting(true)
            setError('')
            setMessage('')
            setShowMessage(false)
            let res = await sendResetLink(values.email, org?.id)
            if (res.status == 200) {
                setMessage(res.data + ', ' + t('auth.check_email_message'))
                setShowMessage(true)
                setIsSubmitting(false)
            } else {
                setError(res.data.detail)
                setShowMessage(true)
                setIsSubmitting(false)
            }
        },
    })

    return (
        <AuthLayout org={org} welcomeText={t('auth.reset_your_password')}>
                {/* Message Top Bar */}
                {showMessage && (error || message) && (
                    <div className={`
                        w-full px-4 py-3 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200
                        ${error ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}
                    `}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            {error ? <AlertTriangle size={18} className="shrink-0" /> : <CheckCircle size={18} className="shrink-0" />}
                            <span className="text-sm font-medium">{error || message}</span>
                        </div>
                        <button
                            onClick={() => setShowMessage(false)}
                            className="p-1 hover:bg-white/20 rounded transition-colors shrink-0"
                        >
                            <X size={18} />
                        </button>
                    </div>
                )}

                <div className="flex-1 flex flex-row">
                    <div className="m-auto w-full max-w-sm px-6 py-8 sm:py-0">
                        {/* Header */}
                        <div className="mb-8">
                            <h1 className="text-2xl font-bold text-gray-900">{t('auth.forgot_password_title')}</h1>
                            <p className="text-gray-500 mt-1">{t('auth.forgot_password_description')}</p>
                        </div>

                        {/* Form Card */}
                        <div className="bg-white rounded-xl p-6 nice-shadow">
                            <FormLayout onSubmit={formik.handleSubmit}>
                                <FormField name="email">
                                    <FormLabelAndMessage
                                        label={t('auth.email')}
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

                                <div className="pt-2">
                                    <Form.Submit asChild>
                                        <button className="w-full bg-black text-white font-semibold text-center py-2.5 rounded-lg hover:bg-gray-800 transition-colors">
                                            {isSubmitting ? t('common.loading') : t('auth.send_reset_link')}
                                        </button>
                                    </Form.Submit>
                                </div>
                            </FormLayout>
                        </div>

                        {/* Back to Login */}
                        <p className="text-center text-gray-600 mt-6">
                            <Link href="/login" className="inline-flex items-center gap-2 font-semibold text-gray-900 hover:underline">
                                <ArrowLeft size={16} />
                                {t('auth.back_to_login')}
                            </Link>
                        </p>
                    </div>
                </div>
        </AuthLayout>
    )
}

export default ForgotPasswordClient
