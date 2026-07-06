import { redirect } from 'next/navigation'

const AccountPage = async () => {
  // Browser-relative path (no org slug / no /orgs prefix): the proxy adds the
  // single /orgs/{slug} prefix. A slug-prefixed redirect would be double-prefixed
  // by the proxy → 404.
  redirect('/account/general')
}

export default AccountPage
