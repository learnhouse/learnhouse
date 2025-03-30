import type { Metadata } from 'next'
import React from 'react'
import HomeClient from './home'

export const metadata: Metadata = {
  title: 'Home',
}
function Home() {
  return (
    <div>
      <HomeClient />
    </div>
  )
}

export default Home
