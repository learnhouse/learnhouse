import '@styles/globals.css'
import { Menu } from '@components/Objects/Menu/Menu'
import SessionProvider from '@components/Contexts/SessionContext'

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: any
}) {
  return (
    <>
      <SessionProvider>
        <Menu orgslug={params?.orgslug}></Menu>
        {children}
      </SessionProvider>
    </>
  )
}
