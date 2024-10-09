import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
 
export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center 
   bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-400 to-zinc-700">
      <div className="space-y-6 text-center">
      <h1 className="text-8xl leading-7 font-bold text-white drop-shadow-md">
        404!
      </h1>
      <p className='text-lg pt-8 text-zinc-100'>
       We are very sorry for the inconvinience. It looks like you're trying to 
      <div>access a page that has been deleted or never existed before</div> 
      </p>
      </div>
      <div className='pt-8 flex flex-col items-center'>
      <button className="flex w-fit h-[50px] text-xl space-x-2 bg-black px-6 py-2 text-md rounded-lg font-bold text-white items-center shadow-md">
        <Link className='flex gap-2' href="/" >
        Go back to homepage
        <ArrowRight className='tracking-tight group-hover:translate-x-0.5 
        transition-transform duration-150 ease-in-out ml-1' />
        </Link>
      </button>
      </div>   
    </div>
  )
}

