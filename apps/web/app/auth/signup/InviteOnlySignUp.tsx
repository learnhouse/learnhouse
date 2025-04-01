'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { signUpWithInviteCode } from '@services/auth/auth'
import { useFormik } from 'formik'
import { AlertTriangle, Check, User } from 'lucide-react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'

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

  if (!values.username) {
    errors.username = 'Required'
  }

  if (!values.username || values.username.length < 4) {
    errors.username = 'Username must be at least 4 characters'
  }

  if (!values.bio) {
    errors.bio = 'Required'
  }

  return errors
}

interface InviteOnlySignUpProps {
  inviteCode: string
}

function InviteOnlySignUpComponent(props: InviteOnlySignUpProps) {
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
    validate,
    enableReinitialize: true,
    onSubmit: async (values) => {
      setError('')
      setMessage('')
      setIsSubmitting(true)
      const res = await signUpWithInviteCode(values, props.inviteCode)
      const message = await res.json()
      if (res.status == 200) {
        //router.push(`/login`);
        setMessage('Your account was successfully created')
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
        setError('Something went wrong')
        setIsSubmitting(false)
      }
    },
  })

  useEffect(() => {}, [org])

  return (
    <div className="login-form m-auto w-72">
      {error && (
        <div className="flex items-center justify-center space-x-2 rounded-md bg-red-200 p-4 text-red-950 shadow-xs transition-all">
          <AlertTriangle size={18} />
          <div className="text-sm font-bold">{error}</div>
        </div>
      )}
      {message && (
        <div className="flex flex-col items-center justify-center space-y-4 space-x-2 rounded-md bg-green-200 p-4 text-green-950 shadow-xs transition-all">
          <div className="flex space-x-2">
            <Check size={18} />
            <div className="text-sm font-bold">{message}</div>
          </div>
          <hr className="800 w-40 border border-green-900/20" />
          <Link
            className="flex items-center space-x-2"
            href={`/login?orgslug=${org?.slug}`}
          >
            <User size={14} /> <div>Login to your account</div>
          </Link>
        </div>
      )}
      <FormLayout onSubmit={formik.handleSubmit}>
        <FormField name="email">
          <FormLabelAndMessage label="Email" message={formik.errors.email} />
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
        {/* for username  */}
        <FormField name="username">
          <FormLabelAndMessage
            label="Username"
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
          <FormLabelAndMessage label="Bio" message={formik.errors.bio} />

          <Form.Control asChild>
            <Textarea
              onChange={formik.handleChange}
              value={formik.values.bio}
              required
            />
          </Form.Control>
        </FormField>

        <div className="flex py-4">
          <Form.Submit asChild>
            <button className="w-full rounded-md bg-black p-2 text-center font-bold text-white shadow-md hover:cursor-pointer">
              {isSubmitting ? 'Loading...' : 'Create an account & Join'}
            </button>
          </Form.Submit>
        </div>
      </FormLayout>
      <div>
        <div className="mx-10 mt-5 mb-5 flex h-0.5 rounded-2xl bg-slate-100"></div>
        <button
          onClick={() => signIn('google')}
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
  )
}

export default InviteOnlySignUpComponent
