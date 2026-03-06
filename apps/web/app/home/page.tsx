import React from 'react'
import HomeClient from './home'
import type { Metadata } from 'next'
 
export const metadata: Metadata = {
  title: 'Home',
}
function Home() {
  return (
    <div>
      <h1>Insight1 Education LMS</h1>
      <HomeClient/>
    </div>
  )
}

export default Home