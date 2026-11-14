import { redirect } from 'next/navigation'

// Friendly alias: the feature is called "Plays", the route stays /playgrounds.
// Browser-relative: the proxy adds the /orgs/{slug} prefix.
export default function PlaysAliasPage() {
  redirect('/playgrounds')
}
