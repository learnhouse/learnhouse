'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'
import { Switch } from '@components/ui/switch'
import { Textarea } from '@components/ui/textarea'
import learnhouseIcon from '@public/learnhouse_logo.png'
import { getAPIUrl } from '@services/config/config'
import { updateOrganization } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { Form, Formik } from 'formik'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { toast } from 'react-hot-toast'
import { mutate } from 'swr'
import * as Yup from 'yup'

const ORG_LABELS = [
  { value: 'languages', label: '🌐 Languages' },
  { value: 'business', label: '💰 Business' },
  { value: 'ecommerce', label: '🛍 E-commerce' },
  { value: 'gaming', label: '🎮 Gaming' },
  { value: 'music', label: '🎸 Music' },
  { value: 'sports', label: '⚽ Sports' },
  { value: 'cars', label: '🚗 Cars' },
  { value: 'sales_marketing', label: '🚀 Sales & Marketing' },
  { value: 'tech', label: '💻 Tech' },
  { value: 'photo_video', label: '📸 Photo & Video' },
  { value: 'pets', label: '🐕 Pets' },
  { value: 'personal_development', label: '📚 Personal Development' },
  { value: 'real_estate', label: '🏠 Real Estate' },
  { value: 'beauty_fashion', label: '👠 Beauty & Fashion' },
  { value: 'travel', label: '✈️ Travel' },
  { value: 'productivity', label: '⏳ Productivity' },
  { value: 'health_fitness', label: '🍎 Health & Fitness' },
  { value: 'finance', label: '📈 Finance' },
  { value: 'arts_crafts', label: '🎨 Arts & Crafts' },
  { value: 'education', label: '📚 Education' },
  { value: 'stem', label: '🔬 STEM' },
  { value: 'humanities', label: '📖 Humanities' },
  { value: 'professional_skills', label: '💼 Professional Skills' },
  { value: 'digital_skills', label: '💻 Digital Skills' },
  { value: 'creative_arts', label: '🎨 Creative Arts' },
  { value: 'social_sciences', label: '🌍 Social Sciences' },
  { value: 'test_prep', label: '✍️ Test Preparation' },
  { value: 'vocational', label: '🔧 Vocational Training' },
  { value: 'early_education', label: '🎯 Early Education' },
] as const

const validationSchema = Yup.object().shape({
  name: Yup.string()
    .required('Name is required')
    .max(60, 'Organization name must be 60 characters or less'),
  description: Yup.string()
    .required('Short description is required')
    .max(100, 'Short description must be 100 characters or less'),
  about: Yup.string()
    .optional()
    .max(400, 'About text must be 400 characters or less'),
  label: Yup.string().required('Organization label is required'),
  explore: Yup.boolean(),
})

interface OrganizationValues {
  name: string
  description: string
  about: string
  label: string
  explore: boolean
}

const OrgEditGeneral: React.FC = () => {
  const router = useRouter()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const initialValues: OrganizationValues = {
    name: org?.name,
    description: org?.description || '',
    about: org?.about || '',
    label: org?.label || '',
    explore: org?.explore ?? false,
  }

  const updateOrg = async (values: OrganizationValues) => {
    const loadingToast = toast.loading('Updating organization...')
    try {
      await updateOrganization(org.id, values, access_token)
      await revalidateTags(['organizations'], org.slug)
      mutate(`${getAPIUrl()}orgs/slug/${org.slug}`)
      toast.success('Organization Updated', { id: loadingToast })
    } catch (err) {
      toast.error('Failed to update organization', { id: loadingToast })
    }
  }

  return (
    <div className="nice-shadow mx-0 rounded-xl bg-white sm:mx-10">
      <Formik
        enableReinitialize
        initialValues={initialValues}
        validationSchema={validationSchema}
        onSubmit={(values, { setSubmitting }) => {
          setTimeout(() => {
            setSubmitting(false)
            updateOrg(values)
          }, 400)
        }}
      >
        {({
          isSubmitting,
          values,
          handleChange,
          errors,
          touched,
          setFieldValue,
        }) => (
          <Form>
            <div className="flex flex-col gap-0">
              <div className="mx-3 my-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
                <h1 className="text-xl font-bold text-gray-800">
                  Organization Settings
                </h1>
                <h2 className="text-md text-gray-500">
                  Manage your organization's profile and settings
                </h2>
              </div>

              <div className="mx-5 my-5 mt-0 flex flex-col lg:flex-row lg:space-x-8">
                <div className="w-full space-y-6">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name">
                        Organization Name
                        <span className="text-sm text-gray-500">
                          ({60 - (values.name?.length || 0)} characters left)
                        </span>
                      </Label>
                      <Input
                        id="name"
                        name="name"
                        value={values.name}
                        onChange={handleChange}
                        placeholder="Organization Name"
                        maxLength={60}
                      />
                      {touched.name && errors.name && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="description">
                        Short Description
                        <span className="text-sm text-gray-500">
                          ({100 - (values.description?.length || 0)} characters
                          left)
                        </span>
                      </Label>
                      <Input
                        id="description"
                        name="description"
                        value={values.description}
                        onChange={handleChange}
                        placeholder="Brief description of your organization"
                        maxLength={100}
                      />
                      {touched.description && errors.description && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.description}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="label">Organization Label</Label>
                      <Select
                        value={values.label}
                        onValueChange={(value) => setFieldValue('label', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select organization label" />
                        </SelectTrigger>
                        <SelectContent>
                          {ORG_LABELS.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {touched.label && errors.label && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.label}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="about">
                        About Organization
                        <span className="text-sm text-gray-500">
                          ({400 - (values.about?.length || 0)} characters left)
                        </span>
                      </Label>
                      <Textarea
                        id="about"
                        name="about"
                        value={values.about}
                        onChange={handleChange}
                        placeholder="Detailed description of your organization"
                        className="min-h-[150px]"
                        maxLength={400}
                      />
                      {touched.about && errors.about && (
                        <p className="mt-1 text-sm text-red-500">
                          {errors.about}
                        </p>
                      )}
                    </div>

                    <div className="nice-shadow mt-6 flex items-center justify-between space-x-2 rounded-lg bg-gray-50/50 p-4">
                      <div className="flex items-center space-x-4">
                        <Link
                          href="https://www.learnhouse.app/explore"
                          target="_blank"
                          className="flex items-center space-x-2"
                        >
                          <Image
                            quality={100}
                            width={120}
                            src={learnhouseIcon}
                            alt="LearnHouse"
                            className="rounded-lg"
                          />
                          <span className="mt-1 rounded-md bg-black px-2 py-1 text-[10px] font-semibold text-white">
                            EXPLORE
                          </span>
                        </Link>
                        <div className="space-y-0.5">
                          <Label className="text-base">
                            Showcase in LearnHouse Explore
                          </Label>
                          <p className="text-sm text-gray-500">
                            Share your organization's courses and content with
                            the LearnHouse community. Enable this to help
                            learners discover your valuable educational
                            resources.
                          </p>
                        </div>
                      </div>
                      <Switch
                        name="explore"
                        checked={values.explore ?? false}
                        onCheckedChange={(checked) =>
                          setFieldValue('explore', checked)
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="mx-5 mt-0 mb-5 flex flex-row-reverse">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-black text-white hover:bg-black/90"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </Form>
        )}
      </Formik>
    </div>
  )
}

export default OrgEditGeneral
