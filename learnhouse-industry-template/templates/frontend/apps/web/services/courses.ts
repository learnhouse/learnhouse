import { apiRequest } from './api'

export async function listCourses(orgslug: string, page = 1, limit = 10) {
  return apiRequest(`/courses/${orgslug}/page/${page}/limit/${limit}`)
}

export async function getCourse(orgslug: string, courseuuid: string) {
  return apiRequest(`/courses/${orgslug}/${courseuuid}`)
}
