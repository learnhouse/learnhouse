import { getAPIUrl } from '../config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function deleteCollection(
  collection_uuid: any,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}collections/${collection_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

// Create a new collection
export async function createCollection(collection: any, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}collections/`,
    RequestBodyWithAuthHeader('POST', collection, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCollectionById(
  collection_uuid: any,
  access_token: string,
  next: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}collections/collection_${collection_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getOrgCollections(
  org_id: string,
  access_token: string,
  next: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}collections/org/${org_id}/page/1/limit/10`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}
