'use client'
import Image from 'next/image'
import { useFormik } from 'formik'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  LucideLoader2,
  LucideLock,
  Mail,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { signup } from '@services/auth/auth'
import { useOrg } from '@components/Contexts/OrgContext'
import { signIn } from 'next-auth/react'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'

const validate = (values: any, t: any) => {
  const errors: any = {}

  if (!values.email) {
    errors.email = t('validation.required')
  } else if (
    !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)
  ) {
    errors.email = t('validation.invalid_email')
  }

  if (!values.password) {
    errors.password = t('validation.required')
  } else if (values.password.length < 8) {
    errors.password = t('validation.password_min_length')
  }

  if (!values.username) {
    errors.username = t('validation.required')
  } else if (values.username.length < 4) {
    errors.username = t('validation.username_min_length')
  }

  if (!values.bio) {
    errors.bio = t('validation.required')
  }

  return errors
}

const getPasswordStrength = (password: string) => {
  const rules = {
    length: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^a-zA-Z0-9]/.test(password),
  }

  const score = Object.values(rules).filter(Boolean).length

  let strength: 'weak' | 'medium' | 'strong' = 'weak'
  if (score >= 4) strength = 'strong'
  else if (score >= 3) strength = 'medium'

  return { rules, score, strength }
}

