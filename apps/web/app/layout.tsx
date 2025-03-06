
import ClientLayout from './client-layout';
import { isDevEnv } from './auth/options'
import Script from 'next/script'
import {NextIntlClientProvider} from 'next-intl';
import {getLocale, getMessages} from 'next-intl/server';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale();
  const messages =  await getMessages();


  return (
    <html className="" lang={locale}>
      <head />
      <body>
        {isDevEnv ? '' : <Script data-website-id="a1af6d7a-9286-4a1f-8385-ddad2a29fcbb" src="/umami/script.js" />}
        
        <NextIntlClientProvider messages={messages}>
          <ClientLayout>
            {children}
          </ClientLayout>
          </NextIntlClientProvider>
        
      </body>
    </html>
  )
}
