import React from 'react'
import HomeClient from './home'
import type { Metadata } from 'next'
 
export const metadata: Metadata = {
  title: 'Home',
}
function Home() {
  return (
    <div>
      <HomeClient/>
    </div>
  )
}

export default Home