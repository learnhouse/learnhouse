'use client'
import React, { useEffect, useState } from 'react'
import { Field, Form, Formik } from 'formik'
import {
  updateOrganization,
  uploadOrganizationLogo,
  uploadOrganizationThumbnail,
} from '@services/settings/org'
import { UploadCloud, Info, Check, FileWarning } from 'lucide-react'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrgLogoMediaDirectory, getOrgThumbnailMediaDirectory } from '@services/media/media'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toaster, toast } from 'react-hot-toast';

interface OrganizationValues {
  name: string
  description: string
  slug: string
  logo: string
  email: string
  thumbnail: string
}

function OrgEditGeneral() {
  const router = useRouter()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const [selectedTab, setSelectedTab] = useState<'logo' | 'thumbnail'>('logo');
  const [localLogo, setLocalLogo] = useState<string | null>(null);
  const [localThumbnail, setLocalThumbnail] = useState<string | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0]
      setLocalLogo(URL.createObjectURL(file))
      const loadingToast = toast.loading('Uploading logo...');
      try {
        await uploadOrganizationLogo(org.id, file, access_token)
        await new Promise((r) => setTimeout(r, 1500))
        toast.success('Logo Updated', { id: loadingToast });
        router.refresh()
      } catch (err) {
        toast.error('Failed to upload logo', { id: loadingToast });
      }
    }
  }

  const handleThumbnailChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      setLocalThumbnail(URL.createObjectURL(file));
      const loadingToast = toast.loading('Uploading thumbnail...');
      try {
        await uploadOrganizationThumbnail(org.id, file, access_token);
        await new Promise((r) => setTimeout(r, 1500));
        toast.success('Thumbnail Updated', { id: loadingToast });
        router.refresh()
      } catch (err) {
        toast.error('Failed to upload thumbnail', { id: loadingToast });
      }
    }
  };

  const handleImageButtonClick = (inputId: string) => (event: React.MouseEvent) => {
    event.preventDefault(); // Prevent form submission
    document.getElementById(inputId)?.click();
  };

  let orgValues: OrganizationValues = {
    name: org?.name,
    description: org?.description,
    slug: org?.slug,
    logo: org?.logo,
    email: org?.email,
    thumbnail: org?.thumbnail,
  }

  const updateOrg = async (values: OrganizationValues) => {
    const loadingToast = toast.loading('Updating organization...');
    try {
      await updateOrganization(org.id, values, access_token)
      await revalidateTags(['organizations'], org.slug)
      toast.success('Organization Updated', { id: loadingToast });
    } catch (err) {
      toast.error('Failed to update organization', { id: loadingToast });
    }
  }

  useEffect(() => {}, [org])

  return (
    <div className="sm:ml-10 sm:mr-10 ml-0 mr-0 mx-auto bg-white rounded-xl shadow-sm px-6 py-5 sm:mb-0 mb-16">
      <Toaster />
      <Formik
        enableReinitialize
        initialValues={orgValues}
        onSubmit={(values, { setSubmitting }) => {
          setTimeout(() => {
            setSubmitting(false)
            updateOrg(values)
          }, 400)
        }}
      >
        {({ isSubmitting }) => (
          <Form>
            <div className="flex flex-col lg:flex-row lg:space-x-8">
              <div className="w-full lg:w-1/2 mb-8 lg:mb-0">
                <label className="block mb-2 font-bold" htmlFor="name">
                  Name
                </label>
                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  type="text"
                  name="name"
                />

                <label className="block mb-2 font-bold" htmlFor="description">
                  Description
                </label>
                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  type="text"
                  name="description"
                />

                <label className="block mb-2 font-bold" htmlFor="slug">
                  Slug
                </label>
                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg bg-gray-200 cursor-not-allowed"
                  disabled
                  type="text"
                  name="slug"
                />

                <label className="block mb-2 font-bold" htmlFor="email">
                  Email
                </label>
                <Field
                  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  type="email"
                  name="email"
                />

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-6 py-3 text-white bg-black rounded-lg shadow-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-black"
                >
                  Submit
                </button>
              </div>

              <div className="w-full lg:w-1/2">
                <Tabs defaultValue="logo" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-6 sm:mb-10">
                    <TabsTrigger value="logo">Logo</TabsTrigger>
                    <TabsTrigger value="thumbnail">Thumbnail</TabsTrigger>
                  </TabsList>
                  <TabsContent value="logo">
                    <div className="flex flex-col space-y-3">
                      <div className="w-auto bg-gray-50 rounded-xl outline outline-1 outline-gray-200 h-[200px] shadow mx-4 sm:mx-10">
                        <div className="flex flex-col justify-center items-center mt-6 sm:mt-10">
                          <div
                            className="w-[150px] sm:w-[200px] h-[75px] sm:h-[100px] bg-contain bg-no-repeat bg-center rounded-lg nice-shadow bg-white"
                            style={{ backgroundImage: `url(${localLogo || getOrgLogoMediaDirectory(org?.org_uuid, org?.logo_image)})` }}
                          />
                        </div>
                        <div className="flex justify-center items-center">
                          <input
                            type="file"
                            id="fileInput"
                            style={{ display: 'none' }}
                            onChange={handleFileChange}
                          />
                          <button
                            type="button"
                            className="font-bold antialiased items-center text-gray text-sm rounded-md px-4 py-2 mt-4 flex"
                            onClick={handleImageButtonClick('fileInput')}
                          >
                            <UploadCloud size={16} className="mr-2" />
                            <span>Change Logo</span>
                          </button>
                        </div>
                      </div>
                      <div className="flex text-xs space-x-2 items-center text-gray-500 justify-center">
                        <Info size={13} />
                        <p>Accepts PNG, JPG</p>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="thumbnail">
                    <div className="flex flex-col space-y-3">
                      <div className="w-auto bg-gray-50 rounded-xl outline outline-1 outline-gray-200 h-[200px] shadow mx-4 sm:mx-10">
                        <div className="flex flex-col justify-center items-center mt-6 sm:mt-10">
                          <div
                            className="w-[150px] sm:w-[200px] h-[75px] sm:h-[100px] bg-contain bg-no-repeat bg-center rounded-lg nice-shadow bg-white"
                            style={{ backgroundImage: `url(${localThumbnail || getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image)})` }}
                          />
                        </div>
                        <div className="flex justify-center items-center">
                          <input
                            type="file"
                            id="thumbnailInput"
                            style={{ display: 'none' }}
                            onChange={handleThumbnailChange}
                          />
                          <button
                            type="button"
                            className="font-bold antialiased items-center text-gray text-sm rounded-md px-4 py-2 mt-4 flex"
                            onClick={handleImageButtonClick('thumbnailInput')}
                          >
                            <UploadCloud size={16} className="mr-2" />
                            <span>Change Thumbnail</span>
                          </button>
                        </div>
                      </div>
                      <div className="flex text-xs space-x-2 items-center text-gray-500 justify-center">
                        <Info size={13} />
                        <p>Accepts PNG, JPG</p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </Form>
        )}
      </Formik>
    </div>
  )
}

export default OrgEditGeneral
