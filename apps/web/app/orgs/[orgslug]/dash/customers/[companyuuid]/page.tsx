import { redirect } from 'next/navigation'

// "Customers" is now "Companies"; old links and bookmarks land on the new page.
export default async function CustomerRedirect({ params }: { params: Promise<{ companyuuid: string }> }) {
  const { companyuuid } = await params
  redirect(`/dash/companies/${encodeURIComponent(companyuuid)}`)
}
