import { Metadata } from 'next'
import HomeschoolersPage from './HomeschoolersPage'

export const metadata: Metadata = {
  title: 'AI-Powered Homeschool Curriculum Builder — LearnHouse',
  description:
    'Build a complete AI-powered curriculum for your child. One price for your whole family. No per-student fees. Unlimited subjects, unlimited kids.',
  openGraph: {
    title: 'Build a Full AI-Powered Curriculum for Your Child',
    description:
      'No per-student fees. Unlimited subjects. Start free — no credit card required.',
    type: 'website',
    url: 'https://learnhouse.app/for/homeschoolers',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Build a Full AI-Powered Curriculum for Your Child',
    description: 'No per-student fees. Unlimited students. Start free.',
  },
}

export default function HomeschoolersRoute() {
  return <HomeschoolersPage />
}
