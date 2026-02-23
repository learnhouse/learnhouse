import { getAPIUrl } from '@services/config/config'
import {
  errorHandling,
  RequestBodyWithAuthHeader,
  RequestBodyFormWithAuthHeader,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function updateOrganization(
  org_id: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}orgs/` + org_id,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function uploadOrganizationLogo(
  org_id: string,
  logo_file: any,
  access_token: string
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('logo_file', logo_file)
  const result: any = await fetch(
    `${getAPIUrl()}orgs/` + org_id + '/logo',
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function uploadOrganizationThumbnail(
  org_id: string,
  thumbnail_file: any,
  access_token: string
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('thumbnail_file', thumbnail_file)
  const result: any = await fetch(
    `${getAPIUrl()}orgs/` + org_id + '/thumbnail',
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export const uploadOrganizationPreview = async (orgId: string, file: File, access_token: string) => {
  const formData = new FormData();
  formData.append('preview_file', file);

  const result: any = await fetch(
    `${getAPIUrl()}orgs/` + orgId + '/preview',
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
};

export async function updateOrgCommunitiesConfig(
  org_id: string,
  communities_enabled: boolean,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}orgs/${org_id}/config/communities?communities_enabled=${communities_enabled}`,
    RequestBodyWithAuthHeader('PUT', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateOrgColorConfig(
  org_id: string,
  color: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}orgs/${org_id}/config/color?color=${encodeURIComponent(color)}`,
    RequestBodyWithAuthHeader('PUT', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateOrgFooterTextConfig(
  org_id: string,
  footer_text: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}orgs/${org_id}/config/footer_text?footer_text=${encodeURIComponent(footer_text)}`,
    RequestBodyWithAuthHeader('PUT', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export interface AuthBrandingConfig {
  welcome_message: string
  background_type: 'gradient' | 'custom' | 'unsplash'
  background_image: string
  text_color: 'light' | 'dark'
}

export async function updateOrgAuthBrandingConfig(
  org_id: string,
  auth_branding: AuthBrandingConfig,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}orgs/${org_id}/config/auth_branding`,
    RequestBodyWithAuthHeader('PUT', auth_branding, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export interface SeoOrgConfig {
  default_meta_title_suffix: string
  default_meta_description: string
  default_og_image: string
  google_site_verification: string
  twitter_handle: string
  noindex_communities: boolean
  noindex_docs: boolean
}

export async function updateOrgSeoConfig(
  org_id: string,
  seo_config: SeoOrgConfig,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}orgs/${org_id}/config/seo`,
    RequestBodyWithAuthHeader('PUT', seo_config, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function uploadOrganizationOgImage(
  org_id: string,
  og_image_file: File,
  access_token: string
) {
  const formData = new FormData()
  formData.append('og_image_file', og_image_file)
  const result: any = await fetch(
    `${getAPIUrl()}orgs/${org_id}/og_image`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function uploadOrgAuthBackground(
  org_id: string,
  background_file: File,
  access_token: string
) {
  const formData = new FormData()
  formData.append('background_file', background_file)
  const result: any = await fetch(
    `${getAPIUrl()}orgs/${org_id}/auth_background`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function uploadOrganizationFavicon(
  org_id: string,
  favicon_file: File,
  access_token: string
) {
  const formData = new FormData()
  formData.append('favicon_file', favicon_file)
  const result: any = await fetch(
    `${getAPIUrl()}orgs/${org_id}/favicon`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}
