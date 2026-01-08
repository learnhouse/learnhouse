import { apiRequest } from './api'

export async function login(email: string, password: string) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: new URLSearchParams({ username: email, password }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}

export async function logout() {
  return apiRequest('/auth/logout', { method: 'POST' })
}
