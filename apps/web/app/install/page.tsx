import InstallClient from './install'

export const metadata = {
  title: 'Install LearnHouse',
  description: 'Install Learnhouse on your server',
}

function InstallPage() {
  return (
    <div className="h-screen bg-white">
      <InstallClient />
    </div>
  )
}

export default InstallPage
