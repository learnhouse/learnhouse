import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import learnhouseIcon from 'public/black_logo.png'

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-200 to-slate-300">
      <div className="nx-flex nx-items-center hover:nx-opacity-75 ltr:nx-mr-auto rtl:nx-ml-auto pb-20">
        <Image
          quality={100}
          width={270}
          height={100}
          src={learnhouseIcon}
          alt="logo"
        />
      </div>
      <div className="space-y-6 text-center">
        <h1 className="text-8xl leading-7 font-bold text-black drop-shadow-md">
          404!
        </h1>
        <p className="pt-8 text-lg leading-normal font-medium tracking-tight text-black">
          We are very sorry for the inconvenience. It looks like you're trying
          to
          <div>access a page that has been deleted or never existed before</div>
        </p>
      </div>
      <div className="flex flex-col items-center pt-8">
        <button className="text-md flex h-[50px] w-fit items-center space-x-2 rounded-lg bg-black px-6 py-2 text-xl font-bold text-white shadow-md">
          <Link className="flex gap-2" href="/">
            Go back to homepage
            <ArrowRight className="ml-1 tracking-tight transition-transform duration-150 ease-in-out group-hover:translate-x-0.5" />
          </Link>
        </button>
      </div>
    </div>
  )
}
