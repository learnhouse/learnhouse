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
import { readNextParam, useForwardedNextHref } from '@/lib/auth/nextParam'
import { rememberPostAuthNext, takeLoginHint } from '@/lib/auth/signup'

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
    // Back to sign-in keeps where they were headed (an invitation page).
    const loginHref = useForwardedNextHref('/login')

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
                // Where they were headed travels with the reset (the link comes
                // back with it) and is remembered on this host as a fallback.
                const next = readNextParam(window.location.search)
                rememberPostAuthNext(next)
                let res = await sendResetLink(values.email, next)
                if (res.status == 200) {
                    track(AnalyticsEvent.PasswordResetLinkRequested, { success: true })
                    const sent = typeof res.data === 'string' ? res.data : res.data?.message ?? res.data?.detail
                    setMessage(sent ? `${sent}, ${t('auth.check_email_message')}` : t('auth.check_email_message'))
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

    // Coming from a page that knew the address (a verified invitation): it is
    // handed over in sessionStorage, never the URL.
    React.useEffect(() => {
        const hint = takeLoginHint()
        if (hint) formik.setFieldValue('email', hint, false)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
                <Link href={loginHref} className={`${AUTH_LINK} inline-flex items-center gap-1.5`}>
                    <ArrowLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                    {t('auth.back_to_login')}
                </Link>
            </AuthFootnote>
        </AuthLayout>
    )
}

export default ForgotPasswordClient
