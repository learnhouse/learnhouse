import React from 'react'
import InstallClient from './install'

export const metadata = {
  title: 'Install LearnHouse',
  description: 'Install Learnhouse on your server',
}

function InstallPage() {
  return (
    <div className="bg-white h-screen">
      <InstallClient />
    </div>
  )
}

export default InstallPage
