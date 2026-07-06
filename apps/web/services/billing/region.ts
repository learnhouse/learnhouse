// Region → display-currency resolution for billing prices. Ported from the
// platform's services/stripe/region.ts, but adapted for the .io deployment:
// instead of a Vercel-geolocation cookie, we read the country from the CDN's
// geo header (Cloudflare `cf-ipcountry` or Vercel `x-vercel-ip-country`) on the
// server. EU visitors see EUR (via Stripe `currency_options`); everyone else
// falls back to the default USD. Absent a geo header (no CDN), it's USD — a
// harmless no-op, so this is safe to ship regardless of the edge setup.

export type Region = 'eur' | 'usd'

// EU / EEA country codes that should be billed in EUR.
const EUR_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO',
])

export function regionForCountry(country: string | null | undefined): Region {
  return country && EUR_COUNTRIES.has(country.toUpperCase()) ? 'eur' : 'usd'
}

/** Resolve the region from the CDN geo header on a server request. */
export function regionFromHeaders(headers: Headers): Region {
  const country =
    headers.get('cf-ipcountry') ||
    headers.get('x-vercel-ip-country') ||
    headers.get('x-geo-country')
  return regionForCountry(country)
}

/**
 * Stripe `currency_options` code to request, or undefined for the plan's
 * default (USD) — passing undefined avoids the extra `currency_options` expand.
 */
export function currencyForRegion(region: Region): string | undefined {
  return region === 'eur' ? 'eur' : undefined
}

/** Client-side: read a previously-set `LH_region` cookie (default usd). */
export function getRegionFromCookie(): Region {
  if (typeof document === 'undefined') return 'usd'
  const match = document.cookie.match(/(?:^|;\s*)LH_region=([^;]*)/)
  return match?.[1] === 'eur' ? 'eur' : 'usd'
}
