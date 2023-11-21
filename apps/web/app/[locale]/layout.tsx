
import { i18n } from '../../i18n/i18n'
import "../../styles/globals.css";
import StyledComponentsRegistry from "../../components/Utils/libs/styled-registry";

// i18n locales
export async function generateStaticParams() {
  return i18n.locales.map((locale) => ({ lang: locale }))
}

export default function RootLayout({ children, params }: {
  children: React.ReactNode,
  params: { lang: string }
}) {
  return (
    <html className="" lang={params.lang}>
      <head />
      <body>
        <StyledComponentsRegistry>
          {children}
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
