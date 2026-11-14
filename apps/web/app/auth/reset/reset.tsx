'use client'
import React from 'react'
import FormLayout from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useFormik } from 'formik'
import { resetPassword } from '@services/auth/auth'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { removeQueryParamsFromAddressBar } from '@services/utils/ts/scrubUrl'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'
import { AUTH_INPUT, AUTH_LINK, AuthButton, AuthFootnote, AuthHeading, AuthLabel, AuthNotice } from '@components/Auth/AuthUI'
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
    // Read the code once, then drop it from the address bar so it can't leak
    // via history, screenshots or analytics. A reload loses the prefill; the
    // field stays editable and the emailed link still works until used.
    const [reset_code] = React.useState(() => searchParams.get('resetCode') || '')
    const email = searchParams.get('email') || ''
    React.useEffect(() => {
        removeQueryParamsFromAddressBar(['resetCode'])
    }, [])
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
            try {
                if (!(await verifyTurnstileToken(turnstileToken))) {
                    setError(t('auth.turnstile_failed', { defaultValue: 'Verification failed. Please try again.' }))
                    setShowMessage(true)
                    turnstileRef.current?.reset()
                    return
                }
                track(AnalyticsEvent.PasswordResetSubmitted, { came_from_email_link: Boolean(reset_code) })
                let res = await resetPassword(values.email, values.new_password, values.reset_code)
                if (res.status == 200) {
                    setMessage(res.data)
                    setShowMessage(true)
                } else {
                    setError(getErrorMessage(res.data?.detail, t('auth.error_generic')))
                    setShowMessage(true)
                }
            } catch (err) {
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
          welcomeText={t('auth.create_new_password')}
          title={t('auth.image_title_reset', { defaultValue: 'Almost there.' })}
          subtitle={t('auth.image_subtitle_reset', {
            defaultValue: 'Create a strong password to keep your account secure.',
          })}
        >
            {showMessage && (error || message) && (
                <AuthNotice tone={error ? 'danger' : 'success'} onDismiss={() => setShowMessage(false)} className="mb-6">
                    {error || message}
                    {message && (
                        <>
                            {' · '}
                            <Link href="/login" className="font-semibold underline underline-offset-2 hover:no-underline">
                                {t('auth.proceed_to_login')}
                            </Link>
                        </>
                    )}
                </AuthNotice>
            )}

            <AuthHeading title={t('auth.reset_password_title')} description={t('auth.reset_password_description')} />

            <FormLayout onSubmit={formik.handleSubmit} className="mt-7 flex flex-col gap-4">
                <Form.Field name="email" className="grid">
                    <AuthLabel error={formik.errors.email}>{t('auth.email')}</AuthLabel>
                    <Form.Control asChild>
                        <input
                            onChange={formik.handleChange}
                            value={formik.values.email}
                            type="email"
                            autoComplete="email"
                            aria-invalid={formik.errors.email ? true : undefined}
                            className={AUTH_INPUT}
                        />
                    </Form.Control>
                </Form.Field>

                <Form.Field name="reset_code" className="grid">
                    <AuthLabel error={formik.errors.reset_code}>{t('auth.reset_code')}</AuthLabel>
                    <Form.Control asChild>
                        <input
                            onChange={formik.handleChange}
                            value={formik.values.reset_code}
                            type="text"
                            autoComplete="one-time-code"
                            spellCheck={false}
                            aria-invalid={formik.errors.reset_code ? true : undefined}
                            className={AUTH_INPUT}
                        />
                    </Form.Control>
                </Form.Field>

                <Form.Field name="new_password" className="grid">
                    <AuthLabel error={formik.errors.new_password}>{t('auth.new_password')}</AuthLabel>
                    <Form.Control asChild>
                        <input
                            onChange={formik.handleChange}
                            value={formik.values.new_password}
                            type="password"
                            autoComplete="new-password"
                            aria-invalid={formik.errors.new_password ? true : undefined}
                            className={AUTH_INPUT}
                        />
                    </Form.Control>
                    <PasswordStrengthIndicator password={formik.values.new_password} />
                </Form.Field>

                <Form.Field name="confirm_password" className="grid">
                    <AuthLabel error={formik.errors.confirm_password}>{t('auth.confirm_password')}</AuthLabel>
                    <Form.Control asChild>
                        <input
                            onChange={formik.handleChange}
                            value={formik.values.confirm_password}
                            type="password"
                            autoComplete="new-password"
                            aria-invalid={formik.errors.confirm_password ? true : undefined}
                            className={AUTH_INPUT}
                        />
                    </Form.Control>
                </Form.Field>

                <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} className="flex justify-center empty:hidden" />

                <Form.Submit asChild>
                    <AuthButton loading={isSubmitting} disabled={turnstileRequired && !turnstileToken} className="mt-1">
                        {t('auth.change_password')}
                    </AuthButton>
                </Form.Submit>
            </FormLayout>

            <AuthFootnote>
                {t('auth.remember_password')}{' '}
                <Link href="/login" className={AUTH_LINK}>
                    {t('auth.login')}
                </Link>
            </AuthFootnote>
        </AuthLayout>
    )
}

export default ResetPasswordClient
