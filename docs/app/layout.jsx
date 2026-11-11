import { Wix_Madefor_Text } from 'next/font/google'
import '../styles.css'
import CustomNavbar from '../components/Navbar/Navbar'
import SectionMain from '../components/site/SectionMain'
import CustomFooter from '../components/Footer/Footer'
import PostHogProvider from '../components/Analytics/PostHogProvider'
import { getLatestVersions } from '../lib/releases'

export const metadata = {
  title: {
    default: 'LearnHouse Docs',
    template: '%s – LearnHouse Docs',
  },
  description:
    'Official documentation for LearnHouse, the open-source learning management system (LMS). Guides for self-hosting, course creation, AI features, API reference, and more.',
  keywords: [
    'LearnHouse',
    'open source LMS',
    'learning management system',
    'self-hosted LMS',
    'course creation',
    'LearnHouse documentation',
    'LearnHouse docs',
  ],
  metadataBase: new URL('https://docs.learnhouse.app'),
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://docs.learnhouse.app',
    siteName: 'LearnHouse Docs',
    description:
      'Official documentation for LearnHouse, the open-source learning management system (LMS). Guides for self-hosting, course creation, AI features, API reference, and more.',
    images: [{ url: 'https://docs.learnhouse.app/og', alt: 'LearnHouse Docs', width: 1200, height: 630 }],
  },
  twitter: {
    creator: '@getlearnhouse',
    site: '@getlearnhouse',
    card: 'summary_large_image',
  },
  icons: {
    icon: [
      { url: '/favicons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/favicons/apple-touch-icon.png',
  },
  manifest: '/favicons/site.webmanifest',
}

// Self-hosted and preloaded by Next: no request to Google, no render-blocking CSS.
const wix = Wix_Madefor_Text({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-wix',
})

async function latestAppVersion() {
  try {
    const { app } = await getLatestVersions()
    return app?.version ?? null
  } catch {
    return null
  }
}

export default async function RootLayout({ children }) {
  const version = await latestAppVersion()
  return (
    <html lang="en" dir="ltr" className={wix.variable} suppressHydrationWarning>
      <body>
        <PostHogProvider>
          <CustomNavbar version={version} />
          <SectionMain>{children}</SectionMain>
          <CustomFooter />
        </PostHogProvider>
      </body>
    </html>
  )
}
