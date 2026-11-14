// Links from the docs to LearnHouse Cloud. Every one carries UTM tags (the app's
// analytics reads them on arrival) so signups can be traced to the page and
// the spot that sent them.
export const SIGNUP_URL = 'https://learnhouse.io/signup'
export const PRICING_URL = 'https://www.learnhouse.app/pricing'
export const HOME_URL = 'https://www.learnhouse.app'

/** `placement` names the spot (navbar, toc_card, plan_callout…); `route` the docs page. */
export function ctaUrl(destination, { placement, route, term } = {}) {
  const url = new URL(destination)
  url.searchParams.set('utm_source', 'docs')
  url.searchParams.set('utm_medium', 'referral')
  if (placement) url.searchParams.set('utm_campaign', placement)
  if (route) url.searchParams.set('utm_content', route === '/' ? 'home' : route.replace(/^\//, ''))
  if (term) url.searchParams.set('utm_term', term)
  return url.toString()
}
