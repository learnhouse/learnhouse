import ErrorShell, { ErrorActionRows, ErrorButton } from '@components/Objects/StyledElements/Error/ErrorShell'
import { GoBackButton, RequestedPath } from '@components/Objects/StyledElements/Error/NotFoundExtras'
import { HomeIcon } from 'lucide-react'

// Rendered per request, not prerendered. Next 16 answers an unknown Server
// Action posted to a missing path from the static 404 entry, finds a text/plain
// error where it expects an RSC payload and throws a 500 instead of a 404.
export const dynamic = 'force-dynamic'

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-[#f8f8f8] antialiased">
      {/* Dotted backdrop that fades out toward the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(#d4d4d8_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />

      <header className="relative z-10 flex items-center px-6 py-5 sm:px-10">
        <a href="/" aria-label="Home" className="opacity-80 transition-opacity hover:opacity-100">
          {/* Lazy: this page is part of every route's payload (the not-found
              boundary), and an eager <img> here made React preload the logo
              on every page, competing with the app's own scripts. */}
          <img src="/lrn-text.svg" alt="LearnHouse" width={120} height={18} loading="lazy" className="h-[18px] w-auto" />
        </a>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pb-24">
        <p
          aria-hidden
          className="select-none bg-gradient-to-b from-gray-300 via-gray-200 to-gray-200/0 bg-clip-text text-[112px] font-black leading-none tracking-tighter text-transparent sm:text-[152px]"
        >
          404
        </p>
        <div className="-mt-7 w-full sm:-mt-9">
          <ErrorShell
            flush
            kind="not_found"
            title="This page doesn't exist"
            description="The link may be broken, or the page was moved or deleted. Check the address for typos, or pick up from somewhere familiar."
            actions={
              <ErrorActionRows
                main={[
                  <ErrorButton key="home" href="/" variant="primary" label="Go home" icon={<HomeIcon size={15} />} />,
                  <GoBackButton key="back" />,
                ]}
              />
            }
          >
            <RequestedPath />
          </ErrorShell>
        </div>
      </main>
    </div>
  )
}