function OpenSignUpComponent() {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const org = useOrg() as any
  const router = useRouter()
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const formik = useFormik({
    initialValues: {
      org_slug: org?.slug,
      org_id: org?.id,
      email: '',
      password: '',
      confirmPassword: '',
      username: '',
      bio: '',
      first_name: '',
      last_name: '',
    },
    validate: (values) => validate(values, t),
    enableReinitialize: true,
    onSubmit: async (values) => {
      setError('')
      setMessage('')
      setIsSubmitting(true)

      const res = await signup(values)
      const response = await res.json()

      if (res.status === 200) {
        setMessage(t('auth.account_created_success'))
      } else if (
        res.status === 401 ||
        res.status === 400 ||
        res.status === 404 ||
        res.status === 409
      ) {
        setError(response.detail)
      } else {
        setError(t('common.something_went_wrong'))
      }

      setIsSubmitting(false)
    },
  })

  useEffect(() => { }, [org])

  return (
    <>
      <div className="h-screen w-full flex flex-col items-center justify-center overflow-y-auto">
        <div className="w-full md:w-96 max-h-screen  px-4">
          <div className="flex justify-end mb-4">
            <LanguageSwitcher />
          </div>
          
          <div className=" space-y-4">
      {/* Error feedback */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-red-100 p-4 text-red-900 shadow-sm">
          <AlertTriangle size={18} className="mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">We couldn’t create your account</p>
            <p className="opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Success feedback */}
      {message && (
        <div className="flex flex-col gap-3 rounded-md bg-green-100 p-4 text-green-900 shadow-sm">
          <div className="flex items-center gap-2">
            <Check size={18} />
            <p className="text-sm font-semibold">{message}</p>
          </div>

          <p className="text-xs opacity-80">
            Your account is ready. You can now sign in and get started.
          </p>

          <Link
            href="/login"
            className="flex items-center gap-2 text-sm font-semibold underline"
          >
            <User size={14} />
            {t('auth.login')}
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="text-center space-y-1 flex flex-col   items-center">
             <Image
                quality={100}
                width={50}
                height={50}
                src={learnhouseIcon}
                alt="learnhouseicon"
               />
        <h1 className="text-3xl font-bold tracking-tight">
          {t('auth.create_account')}
        </h1>
      
        <p className="text-sm text-slate-600">
          Create your account in just a few steps
        </p>
      </div>

      <FormLayout onSubmit={formik.handleSubmit} className='border-2 border-gray-100 rounded-2xl p-5'>
        {/* Email */}
        <FormField name="email">
          <FormLabelAndMessage label={t('auth.email')} />
          <div className="relative">
            <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Form.Control asChild>
              <Input
                className={`pl-10 ${formik.errors.email
                    ? 'border-red-400 focus:ring-red-400'
                    : ''
                  }`}
                onChange={formik.handleChange}
                value={formik.values.email}
                type="email"
                placeholder="you@example.com"
                required
              />
            </Form.Control>
          </div>
          {formik.errors.email && (
            <p className="mt-1 text-xs text-red-600">{formik.errors.email}</p>
          )}
        </FormField>

        {/* Names */}
        <div className="flex flex-col md:flex-row gap-2">
          <FormField name="first_name">
            <FormLabelAndMessage label={t('user.first_name')} />
            <Form.Control asChild>
              <Input
                onChange={formik.handleChange}
                value={formik.values.first_name}
                placeholder="First name"
                type="text"
                required
              />
            </Form.Control>
            {formik.errors.first_name && (
              <p className="mt-1 text-xs text-red-600">{formik.errors.first_name}</p>
            )}
          </FormField>

          <FormField name="last_name">
            <FormLabelAndMessage label={t('user.last_name')} />
            <Form.Control asChild>
              <Input
                onChange={formik.handleChange}
                value={formik.values.last_name}
                placeholder="Last name"
                type="text"
                required
              />
            </Form.Control>
            {formik.errors.last_name && (
              <p className="mt-1 text-xs text-red-600">{formik.errors.last_name}</p>
            )}
          </FormField>
        </div>

             {/* Password */}
            <FormField name="password">
              <FormLabelAndMessage label={t('auth.password')} />
              <div className="relative">
                <LucideLock className="absolute right-10 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Form.Control asChild>
                  <Input
                    className={`pl-10 ${formik.errors.password ? 'border-red-400' : ''}`}
                    onChange={formik.handleChange}
                    value={formik.values.password}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Create a strong password"
                    required
                  />
                </Form.Control>
                <button
                  type="button"
                  onClick={() => setShowPassword((prev: any) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {formik.errors.password && (
                <p className="mt-1 text-xs text-red-600">{formik.errors.password}</p>
              )}

              {formik.values.password && (() => {
                const strength = getPasswordStrength(formik.values.password)
                return (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full ${i <= strength.score
                              ? strength.strength === 'strong'
                                ? 'bg-green-500'
                                : strength.strength === 'medium'
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              : 'bg-slate-200'
                            }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-slate-600">
                      Use at least 8 characters, one uppercase letter, and one number.
                    </p>
                  </div>
                )
              })()}
            </FormField>

        
            {/* Confirm Password */}
            <FormField name="confirmPassword">
              <FormLabelAndMessage label={t('auth.confirm_password')} />
              <div className="relative">
                <LucideLock className="absolute right-10 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Form.Control asChild>
                  <Input
                    className={`pl-10 ${formik.errors.confirmPassword ? 'border-red-400' : ''}`}
                    onChange={formik.handleChange}
                    value={formik.values.confirmPassword}
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm password"
                    required
                  />
                </Form.Control>
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev: any) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {formik.errors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600">{formik.errors.confirmPassword}</p>
              )}
            </FormField>

        {/* Username */}
        <FormField name="username">
          <FormLabelAndMessage label={t('user.username')} />
          <div className="relative">
            <User className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Form.Control asChild>
              <Input
                className="pl-10"
                onChange={formik.handleChange}
                value={formik.values.username}
                placeholder="Choose a unique username"
                type="text"
                required
              />
            </Form.Control>
          </div>
          {formik.errors.username && (
            <p className="mt-1 text-xs text-red-600">{formik.errors.username}</p>
          )}
        </FormField>

        {/* Bio */}
        <FormField name="bio">
          <FormLabelAndMessage label={t('user.bio')} />
          <Form.Control asChild>
            <Textarea
              className="resize-none"
              rows={4}
              onChange={formik.handleChange}
              value={formik.values.bio}
              placeholder="Tell us a bit about yourself"
              required
            />
          </Form.Control>
          {formik.errors.bio && (
            <p className="mt-1 text-xs text-red-600">{formik.errors.bio}</p>
          )}
        </FormField>

        {/* Submit */}
        <div className="py-4">
          <Form.Submit asChild>
            <button
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 rounded-md bg-black p-3 font-semibold text-white shadow hover:opacity-90 disabled:opacity-60"
            >
              {isSubmitting && (
                <LucideLoader2 className="h-4 w-4 animate-spin" />
              )}
              {isSubmitting
                ? t('common.loading')
                : t('auth.create_account')}
            </button>
          </Form.Submit>
        </div>
      </FormLayout>

          {/* Divider + Google */}
          <div className='flex flex-col mb-4'>
            <div className="mx-10 my-5 h-0.5 rounded-2xl bg-slate-100" />
            <button
              onClick={() => signIn('google')}
              className="flex w-full items-center justify-center gap-3 rounded-md bg-white p-3 text-sm font-semibold text-slate-600 shadow-sm hover:cursor-pointer"
            >
              <img
                src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg"
                alt=""
              />
              <span>{t('auth.sign_in_with_google')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </>
  )
}

export default OpenSignUpComponent
