'use client'
import React, { useRef, useState } from 'react'
import { Form, Formik } from 'formik'
import {
  updateOrgSeoConfig,
  uploadOrganizationOgImage,
  SeoOrgConfig,
} from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'
import { mutate } from 'swr'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { getOrgOgImageMediaDirectory } from '@services/media/media'
import { Copy, ExternalLink, Upload, X } from 'lucide-react'
import { getCanonicalUrl } from '@/lib/seo/utils'

const OrgEditSEO: React.FC = () => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const ogImageInputRef = useRef<HTMLInputElement>(null)
  const [ogImageFile, setOgImageFile] = useState<File | null>(null)
  const [ogImagePreview, setOgImagePreview] = useState<string | null>(null)

  const seoConfig = org?.config?.config?.seo || {}

  const initialValues: SeoOrgConfig = {
    default_meta_title_suffix: seoConfig.default_meta_title_suffix || '',
    default_meta_description: seoConfig.default_meta_description || '',
    default_og_image: seoConfig.default_og_image || '',
    google_site_verification: seoConfig.google_site_verification || '',
    twitter_handle: seoConfig.twitter_handle || '',
    noindex_communities: seoConfig.noindex_communities || false,
  }

  const sitemapUrl = getCanonicalUrl(org?.slug, '/sitemap.xml')
  const robotsUrl = getCanonicalUrl(org?.slug, '/robots.txt')

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  const handleOgImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setOgImageFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setOgImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const clearOgImage = () => {
    setOgImageFile(null)
    setOgImagePreview(null)
    if (ogImageInputRef.current) {
      ogImageInputRef.current.value = ''
    }
  }

  const saveSeoConfig = async (values: SeoOrgConfig) => {
    const loadingToast = toast.loading('Saving SEO settings...')
    try {
      // Upload OG image if a new one was selected
      if (ogImageFile) {
        const uploadResult = await uploadOrganizationOgImage(
          org.id,
          ogImageFile,
          access_token
        )
        values.default_og_image = uploadResult.filename
      }

      await updateOrgSeoConfig(org.id, values, access_token)
      await revalidateTags(['organizations'], org.slug)
      mutate(`${getAPIUrl()}orgs/slug/${org.slug}`)
      setOgImageFile(null)
      toast.success('SEO settings saved successfully', { id: loadingToast })
    } catch (err) {
      toast.error('Failed to save SEO settings', { id: loadingToast })
    }
  }

  const existingOgImageUrl =
    seoConfig.default_og_image
      ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
      : null

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <Formik
        enableReinitialize
        initialValues={initialValues}
        onSubmit={(values, { setSubmitting }) => {
          setTimeout(() => {
            setSubmitting(false)
            saveSeoConfig(values)
          }, 400)
        }}
      >
        {({ isSubmitting, values, handleChange, setFieldValue }) => (
          <Form>
            <div className="flex flex-col gap-0">
              {/* Quick Links */}
              <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
                <h1 className="font-bold text-xl text-gray-800">Quick Links</h1>
                <h2 className="text-gray-500 text-md">
                  Important SEO URLs for your organization
                </h2>
              </div>
              <div className="mx-5 my-3 space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-700 shrink-0">Sitemap:</span>
                    <a
                      href={sitemapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline truncate"
                    >
                      {sitemapUrl}
                    </a>
                  </div>
                  <div className="flex items-center space-x-1 shrink-0 ml-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(sitemapUrl)}
                    >
                      <Copy size={14} />
                    </Button>
                    <a href={sitemapUrl} target="_blank" rel="noopener noreferrer">
                      <Button type="button" variant="ghost" size="sm">
                        <ExternalLink size={14} />
                      </Button>
                    </a>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-700 shrink-0">Robots.txt:</span>
                    <a
                      href={robotsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline truncate"
                    >
                      {robotsUrl}
                    </a>
                  </div>
                  <div className="flex items-center space-x-1 shrink-0 ml-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(robotsUrl)}
                    >
                      <Copy size={14} />
                    </Button>
                    <a href={robotsUrl} target="_blank" rel="noopener noreferrer">
                      <Button type="button" variant="ghost" size="sm">
                        <ExternalLink size={14} />
                      </Button>
                    </a>
                  </div>
                </div>
              </div>

              {/* Default Meta Tags */}
              <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mt-4 rounded-md">
                <h1 className="font-bold text-xl text-gray-800">Default Meta Tags</h1>
                <h2 className="text-gray-500 text-md">
                  Set default metadata for all pages
                </h2>
              </div>
              <div className="mx-5 my-5 space-y-4">
                <div>
                  <Label htmlFor="default_meta_title_suffix">
                    Title Suffix
                    <span className="text-gray-500 text-sm ml-2">
                      ({30 - (values.default_meta_title_suffix?.length || 0)} characters left)
                    </span>
                  </Label>
                  <Input
                    id="default_meta_title_suffix"
                    name="default_meta_title_suffix"
                    value={values.default_meta_title_suffix}
                    onChange={handleChange}
                    placeholder=" | My Academy"
                    maxLength={30}
                  />
                  <p className="text-gray-500 text-sm mt-1">
                    Appended to all page titles, e.g. &quot; | My Academy&quot;
                  </p>
                </div>
                <div>
                  <Label htmlFor="default_meta_description">
                    Default Description
                    <span className="text-gray-500 text-sm ml-2">
                      ({160 - (values.default_meta_description?.length || 0)} characters left)
                    </span>
                  </Label>
                  <Textarea
                    id="default_meta_description"
                    name="default_meta_description"
                    value={values.default_meta_description}
                    onChange={handleChange}
                    placeholder="A brief description of your organization for search engines"
                    maxLength={160}
                    className="min-h-[80px]"
                  />
                  <p className="text-gray-500 text-sm mt-1">
                    Fallback description when a page has no specific one
                  </p>
                </div>
              </div>

              {/* Social & Open Graph */}
              <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mt-4 rounded-md">
                <h1 className="font-bold text-xl text-gray-800">Social & Open Graph</h1>
                <h2 className="text-gray-500 text-md">
                  Control how your pages appear when shared on social media
                </h2>
              </div>
              <div className="mx-5 my-5 space-y-4">
                <div>
                  <Label>Default OG Image</Label>
                  <p className="text-gray-500 text-sm mb-2">
                    Default sharing image for social media (1200x630 recommended)
                  </p>
                  <div className="flex items-start space-x-4">
                    {(ogImagePreview || existingOgImageUrl) && (
                      <div className="relative">
                        <img
                          src={ogImagePreview || existingOgImageUrl || ''}
                          alt="OG Image Preview"
                          className="w-48 h-24 object-cover rounded-lg border"
                        />
                        {ogImagePreview && (
                          <button
                            type="button"
                            onClick={clearOgImage}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    )}
                    <div>
                      <input
                        ref={ogImageInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleOgImageChange}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => ogImageInputRef.current?.click()}
                      >
                        <Upload size={14} className="mr-2" />
                        {existingOgImageUrl || ogImagePreview ? 'Change Image' : 'Upload Image'}
                      </Button>
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor="twitter_handle">Twitter Handle</Label>
                  <Input
                    id="twitter_handle"
                    name="twitter_handle"
                    value={values.twitter_handle}
                    onChange={handleChange}
                    placeholder="@yourhandle"
                  />
                  <p className="text-gray-500 text-sm mt-1">
                    Shown on Twitter cards as the site account
                  </p>
                </div>
              </div>

              {/* Search Engine Verification */}
              <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mt-4 rounded-md">
                <h1 className="font-bold text-xl text-gray-800">Search Engine Verification</h1>
                <h2 className="text-gray-500 text-md">
                  Verify ownership with search engines
                </h2>
              </div>
              <div className="mx-5 my-5 space-y-4">
                <div>
                  <Label htmlFor="google_site_verification">Google Search Console</Label>
                  <Input
                    id="google_site_verification"
                    name="google_site_verification"
                    value={values.google_site_verification}
                    onChange={handleChange}
                    placeholder="Google verification code"
                  />
                  <p className="text-gray-500 text-sm mt-1">
                    Verification code from Google Search Console
                  </p>
                </div>
              </div>

              {/* Indexing Controls */}
              <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mt-4 rounded-md">
                <h1 className="font-bold text-xl text-gray-800">Indexing Controls</h1>
                <h2 className="text-gray-500 text-md">
                  Control which pages search engines can index
                </h2>
              </div>
              <div className="mx-5 my-5 space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label className="text-base">Hide Communities</Label>
                    <p className="text-sm text-gray-500">
                      Hide community pages from search engines
                    </p>
                  </div>
                  <Switch
                    checked={values.noindex_communities}
                    onCheckedChange={(checked) =>
                      setFieldValue('noindex_communities', checked)
                    }
                  />
                </div>
              </div>

              {/* Save Button */}
              <div className="flex flex-row-reverse mt-0 mx-5 mb-5">
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

export default OrgEditSEO
