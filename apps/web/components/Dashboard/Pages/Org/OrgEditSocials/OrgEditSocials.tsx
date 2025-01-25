'use client'
import React from 'react'
import { Form, Formik } from 'formik'
import { updateOrganization } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Input } from "@components/ui/input"
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import { 
  SiX, 
  SiFacebook, 
  SiInstagram, 
  SiYoutube 
} from '@icons-pack/react-simple-icons'
import { Plus, X as XIcon } from "lucide-react"
import { useRouter } from 'next/navigation'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'

interface OrganizationValues {
  socials: {
    twitter?: string
    facebook?: string
    instagram?: string
    linkedin?: string
    youtube?: string
  }
  links: {
    [key: string]: string
  }
}

export default function OrgEditSocials() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const router = useRouter()
  const initialValues: OrganizationValues = {
    socials: org?.socials || {},
    links: org?.links || {}
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
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <Formik
        enableReinitialize
        initialValues={initialValues}
        onSubmit={(values, { setSubmitting }) => {
          setTimeout(() => {
            setSubmitting(false)
            updateOrg(values)
          }, 400)
        }}
      >
        {({ isSubmitting, values, handleChange, setFieldValue }) => (
          <Form>
            <div className="flex flex-col gap-0">
              <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
                <h1 className="font-bold text-xl text-gray-800">
                  Social Links
                </h1>
                <h2 className="text-gray-500 text-md">
                  Manage your organization's social media presence
                </h2>
              </div>

              <div className="flex flex-col lg:flex-row lg:space-x-8 mt-0 mx-5 my-5">
                <div className="w-full space-y-6">
                  <div>
                    <Label className="text-lg font-semibold">Social Links</Label>
                    <div className="space-y-3 bg-gray-50/50 p-4 rounded-lg nice-shadow mt-2">
                      <div className="grid gap-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 flex items-center justify-center bg-[#1DA1F2]/10 rounded-md">
                            <SiX size={16} color="#1DA1F2"/>
                          </div>
                          <Input
                            id="socials.twitter"
                            name="socials.twitter"
                            value={values.socials.twitter || ''}
                            onChange={handleChange}
                            placeholder="Twitter profile URL"
                            className="h-9 bg-white"
                          />
                        </div>

                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 flex items-center justify-center bg-[#1877F2]/10 rounded-md">
                            <SiFacebook size={16} color="#1877F2"/>
                          </div>
                          <Input
                            id="socials.facebook"
                            name="socials.facebook"
                            value={values.socials.facebook || ''}
                            onChange={handleChange}
                            placeholder="Facebook profile URL"
                            className="h-9 bg-white"
                          />
                        </div>

                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 flex items-center justify-center bg-[#E4405F]/10 rounded-md">
                            <SiInstagram size={16} color="#E4405F"/>
                          </div>
                          <Input
                            id="socials.instagram"
                            name="socials.instagram"
                            value={values.socials.instagram || ''}
                            onChange={handleChange}
                            placeholder="Instagram profile URL"
                            className="h-9 bg-white"
                          />
                        </div>

                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 flex items-center justify-center bg-[#FF0000]/10 rounded-md">
                            <SiYoutube size={16} color="#FF0000"/>
                          </div>
                          <Input
                            id="socials.youtube"
                            name="socials.youtube"
                            value={values.socials.youtube || ''}
                            onChange={handleChange}
                            placeholder="YouTube channel URL"
                            className="h-9 bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="w-full space-y-6">
                  <div>
                    <Label className="text-lg font-semibold">Custom Links</Label>
                    <div className="space-y-3 bg-gray-50/50 p-4 rounded-lg nice-shadow mt-2">
                      {Object.entries(values.links).map(([linkKey, linkValue], index) => (
                        <div key={index} className="flex gap-3 items-center">
                          <div className="w-8 h-8 flex items-center justify-center bg-gray-200/50 rounded-md text-xs font-medium text-gray-600">
                            {index + 1}
                          </div>
                          <div className="flex-1 flex gap-2">
                            <Input
                              placeholder="Label"
                              value={linkKey}
                              className="h-9 w-1/3 bg-white"
                              onChange={(e) => {
                                const newLinks = { ...values.links };
                                delete newLinks[linkKey];
                                newLinks[e.target.value] = linkValue;
                                setFieldValue('links', newLinks);
                              }}
                            />
                            <Input
                              placeholder="URL"
                              value={linkValue}
                              className="h-9 flex-1 bg-white"
                              onChange={(e) => {
                                const newLinks = { ...values.links };
                                newLinks[linkKey] = e.target.value;
                                setFieldValue('links', newLinks);
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                const newLinks = { ...values.links };
                                delete newLinks[linkKey];
                                setFieldValue('links', newLinks);
                              }}
                            >
                              <XIcon className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      
                      {Object.keys(values.links).length < 3 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            const newLinks = { ...values.links };
                            newLinks[`Link ${Object.keys(newLinks).length + 1}`] = '';
                            setFieldValue('links', newLinks);
                          }}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Link
                        </Button>
                      )}
                      
                      <p className="text-xs text-gray-500 mt-2">
                        Add up to 3 custom links that will appear on your organization's profile
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-row-reverse mt-3 mx-5 mb-5">
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
