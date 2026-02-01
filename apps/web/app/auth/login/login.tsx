'use client'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
} from '@components/Objects/StyledElements/Form/Form'
import Image from 'next/image'
import * as Form from '@radix-ui/react-form'
import { useFormik } from 'formik'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import React, { useState, useEffect } from 'react'
import { AlertTriangle, Lock, Mail, UserRoundPlus, Shield } from 'lucide-react'
import { checkSSOEnabled, redirectToSSOLogin } from '@services/auth/sso'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn } from "next-auth/react"
import { getUriWithOrg, getLEARNHOUSE_TOP_DOMAIN_VAL } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'
import { resendVerificationEmail } from '@services/auth/auth'

interface LoginClientProps {
  org: any
}

const LoginClient = (props: LoginClientProps) => {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [ssoEnabled, setSsoEnabled] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const router = useRouter();
  const session = useLHSession() as any;

  // Error state with type information
  const [error, setError] = useState('')
  const [errorType, setErrorType] = useState<string | null>(null)
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [isResendingVerification, setIsResendingVerification] = useState(false)
  const [verificationResent, setVerificationResent] = useState(false)

  const handleGoogleSignIn = () => {
    // Store org context in cookies before OAuth redirect
    if (props.org?.slug) {
      const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL();
      const baseAttributes = '; path=/; secure; SameSite=Lax';
      const domainAttr = topDomain === 'localhost' ? '' : `; domain=.${topDomain}`;
      document.cookie = `learnhouse_oauth_orgslug=${props.org.slug}${baseAttributes}${domainAttr}`;
      document.cookie = `learnhouse_oauth_org_id=${props.org.id}${baseAttributes}${domainAttr}`;
    }
    signIn('google', { callbackUrl: '/redirect_from_auth' });
  };

  // Check if SSO is enabled for this organization
  useEffect(() => {
    const checkSSO = async () => {
      if (props.org?.slug) {
        try {
          const result = await checkSSOEnabled(props.org.slug)
          setSsoEnabled(result.sso_enabled)
        } catch (error) {
          // SSO not available, silently ignore
          console.debug('SSO check failed:', error)
        }
      }
    }
    checkSSO()
  }, [props.org?.slug])

  const handleSSOLogin = async () => {
    setSsoLoading(true)
    try {
      await redirectToSSOLogin(props.org.slug)
    } catch (error: any) {
      setError(error.message || t('auth.sso_error'))
      setSsoLoading(false)
    }
  }

  const validate = (values: any) => {
    const errors: any = {}

    if (!values.email) {
      errors.email = t('validation.required')
    } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
      errors.email = t('validation.invalid_email')
    }

    if (!values.password) {
      errors.password = t('validation.required')
    } else if (values.password.length < 8) {
      errors.password = t('validation.password_min_length')
    }

    return errors
  }

  const handleResendVerification = async () => {
    if (!unverifiedEmail || !props.org?.id) return

    setIsResendingVerification(true)
    try {
      const res = await resendVerificationEmail(unverifiedEmail, props.org.id)
      if (res.success) {
        setVerificationResent(true)
      } else {
        setError(res.error || t('auth.resend_verification_failed'))
      }
    } catch (err) {
      setError(t('auth.resend_verification_failed'))
    } finally {
      setIsResendingVerification(false)
    }
  }
  const formik = useFormik({
    initialValues: {
      email: '',
      password: '',
    },
    validate,
    validateOnBlur: true,
    validateOnChange: true,
    onSubmit: async (values, {validateForm, setErrors, setSubmitting}) => {
      setIsSubmitting(true)
      setError('')
      setErrorType(null)
      setUnverifiedEmail(null)
      setVerificationResent(false)

      const errors = await validateForm(values);
      if (Object.keys(errors).length > 0) {
        setErrors(errors);
        setSubmitting(false);
        setIsSubmitting(false);
        return;
      }

      const res = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
        callbackUrl: '/redirect_from_auth'
      });

      if (res && res.error) {
        // Try to parse the error message for error codes
        try {
          // The error from next-auth might contain our structured error
          const errorData = JSON.parse(res.error);
          if (errorData.code) {
            setErrorType(errorData.code);
            setError(errorData.message || t('auth.wrong_email_password'));
            if (errorData.code === 'EMAIL_NOT_VERIFIED' && errorData.email) {
              setUnverifiedEmail(errorData.email);
            }
          } else {
            setError(t('auth.wrong_email_password'));
          }
        } catch {
          // If parsing fails, check for specific error strings
          if (res.error.includes('EMAIL_NOT_VERIFIED')) {
            setErrorType('EMAIL_NOT_VERIFIED');
            setError(t('auth.email_not_verified_message'));
            setUnverifiedEmail(values.email);
          } else if (res.error.includes('ACCOUNT_LOCKED')) {
            setErrorType('ACCOUNT_LOCKED');
            setError(t('auth.account_locked_message'));
          } else if (res.error.includes('RATE_LIMITED')) {
            setErrorType('RATE_LIMITED');
            setError(t('auth.rate_limited_message'));
          } else {
            setError(t('auth.wrong_email_password'));
          }
        }
        setIsSubmitting(false);
      } else {
        await signIn('credentials', {
          email: values.email,
          password: values.password,
          callbackUrl: '/redirect_from_auth'
        });
      }
    },
  })

  return (
    <div className="grid grid-flow-col justify-stretch h-screen">
      <div className="absolute top-4 right-4 z-dropdown">
        <LanguageSwitcher />
      </div>
      <div
        className="right-login-part"
        style={{
          background:
            'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
        }}
      >
        <div className="login-topbar m-10">
          <Link prefetch href={getUriWithOrg(props.org.slug, '/')}>
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
            <div>{t('auth.login_to')} </div>
            <div className="shadow-[0px_4px_16px_rgba(0,0,0,0.02)]">
              {props.org?.logo_image ? (
                <img
                  src={`${getOrgLogoMediaDirectory(
                    props.org.org_uuid,
                    props.org?.logo_image
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
            <div className="font-bold text-xl">{props.org?.name}</div>
          </div>
        </div>
      </div>
      <div className="left-login-part bg-white flex flex-row">
        <div className="login-form m-auto w-72">
          {error && errorType === 'EMAIL_NOT_VERIFIED' && !verificationResent && (
            <div className="flex flex-col gap-3 bg-yellow-100 rounded-md text-yellow-900 p-4 transition-all shadow-xs">
              <div className="flex items-center gap-2">
                <Mail size={18} />
                <div className="font-bold text-sm">{t('auth.email_not_verified')}</div>
              </div>
              <p className="text-xs">{t('auth.email_not_verified_message')}</p>
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={isResendingVerification}
                className="text-sm font-medium text-yellow-800 hover:text-yellow-900 underline"
              >
                {isResendingVerification ? t('common.loading') : t('auth.resend_verification_email')}
              </button>
            </div>
          )}
          {verificationResent && (
            <div className="flex flex-col gap-2 bg-green-100 rounded-md text-green-900 p-4 transition-all shadow-xs">
              <div className="flex items-center gap-2">
                <Mail size={18} />
                <div className="font-bold text-sm">{t('auth.verification_email_resent')}</div>
              </div>
              <p className="text-xs">{t('auth.check_inbox_message')}</p>
            </div>
          )}
          {error && errorType === 'ACCOUNT_LOCKED' && (
            <div className="flex flex-col gap-2 bg-red-100 rounded-md text-red-900 p-4 transition-all shadow-xs">
              <div className="flex items-center gap-2">
                <Lock size={18} />
                <div className="font-bold text-sm">{t('auth.account_locked')}</div>
              </div>
              <p className="text-xs">{error}</p>
            </div>
          )}
          {error && errorType === 'RATE_LIMITED' && (
            <div className="flex flex-col gap-2 bg-orange-100 rounded-md text-orange-900 p-4 transition-all shadow-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} />
                <div className="font-bold text-sm">{t('auth.rate_limited')}</div>
              </div>
              <p className="text-xs">{error}</p>
            </div>
          )}
          {error && !errorType && (
            <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-xs">
              <AlertTriangle size={18} />
              <div className="font-bold text-sm">{error}</div>
            </div>
          )}
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
            {/* for password  */}
            <FormField name="password">
              <FormLabelAndMessage
                label={t('auth.password')}
                message={formik.errors.password}
              />

              <Form.Control asChild>
                <Input
                  onChange={formik.handleChange}
                  value={formik.values.password}
                  type="password"
                  
                />
              </Form.Control>
            </FormField>
            <div>
              <Link
                href="/forgot"
                className="text-xs text-gray-500 hover:underline"
              >
                {t('auth.forgot_password')}
              </Link>
            </div>
            <div className="flex  py-4">
              <Form.Submit asChild>
                <button  className="w-full bg-black text-white font-bold text-center p-2 rounded-md shadow-md hover:cursor-pointer">
                  {isSubmitting ? t('common.loading') : t('auth.login')}
                </button>
              </Form.Submit>
            </div>
          </FormLayout>
          <div className='flex h-0.5 rounded-2xl bg-slate-100 mt-5  mx-10'></div>
          <div className='flex justify-center py-5 mx-auto'>{t('common.or')} </div>
          <div className='flex flex-col space-y-2'>
            <Link href="/signup" className="flex justify-center items-center py-2 text-sm w-full bg-gray-800 text-gray-300 space-x-2 font-medium text-center px-3 rounded-md shadow-sm hover:cursor-pointer">
              <UserRoundPlus size={15} />
              <span>{t('auth.sign_up')}</span>
            </Link>
            <button onClick={handleGoogleSignIn} className="flex justify-center items-center py-2 text-sm w-full bg-white text-slate-600 space-x-2 font-medium text-center px-3 rounded-md shadow-sm hover:cursor-pointer">
              <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" alt="" className="w-4 h-4" />
              <span>{t('auth.sign_in_with_google')}</span>
            </button>
            {ssoEnabled && (
              <button
                onClick={handleSSOLogin}
                disabled={ssoLoading}
                className="flex justify-center items-center py-2 text-sm w-full bg-indigo-600 text-white space-x-2 font-medium text-center px-3 rounded-md shadow-sm hover:bg-indigo-700 hover:cursor-pointer disabled:opacity-50"
              >
                <Shield size={15} />
                <span>{ssoLoading ? t('common.loading') : t('auth.sign_in_with_sso')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginClient
