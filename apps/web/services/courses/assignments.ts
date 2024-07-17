import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export async function createAssignment(body: any, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateAssignment(
  body: any,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getAssignmentFromActivityUUID(
  activityUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/activity/${activityUUID}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

// Delete an assignment
export async function deleteAssignment(
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteAssignmentUsingActivityUUID(
  activityUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/activity/${activityUUID}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

// tasks

export async function createAssignmentTask(
  body: any,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getAssignmentTask(
  assignmentTaskUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/task/${assignmentTaskUUID}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateAssignmentTask(
  body: any,
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteAssignmentTask(
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateReferenceFile(
  file: any,
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {

   // Send file thumbnail as form data
   const formData = new FormData()
 
   if (file) {
     formData.append('reference_file', file)
   }
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/ref_file`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}
