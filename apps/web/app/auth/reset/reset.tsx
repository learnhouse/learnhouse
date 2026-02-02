'use client'
import React from 'react'
import FormLayout, {
    FormField,
    FormLabelAndMessage,
    Input,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { AlertTriangle, CheckCircle, X } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useFormik } from 'formik'
import { resetPassword } from '@services/auth/auth'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'
import { PasswordStrengthIndicator, validatePasswordStrength } from '@components/Auth/PasswordStrengthIndicator'

const validate = (values: any, t: any) => {
    const errors: any = {}

    if (!values.email) {
        errors.email = t('validation.required')
    } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
        errors.email = t('validation.invalid_email')
    }

    if (!values.new_password) {
        errors.new_password = t('validation.required')
    } else {
        const passwordValidation = validatePasswordStrength(values.new_password)
        if (!passwordValidation.isValid) {
            errors.new_password = t('auth.password_requirements_not_met')
        }
    }

    if (!values.confirm_password) {
        errors.confirm_password = t('validation.required')
    }

    if (values.new_password !== values.confirm_password) {
        errors.confirm_password = t('auth.passwords_do_not_match')
    }

    if (!values.reset_code) {
        errors.reset_code = t('validation.required')
    }
    return errors
}

interface ResetPasswordClientProps {
    org: any
}

function ResetPasswordClient({ org }: ResetPasswordClientProps) {
    const { t } = useTranslation();
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const searchParams = useSearchParams()
    const reset_code = searchParams.get('resetCode') || ''
    const email = searchParams.get('email') || ''
    const [error, setError] = React.useState('')
    const [message, setMessage] = React.useState('')
    const [showMessage, setShowMessage] = React.useState(false)

    const formik = useFormik({
        initialValues: {
            email: email,
            new_password: '',
            confirm_password: '',
            reset_code: reset_code
        },
        validate: (values) => validate(values, t),
        enableReinitialize: true,
        onSubmit: async (values) => {
            setIsSubmitting(true)
            setError('')
            setMessage('')
            setShowMessage(false)
            let res = await resetPassword(values.email, values.new_password, org?.id, values.reset_code)
            if (res.status == 200) {
                setMessage(res.data)
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
        <AuthLayout org={org} welcomeText={t('auth.create_new_password')}>
                {/* Message Top Bar */}
                {showMessage && (error || message) && (
                    <div className={`
                        w-full px-4 py-3 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200
                        ${error ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}
                    `}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            {error ? <AlertTriangle size={18} className="shrink-0" /> : <CheckCircle size={18} className="shrink-0" />}
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium">{error || message}</span>
                                {message && (
                                    <span className="text-sm ml-2">
                                        · <Link href="/login" className="underline hover:no-underline">{t('auth.proceed_to_login')}</Link>
                                    </span>
                                )}
                            </div>
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
                    <div className="m-auto w-full max-w-sm px-6">
                        {/* Header */}
                        <div className="mb-8">
                            <h1 className="text-2xl font-bold text-gray-900">{t('auth.reset_password_title')}</h1>
                            <p className="text-gray-500 mt-1">{t('auth.reset_password_description')}</p>
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
                                        />
                                    </Form.Control>
                                </FormField>

                                <FormField name="reset_code">
                                    <FormLabelAndMessage
                                        label={t('auth.reset_code')}
                                        message={formik.errors.reset_code}
                                    />
                                    <Form.Control asChild>
                                        <Input
                                            onChange={formik.handleChange}
                                            value={formik.values.reset_code}
                                            type="text"
                                        />
                                    </Form.Control>
                                </FormField>

                                <FormField name="new_password">
                                    <FormLabelAndMessage
                                        label={t('auth.new_password')}
                                        message={formik.errors.new_password}
                                    />
                                    <Form.Control asChild>
                                        <Input
                                            onChange={formik.handleChange}
                                            value={formik.values.new_password}
                                            type="password"
                                        />
                                    </Form.Control>
                                    <PasswordStrengthIndicator password={formik.values.new_password} />
                                </FormField>

                                <FormField name="confirm_password">
                                    <FormLabelAndMessage
                                        label={t('auth.confirm_password')}
                                        message={formik.errors.confirm_password}
                                    />
                                    <Form.Control asChild>
                                        <Input
                                            onChange={formik.handleChange}
                                            value={formik.values.confirm_password}
                                            type="password"
                                        />
                                    </Form.Control>
                                </FormField>

                                <div className="pt-2">
                                    <Form.Submit asChild>
                                        <button className="w-full bg-black text-white font-semibold text-center py-2.5 rounded-lg hover:bg-gray-800 transition-colors">
                                            {isSubmitting ? t('common.loading') : t('auth.change_password')}
                                        </button>
                                    </Form.Submit>
                                </div>
                            </FormLayout>
                        </div>

                        {/* Back to Login */}
                        <p className="text-center text-gray-600 mt-6">
                            {t('auth.remember_password')}{' '}
                            <Link href="/login" className="font-semibold text-gray-900 hover:underline">
                                {t('auth.login')}
                            </Link>
                        </p>
                    </div>
                </div>
        </AuthLayout>
    )
}

export default ResetPasswordClient
