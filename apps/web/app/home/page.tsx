import React from 'react'
import HomeClient from './home'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Acyberschool Learning',
  description: 'Learning that moves into work from day 1.',
}

export default function Home() {
  return <HomeClient />
}
