import { redirect } from 'next/navigation'

export default async function NewsletterIndex(props: { params: Promise<{ orgslug: string }> }) {
  await props.params
  redirect('/dash/newsletter/overview')
}
