import { redirect } from 'next/navigation'

// Friendly alias for the dashboard list, which keeps its /dash/playgrounds route.
export default function DashPlaysAliasPage() {
  redirect('/dash/playgrounds')
}
