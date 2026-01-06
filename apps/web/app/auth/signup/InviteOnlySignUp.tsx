'use client'
import { useFormik } from 'formik'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { AlertTriangle, Check, User } from 'lucide-react'
import Link from 'next/link'
import { signUpWithInviteCode } from '@services/auth/auth'
import { useOrg } from '@components/Contexts/OrgContext'
import { signIn } from 'next-auth/react'
import { useTranslation } from 'react-i18next'

const validate = (values: any, t: any) => {
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

  if (!values.username) {
    errors.username = t('validation.required')
  }

  if (!values.username || values.username.length < 4) {
    errors.username = t('validation.username_min_length')
  }

  if (!values.bio) {
    errors.bio = t('validation.required')
  }

  return errors
}

interface InviteOnlySignUpProps {
  inviteCode: string
}

function InviteOnlySignUpComponent(props: InviteOnlySignUpProps) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const org = useOrg() as any
  const router = useRouter()
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const formik = useFormik({
    initialValues: {
      org_slug: org?.slug,
      org_id: org?.id,
      email: '',
      password: '',
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
      let res = await signUpWithInviteCode(values, props.inviteCode)
      let message = await res.json()
      if (res.status == 200) {
        //router.push(`/login`);
        setMessage(t('auth.account_created_success'))
        setIsSubmitting(false)
      } else if (
        res.status == 401 ||
        res.status == 400 ||
        res.status == 404 ||
        res.status == 409
      ) {
        setError(message.detail)
        setIsSubmitting(false)
      } else {
        setError(t('common.something_went_wrong'))
        setIsSubmitting(false)
      }
    },
  })

  useEffect(() => { }, [org])

  return (
    <div className="login-form m-auto w-72">
      {error && (
        <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-xs">
          <AlertTriangle size={18} />
          <div className="font-bold text-sm">{error}</div>
        </div>
      )}
      {message && (
        <div className="flex flex-col space-y-4 justify-center bg-green-200 rounded-md text-green-950 space-x-2 items-center p-4 transition-all shadow-xs">
          <div className="flex space-x-2">
            <Check size={18} />
            <div className="font-bold text-sm">{message}</div>
          </div>
          <hr className="border-green-900/20 800 w-40 border" />
          <Link className="flex space-x-2 items-center" href={
            `/login?orgslug=${org?.slug}`
          } >
            <User size={14} /> <div>{t('auth.login_to_your_account')}</div>
          </Link>
        </div>
      )}
      <FormLayout onSubmit={formik.handleSubmit}>
        <FormField name="email">
          <FormLabelAndMessage label={t('auth.email')} message={formik.errors.email} />
          <Form.Control asChild>
            <Input
              onChange={formik.handleChange}
              value={formik.values.email}
              type="email"
              required
            />
          </Form.Control>
        </FormField>
        <div className="flex flex-row space-x-2">
          <FormField name="first_name">
            <FormLabelAndMessage label={t('user.first_name')} message={formik.errors.first_name} />
            <Form.Control asChild>
              <Input
                onChange={formik.handleChange}
                value={formik.values.first_name}
                type="text"
                required
              />
            </Form.Control>
          </FormField>
          <FormField name="last_name">
            <FormLabelAndMessage label={t('user.last_name')} message={formik.errors.last_name} />
            <Form.Control asChild>
              <Input
                onChange={formik.handleChange}
                value={formik.values.last_name}
                type="text"
                required
              />
            </Form.Control>
          </FormField>
        </div>
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
              required
            />
          </Form.Control>
        </FormField>
        {/* for username  */}
        <FormField name="username">
          <FormLabelAndMessage
            label={t('user.username')}
            message={formik.errors.username}
          />

          <Form.Control asChild>
            <Input
              onChange={formik.handleChange}
              value={formik.values.username}
              type="text"
              required
            />
          </Form.Control>
        </FormField>

        {/* for bio  */}
        <FormField name="bio">
          <FormLabelAndMessage label={t('user.bio')} message={formik.errors.bio} />

          <Form.Control asChild>
            <Textarea
              onChange={formik.handleChange}
              value={formik.values.bio}
              required
            />
          </Form.Control>
        </FormField>

        <div className="flex  py-4">
          <Form.Submit asChild>
            <button className="w-full bg-black text-white font-bold text-center p-2 rounded-md shadow-md hover:cursor-pointer">
              {isSubmitting ? t('common.loading') : t('auth.create_account_and_join')}
            </button>
          </Form.Submit>
        </div>
      </FormLayout>
      <div>
        <div className='flex h-0.5 rounded-2xl bg-slate-100 mt-5 mb-5 mx-10'></div>
        <button onClick={() => signIn('google')} className="flex justify-center py-3 text-md w-full bg-white text-slate-600 space-x-3 font-semibold text-center p-2 rounded-md shadow-sm hover:cursor-pointer">
          <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" alt="" />
          <span>{t('auth.sign_in_with_google')}</span>
        </button>
      </div>
    </div>
  )
}

export default InviteOnlySignUpComponent
