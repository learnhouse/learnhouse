import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Skeleton } from '@/design'

// Shaped like the profile: header card, tab row, main + side columns.
export default function Loading() {
  return (
    <GeneralWrapperStyled>
      <div className="max-w-6xl mx-auto pt-1 sm:pt-3 pb-16 flex flex-col gap-5" aria-busy="true">
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
          <div className="h-24 sm:h-36 bg-neutral-50" />
          <div className="px-5 sm:px-8 pb-6">
            <div className="-mt-12 sm:-mt-16 w-24 h-24 sm:w-32 sm:h-32 rounded-full ring-4 ring-white bg-neutral-100 animate-pulse" />
            <Skeleton className="mt-4 h-7 w-56" />
            <Skeleton className="mt-2 h-4 w-28" />
            <Skeleton className="mt-3 h-4 w-72 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-10 w-72 max-w-full !rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-5">
          <div className="bg-white rounded-2xl nice-shadow p-5 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
          <div className="bg-white rounded-2xl nice-shadow p-5 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    </GeneralWrapperStyled>
  )
}
