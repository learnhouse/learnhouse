export const CURATED_FONTS = [
  'Albert Sans',
  'Barlow',
  'Cabin',
  'DM Sans',
  'Exo 2',
  'Figtree',
  'Fira Sans',
  'IBM Plex Sans',
  'Instrument Sans',
  'Inter',
  'Josefin Sans',
  'Karla',
  'Lato',
  'Lexend',
  'Libre Franklin',
  'Manrope',
  'Montserrat',
  'Mulish',
  'Noto Sans',
  'Nunito',
  'Onest',
  'Open Sans',
  'Outfit',
  'Overpass',
  'Plus Jakarta Sans',
  'Poppins',
  'PT Sans',
  'Quicksand',
  'Raleway',
  'Red Hat Display',
  'Roboto',
  'Rubik',
  'Source Sans 3',
  'Sora',
  'Space Grotesk',
  'Titillium Web',
  'Urbanist',
  'Wix Madefor Text',
  'Work Sans',
]

export const DEFAULT_FONT = 'Wix Madefor Text'

export function getGoogleFontUrl(fontFamily: string): string {
  const encoded = fontFamily.replace(/ /g, '+')
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700&display=swap`
}

export function getGoogleFontPreviewUrl(fontFamily: string): string {
  const encoded = fontFamily.replace(/ /g, '+')
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;700&display=swap`
}
