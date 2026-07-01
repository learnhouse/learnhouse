'use client'
import React from 'react'
import FormLayout, {
    FormField,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useFormik } from 'formik'
import { resetPassword } from '@services/auth/auth'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'
import { PasswordStrengthIndicator, validatePasswordStrength } from '@components/Auth/PasswordStrengthIndicator'
import TurnstileWidget, { useTurnstileRequired, verifyTurnstileToken, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

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
    const { track } = useLHAnalytics('public')
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const searchParams = useSearchParams()
    const reset_code = searchParams.get('resetCode') || ''
    const email = searchParams.get('email') || ''
    const [error, setError] = React.useState('')
    const [message, setMessage] = React.useState('')
    const [showMessage, setShowMessage] = React.useState(false)
    const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null)
    const turnstileRef = React.useRef<TurnstileWidgetHandle>(null)
    const turnstileRequired = useTurnstileRequired()

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
            if (!(await verifyTurnstileToken(turnstileToken))) {
                setError(t('auth.turnstile_failed', { defaultValue: 'Verification failed. Please try again.' }))
                setShowMessage(true)
                setIsSubmitting(false)
                turnstileRef.current?.reset()
                return
            }
            track(AnalyticsEvent.PasswordResetSubmitted, { came_from_email_link: Boolean(reset_code) })
            let res = await resetPassword(values.email, values.new_password, org?.id, values.reset_code)
            if (res.status == 200) {
                setMessage(res.data)
                setShowMessage(true)
                setIsSubmitting(false)
            } else {
                setError(res.data?.detail ?? t('auth.error_generic'))
                setShowMessage(true)
                setIsSubmitting(false)
            }
        },
    })

    return (
        <AuthLayout
          org={org}
          welcomeText={t('auth.create_new_password')}
          title={t('auth.image_title_reset', { defaultValue: 'Almost there.' })}
          subtitle={t('auth.image_subtitle_reset', {
            defaultValue: 'Create a strong password to keep your account secure.',
          })}
        >
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

                <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
                    <div className="w-full max-w-[420px] py-10">
                        {/* Header */}
                        <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">{t('auth.reset_password_title')}</h1>
                        <p className="mt-2 text-black/45 text-[15px] font-medium">{t('auth.reset_password_description')}</p>

                        {/* Form */}
                        <div className="mt-8">
                            <FormLayout onSubmit={formik.handleSubmit}>
                                <FormField name="email">
                                    <div className="flex items-center space-x-2 mb-1.5">
                                        <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('auth.email')}</Form.Label>
                                        {formik.errors.email && (
                                            <div className="text-red-500 text-xs flex items-center space-x-1">
                                                <Info size={11} />
                                                <span>{formik.errors.email}</span>
                                            </div>
                                        )}
                                    </div>
                                    <Form.Control asChild>
                                        <input
                                            onChange={formik.handleChange}
                                            value={formik.values.email}
                                            type="email"
                                            className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                                        />
                                    </Form.Control>
                                </FormField>

                                <FormField name="reset_code">
                                    <div className="flex items-center space-x-2 mb-1.5">
                                        <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('auth.reset_code')}</Form.Label>
                                        {formik.errors.reset_code && (
                                            <div className="text-red-500 text-xs flex items-center space-x-1">
                                                <Info size={11} />
                                                <span>{formik.errors.reset_code}</span>
                                            </div>
                                        )}
                                    </div>
                                    <Form.Control asChild>
                                        <input
                                            onChange={formik.handleChange}
                                            value={formik.values.reset_code}
                                            type="text"
                                            className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                                        />
                                    </Form.Control>
                                </FormField>

                                <FormField name="new_password">
                                    <div className="flex items-center space-x-2 mb-1.5">
                                        <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('auth.new_password')}</Form.Label>
                                        {formik.errors.new_password && (
                                            <div className="text-red-500 text-xs flex items-center space-x-1">
                                                <Info size={11} />
                                                <span>{formik.errors.new_password}</span>
                                            </div>
                                        )}
                                    </div>
                                    <Form.Control asChild>
                                        <input
                                            onChange={formik.handleChange}
                                            value={formik.values.new_password}
                                            type="password"
                                            autoComplete="new-password"
                                            className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                                        />
                                    </Form.Control>
                                    <PasswordStrengthIndicator password={formik.values.new_password} />
                                </FormField>

                                <FormField name="confirm_password">
                                    <div className="flex items-center space-x-2 mb-1.5">
                                        <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('auth.confirm_password')}</Form.Label>
                                        {formik.errors.confirm_password && (
                                            <div className="text-red-500 text-xs flex items-center space-x-1">
                                                <Info size={11} />
                                                <span>{formik.errors.confirm_password}</span>
                                            </div>
                                        )}
                                    </div>
                                    <Form.Control asChild>
                                        <input
                                            onChange={formik.handleChange}
                                            value={formik.values.confirm_password}
                                            type="password"
                                            autoComplete="new-password"
                                            className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                                        />
                                    </Form.Control>
                                </FormField>

                                <TurnstileWidget
                                    ref={turnstileRef}
                                    onToken={setTurnstileToken}
                                    className="mt-2 flex justify-center"
                                />

                                <Form.Submit asChild>
                                    <button
                                        disabled={isSubmitting || (turnstileRequired && !turnstileToken)}
                                        className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none mt-2 transition-all disabled:opacity-50"
                                    >
                                        {isSubmitting ? (
                                            <span className="flex items-center space-x-2">
                                                <span className="w-4 h-4 border-t-2 border-white rounded-full animate-spin" />
                                                <span>{t('common.loading')}</span>
                                            </span>
                                        ) : (
                                            t('auth.change_password')
                                        )}
                                    </button>
                                </Form.Submit>
                            </FormLayout>
                        </div>

                        {/* Back to Login */}
                        <p className="text-center text-sm text-black/35 mt-6">
                            {t('auth.remember_password')}{' '}
                            <Link href="/login" className="text-black font-semibold hover:underline">
                                {t('auth.login')}
                            </Link>
                        </p>
                    </div>
                </div>
        </AuthLayout>
    )
}

export default ResetPasswordClient
