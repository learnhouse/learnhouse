'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { useFormik } from 'formik'
import { AlertTriangle, UserRoundPlus } from 'lucide-react'
import { signIn } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import React from 'react'

interface LoginClientProps {
  org: any
}

const validate = (values: any) => {
  const errors: any = {}

  if (!values.email) {
    errors.email = 'Required'
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
    errors.email = 'Invalid email address'
  }

  if (!values.password) {
    errors.password = 'Required'
  } else if (values.password.length < 8) {
    errors.password = 'Password must be at least 8 characters'
  }

  return errors
}

const LoginClient = (props: LoginClientProps) => {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const router = useRouter()
  const session = useLHSession() as any

  const [error, setError] = React.useState('')
  const formik = useFormik({
    initialValues: {
      email: '',
      password: '',
    },
    validate,
    validateOnBlur: true,
    validateOnChange: true,
    onSubmit: async (values, { validateForm, setErrors, setSubmitting }) => {
      setIsSubmitting(true)
      const errors = await validateForm(values)
      if (Object.keys(errors).length > 0) {
        setErrors(errors)
        setSubmitting(false)
        return
      }

      const res = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
        callbackUrl: '/redirect_from_auth',
      })
      if (res && res.error) {
        setError('Wrong Email or password')
        setIsSubmitting(false)
      } else {
        await signIn('credentials', {
          email: values.email,
          password: values.password,
          callbackUrl: '/redirect_from_auth',
        })
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
        <div className="ml-10 flex h-4/6 flex-row text-white">
          <div className="m-auto flex flex-wrap items-center space-x-4">
            <div>Login to </div>
            <div className="shadow-[0px_4px_16px_rgba(0,0,0,0.02)]">
              {props.org?.logo_image ? (
                <img
                  src={`${getOrgLogoMediaDirectory(
                    props.org.org_uuid,
                    props.org?.logo_image
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
            <div className="text-xl font-bold">{props.org?.name}</div>
          </div>
        </div>
      </div>
      <div className="left-login-part flex flex-row bg-white">
        <div className="login-form m-auto w-72">
          {error && (
            <div className="flex items-center justify-center space-x-2 rounded-md bg-red-200 p-4 text-red-950 shadow-xs transition-all">
              <AlertTriangle size={18} />
              <div className="text-sm font-bold">{error}</div>
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
            {/* for password  */}
            <FormField name="password">
              <FormLabelAndMessage
                label="Password"
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
                href={{
                  pathname: getUriWithoutOrg('/forgot'),
                  query: props.org.slug ? { orgslug: props.org.slug } : null,
                }}
                passHref
                className="text-xs text-gray-500 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="flex py-4">
              <Form.Submit asChild>
                <button className="w-full rounded-md bg-black p-2 text-center font-bold text-white shadow-md hover:cursor-pointer">
                  {isSubmitting ? 'Loading...' : 'Login'}
                </button>
              </Form.Submit>
            </div>
          </FormLayout>
          <div className="mx-10 mt-5 flex h-0.5 rounded-2xl bg-slate-100"></div>
          <div className="mx-auto flex justify-center py-5">OR </div>
          <div className="flex flex-col space-y-4">
            <Link
              href={{
                pathname: getUriWithoutOrg('/signup'),
                query: props.org.slug ? { orgslug: props.org.slug } : null,
              }}
              className="text-md flex w-full items-center justify-center space-x-3 rounded-md bg-gray-800 p-2 py-3 text-center font-semibold text-gray-300 shadow-sm hover:cursor-pointer"
            >
              <UserRoundPlus size={17} />
              <span>Sign up</span>
            </Link>
            <button
              onClick={() =>
                signIn('google', { callbackUrl: '/redirect_from_auth' })
              }
              className="text-md flex w-full justify-center space-x-3 rounded-md bg-white p-2 py-3 text-center font-semibold text-slate-600 shadow-sm hover:cursor-pointer"
            >
              <img
                src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg"
                alt=""
              />
              <span>Sign in with Google</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginClient
