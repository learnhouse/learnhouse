'use client'

interface PoweredByBadgeProps {
  href: string
  /** Optional override for the badge icon URL. Defaults to a remote LearnHouse icon. */
  iconUrl?: string
}

const DEFAULT_ICON_URL = 'https://learnhouse.app/lrn.svg'

export function PoweredByBadge({ href, iconUrl }: PoweredByBadgeProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Powered by LearnHouse"
        className="bg-white/80 backdrop-blur-lg rounded-2xl p-2 light-shadow block cursor-pointer"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconUrl ?? DEFAULT_ICON_URL}
          alt="LearnHouse"
          width={20}
          height={20}
        />
      </a>
    </div>
  )
}
