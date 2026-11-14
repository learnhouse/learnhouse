'use client'
import React from 'react'
import FormLayout from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { ArrowLeft } from '@phosphor-icons/react'
import Link from 'next/link'
import { useFormik } from 'formik'
import { sendResetLink } from '@services/auth/auth'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'
import { AUTH_INPUT, AUTH_LINK, AuthButton, AuthFootnote, AuthHeading, AuthLabel, AuthNotice } from '@components/Auth/AuthUI'
import TurnstileWidget, { useTurnstileRequired, verifyTurnstileToken, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

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
    const { track } = useLHAnalytics('public')
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [error, setError] = React.useState('')
    const [message, setMessage] = React.useState('')
    const [showMessage, setShowMessage] = React.useState(false)
    const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null)
    const turnstileRef = React.useRef<TurnstileWidgetHandle>(null)
    const turnstileRequired = useTurnstileRequired()

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
            try {
                // Bot check before we ask the backend to email a reset link.
                if (!(await verifyTurnstileToken(turnstileToken))) {
                    setError(t('auth.turnstile_failed', { defaultValue: 'Verification failed. Please try again.' }))
                    setShowMessage(true)
                    turnstileRef.current?.reset()
                    return
                }
                let res = await sendResetLink(values.email)
                if (res.status == 200) {
                    track(AnalyticsEvent.PasswordResetLinkRequested, { success: true })
                    setMessage(res.data + ', ' + t('auth.check_email_message'))
                    setShowMessage(true)
                } else {
                    track(AnalyticsEvent.PasswordResetLinkRequested, { success: false })
                    setError(getErrorMessage(res.data?.detail, t('auth.error_generic')))
                    setShowMessage(true)
                }
            } catch (err) {
                track(AnalyticsEvent.PasswordResetLinkRequested, { success: false })
                setError(getErrorMessage((err as any)?.response?.data?.detail, t('auth.error_generic')))
                setShowMessage(true)
            } finally {
                setIsSubmitting(false)
            }
        },
    })

    return (
        <AuthLayout
          org={org}
          welcomeText={t('auth.reset_your_password')}
          title={t('auth.image_title_forgot', { defaultValue: 'Reset your password.' })}
          subtitle={t('auth.image_subtitle_forgot', {
            defaultValue: "We'll help you get back into your account in no time.",
          })}
        >
            {showMessage && (error || message) && (
                <AuthNotice tone={error ? 'danger' : 'success'} onDismiss={() => setShowMessage(false)} className="mb-6">
                    {error || message}
                </AuthNotice>
            )}

            <AuthHeading title={t('auth.forgot_password_title')} description={t('auth.forgot_password_description')} />

            <FormLayout onSubmit={formik.handleSubmit} className="mt-7 flex flex-col gap-4">
                <Form.Field name="email" className="grid">
                    <AuthLabel error={formik.errors.email}>{t('auth.email')}</AuthLabel>
                    <Form.Control asChild>
                        <input
                            onChange={formik.handleChange}
                            value={formik.values.email}
                            type="email"
                            autoComplete="email"
                            required
                            aria-invalid={formik.errors.email ? true : undefined}
                            className={AUTH_INPUT}
                        />
                    </Form.Control>
                </Form.Field>

                <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} className="flex justify-center empty:hidden" />

                <Form.Submit asChild>
                    <AuthButton loading={isSubmitting} disabled={turnstileRequired && !turnstileToken} className="mt-1">
                        {t('auth.send_reset_link')}
                    </AuthButton>
                </Form.Submit>
            </FormLayout>

            <AuthFootnote>
                <Link href="/login" className={`${AUTH_LINK} inline-flex items-center gap-1.5`}>
                    <ArrowLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                    {t('auth.back_to_login')}
                </Link>
            </AuthFootnote>
        </AuthLayout>
    )
}

export default ForgotPasswordClient
