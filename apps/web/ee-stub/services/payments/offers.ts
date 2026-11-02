// OSS stub: selling content requires Enterprise Edition. Every lookup answers
// the way the API does when payments are off: nothing for sale, nothing bought.
const none = { success: false, status: 404, HTTPmessage: 'Not Found', data: null }

export async function getPublicOffer(_orgId: number, _offerId: string): Promise<any> {
  return none
}

export async function getPublicOffers(_orgId: number): Promise<any> {
  return { ...none, success: true, status: 200, data: [] }
}

export async function getOffersByResource(_orgId: number, _resourceUuid: string): Promise<any> {
  return { ...none, success: true, status: 200, data: [] }
}

export async function getUserEnrollments(_orgId: number, _access_token: string): Promise<any> {
  return { ...none, success: true, status: 200, data: [] }
}
