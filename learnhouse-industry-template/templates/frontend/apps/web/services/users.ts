import { apiRequest } from './api'

export async function getProfile() {
  return apiRequest('/users/profile')
}
