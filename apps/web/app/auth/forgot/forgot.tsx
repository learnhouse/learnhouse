'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { sendResetLink } from '@services/auth/auth'
import { getUriWithOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { useFormik } from 'formik'
import { AlertTriangle, Info } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { useState } from 'react'

const validate = (values: any) => {
  const errors: any = {}

  if (!values.email) {
    errors.email = 'Required'
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
    errors.email = 'Invalid email address'
  }

  return errors
}

function ForgotPasswordClient() {
  const org = useOrg() as any
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const formik = useFormik({
    initialValues: {
      email: '',
    },
    validate,
    validateOnBlur: true,
    onSubmit: async (values) => {
      setIsSubmitting(true)
      const res = await sendResetLink(values.email, org?.id)
      if (res.status == 200) {
        setMessage(res.data + ', please check your email')
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
          <h1 className="mb-4 text-2xl font-bold">Forgot Password</h1>
          <p className="mb-4 text-sm">
            Enter your email address and we will send you a link to reset your
            password
          </p>

          {error && (
            <div className="flex items-center justify-center space-x-2 rounded-md bg-red-200 p-4 text-red-950 shadow-xs transition-all">
              <AlertTriangle size={18} />
              <div className="text-sm font-bold">{error}</div>
            </div>
          )}
          {message && (
            <div className="flex items-center justify-center space-x-2 rounded-md bg-green-200 p-4 text-green-950 shadow-xs transition-all">
              <Info size={18} />
              <div className="text-sm font-bold">{message}</div>
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
                  required
                />
              </Form.Control>
            </FormField>
            <div className="flex py-4">
              <Form.Submit asChild>
                <button className="w-full rounded-md bg-black p-2 text-center font-bold text-white shadow-md hover:cursor-pointer">
                  {isSubmitting ? 'Loading...' : 'Send Reset Link'}
                </button>
              </Form.Submit>
            </div>
          </FormLayout>
        </div>
      </div>
    </div>
  )
}

export default ForgotPasswordClient
