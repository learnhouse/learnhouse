import { apiRequest } from './api'

export async function customAIChat(message: string, context?: string) {
  return apiRequest('/custom-ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message, context }),
  })
}
