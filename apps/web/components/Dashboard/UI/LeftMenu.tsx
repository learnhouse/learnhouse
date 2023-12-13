
import { Book } from 'lucide-react'
import Link from 'next/link'
import React from 'react'

function LeftMenu() {
    return (
        <div
            style={{ background: "linear-gradient(0deg, rgba(0, 0, 0, 0.20) 0%, rgba(0, 0, 0, 0.20) 100%), radial-gradient(271.56% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0.00) 100%), #2E2D2D" }}
            className='flex flex-col w-20 justifiy-center bg-black h-screen justify-center text-white'>

            <div className='flex items-center mx-auto'>
                <Link className='bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/dash/courses`} ><Book size={18}/></Link>
            </div>


        </div>
    )
}

export default LeftMenu

