'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { resetPassword } from '@services/auth/auth'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { useFormik } from 'formik'
import { AlertTriangle, Info } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import React from 'react'

const validate = (values: any) => {
  const errors: any = {}

  if (!values.email) {
    errors.email = 'Required'
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
    errors.email = 'Invalid email address'
  }

  if (!values.new_password) {
    errors.new_password = 'Required'
  }

  if (!values.confirm_password) {
    errors.confirm_password = 'Required'
  }

  if (values.new_password !== values.confirm_password) {
    errors.confirm_password = 'Passwords do not match'
  }

  if (!values.reset_code) {
    errors.reset_code = 'Required'
  }
  return errors
}

function ResetPasswordClient() {
  const org = useOrg() as any
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const searchParams = useSearchParams()
  const reset_code = searchParams.get('resetCode') || ''
  const email = searchParams.get('email') || ''
  const router = useRouter()
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')

  const formik = useFormik({
    initialValues: {
      email: email,
      new_password: '',
      confirm_password: '',
      reset_code: reset_code,
    },
    validate,
    enableReinitialize: true,
    onSubmit: async (values) => {
      setIsSubmitting(true)
      const res = await resetPassword(
        values.email,
        values.new_password,
        org?.id,
        values.reset_code
      )
      if (res.status == 200) {
        setMessage(res.data + ', please login')
        setIsSubmitting(false)
      } else {
        setError(res.data.detail)
        setIsSubmitting(false)
      }
    },
  })
  return (
    <div className="grid h-screen grid-flow-col justify-stretch">
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
        <div className="ml-10 flex h-4/6 flex-row text-white">
          <div className="m-auto flex flex-wrap items-center space-x-4">
            <div className="shadow-[0px_4px_16px_rgba(0,0,0,0.02)]">
              {org?.logo_image ? (
                <img
                  src={`${getOrgLogoMediaDirectory(
                    org?.org_uuid,
                    org?.logo_image
                  )}`}
                  alt="Learnhouse"
                  style={{ width: 'auto', height: 70 }}
                  className="inset-0 rounded-xl bg-white shadow-xl ring-1 ring-black/10 ring-inset"
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
            <div className="text-xl font-bold">{org?.name}</div>
          </div>
        </div>
      </div>
      <div className="left-login-part flex flex-row bg-white">
        <div className="login-form m-auto w-72">
          <h1 className="mb-4 text-2xl font-bold">Reset Password</h1>
          <p className="mb-4 text-sm">
            Enter your email and reset code to reset your password
          </p>

          {error && (
            <div className="flex items-center justify-center space-x-2 rounded-md bg-red-200 p-4 text-red-950 shadow-xs transition-all">
              <AlertTriangle size={18} />
              <div className="text-sm font-bold">{error}</div>
            </div>
          )}
          {message && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-center space-x-2 rounded-md bg-green-200 p-4 text-green-950 shadow-xs transition-all">
                <Info size={18} />
                <div className="text-sm font-bold">{message}</div>
              </div>
              <Link
                href={getUriWithoutOrg('/login?orgslug=' + org.slug)}
                className="text-center text-sm text-blue-600 hover:text-blue-800"
              >
                Please login again with your new password
              </Link>
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
                />
              </Form.Control>
            </FormField>

            <FormField name="reset_code">
              <FormLabelAndMessage
                label="Reset Code"
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
                label="New Password"
                message={formik.errors.new_password}
              />
              <Form.Control asChild>
                <Input
                  onChange={formik.handleChange}
                  value={formik.values.new_password}
                  type="password"
                />
              </Form.Control>
            </FormField>

            <FormField name="confirm_password">
              <FormLabelAndMessage
                label="Confirm Password"
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

            <div className="flex py-4">
              <Form.Submit asChild>
                <button className="w-full rounded-md bg-black p-2 text-center font-bold text-white shadow-md hover:cursor-pointer">
                  {isSubmitting ? 'Loading...' : 'Change Password'}
                </button>
              </Form.Submit>
            </div>
          </FormLayout>
        </div>
      </div>
    </div>
  )
}

export default ResetPasswordClient
