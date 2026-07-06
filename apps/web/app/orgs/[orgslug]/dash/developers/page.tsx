import { redirect } from 'next/navigation'

// Bare /dash/developers → the first section. Browser-relative path only (the proxy
// adds the /orgs/{slug} prefix); a slug-prefixed path would be double-prefixed.
export default function DevelopersIndex() {
  redirect('/dash/developers/api')
}
