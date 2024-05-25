'use client'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
} from '@components/StyledElements/Form/Form'
import Image from 'next/image'
import * as Form from '@radix-ui/react-form'
import { useFormik } from 'formik'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import React from 'react'
import { loginAndGetToken } from '@services/auth/auth'
import { AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn, useSession } from "next-auth/react"
import { getUriWithOrg } from '@services/config/config'

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
  const router = useRouter();
  const session = useSession();

  const [error, setError] = React.useState('')
  const formik = useFormik({
    initialValues: {
      email: '',
      password: '',
    },
    validate,
    onSubmit: async (values) => {
      setIsSubmitting(true)
      //let res = await loginAndGetToken(values.email, values.password)
      const res = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
      });
      if (res && res.error) {
        setError("Wrong Email or password");
        setIsSubmitting(false);
      }
      else {
        router.push(`/`)
        setIsSubmitting(false)
      }
    },
  })

  return (
    <div className="grid grid-flow-col justify-stretch h-screen">
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
          {error && (
            <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-sm">
              <AlertTriangle size={18} />
              <div className="font-bold text-sm">{error}</div>
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
                  required
                />
              </Form.Control>
            </FormField>
            <div>
              <Link
                href={getUriWithOrg(props.org.slug, '/forgot')}
                passHref
                className="text-xs text-gray-500 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="flex  py-4">
              <Form.Submit asChild>
                <button className="w-full bg-black text-white font-bold text-center p-2 rounded-md shadow-md hover:cursor-pointer">
                  {isSubmitting ? 'Loading...' : 'Login'}
                </button>
              </Form.Submit>
            </div>
          </FormLayout>
          <div className='flex h-0.5 rounded-2xl bg-slate-100 mt-5 mb-5 mx-10'></div>
          <button onClick={() => signIn('google')} className="flex justify-center py-3 text-md w-full bg-white text-slate-600 space-x-3 font-semibold text-center p-2 rounded-md shadow hover:cursor-pointer">
            <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" alt="" />
            <span>Sign in with Google</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default LoginClient
