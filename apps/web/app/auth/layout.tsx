import { OrgProvider } from '@components/Contexts/OrgContext'
import OrgNotFound from '@components/Objects/StyledElements/Error/OrgNotFound'
import { getOrgSlug } from '@services/org/orgResolution'

interface AuthLayoutProps {
  children: React.ReactNode
}

export default async function AuthLayout({ children }: AuthLayoutProps) {
  // Resolve org slug from subdomain or cookie
  // Token-based resolution is handled by individual pages that need it
  const orgslug = await getOrgSlug()

  if (!orgslug) {
    return <OrgNotFound />
  }

  return <OrgProvider orgslug={orgslug}>{children}</OrgProvider>
}
