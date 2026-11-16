import { redirect } from 'next/navigation'

// "Customers" is now "Companies"; old links and bookmarks land on the new page.
export default async function CustomersRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value)
  }
  const qs = params.toString()
  redirect(`/dash/companies${qs ? `?${qs}` : ''}`)
}
