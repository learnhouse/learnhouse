import React from 'react'
import logo from '@images/learnhouse_icon.png'
import Image from 'next/image'

function PlaygroundPage() {
    return (
        <div>
            <div className='w-[1200px] h-[630px] bg-white flex'>
                <div className='mx-auto pt-[60px]'>
                    <div className='background-image w-[1100px] h-[400px] rounded-2xl bg-black shadow-2xl bg-cover' style={{ backgroundImage: "url('https://images.unsplash.com/photo-1696758011732-8ea3baae2791?')" }}>
                    </div>
                    <div className='flex pt-5'>
                        <div className='flex grow flex-col -space-y-5 tracking-tighter'>
                            <div className='text-neutral-600 text-[30px] font-bold'>Course</div>
                            <div className='text-neutral-900 text-[60px] font-bold'>Course title</div>
                        </div>
                        <div className='flex flex-col items-center justify-center'>
                            <Image className='flex' width={60} src={logo} alt="" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default PlaygroundPage