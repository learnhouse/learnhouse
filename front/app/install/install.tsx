'use client'
import React, { use, useEffect } from 'react'
import { INSTALL_STEPS } from './steps/steps'
import GeneralWrapperStyled from '@components/StyledElements/Wrappers/GeneralWrapper'
import { useRouter, useSearchParams } from 'next/navigation'




function InstallClient() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const step: any = parseInt(searchParams.get('step') || '0');
    const [stepNumber, setStepNumber] = React.useState(step)
    const [stepsState, setStepsState] = React.useState(INSTALL_STEPS)

    function handleStepChange(stepNumber: number) {
        setStepNumber(stepNumber)
        router.push(`/install?step=${stepNumber}`)
    }

    useEffect(() => {
        setStepNumber(step)
    }, [step])

    return (
        <GeneralWrapperStyled>
            <div className='flex justify-center '>
                <div className='grow'>
                    <LearnHouseLogo />
                </div>
                <div className="steps flex space-x-2 justify-center text-sm p-3 bg-slate-50 rounded-full w-fit m-auto px-10">
                    <div className="flex space-x-8">
                        {stepsState.map((step, index) => (
                            <div
                                key={index}
                                className={`flex items-center cursor-pointer space-x-2`}
                                onClick={() => handleStepChange(index)}
                            >
                                <div className={`flex w-7 h-7 rounded-full text-slate-700 bg-slate-200 justify-center items-center m-auto align-middle hover:bg-slate-300 transition-all ${index === stepNumber ? 'bg-slate-300' : ''}`}>
                                    {index}
                                </div>
                                <div>{step.name}</div>

                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex pt-8 flex-col" >
                <h1 className='font-bold text-3xl'>{stepsState[stepNumber].name}</h1>
                <div className="pt-8">
                    {stepsState[stepNumber].component}
                </div>
            </div>
        </GeneralWrapperStyled>
    )
}

const LearnHouseLogo = () => {
    return (
        <svg width="133" height="80" viewBox="0 0 433 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="80" height="80" rx="24" fill="black" />
            <rect width="80" height="80" rx="24" fill="url(#paint0_angular_1555_220)" />
            <rect x="0.5" y="0.5" width="79" height="79" rx="23.5" stroke="white" strokeOpacity="0.12" />
            <path d="M37.546 55.926V35.04L33.534 30.497L37.546 29.258V27.016L33.534 22.473L44.626 19.11V55.926L48.992 61H33.18L37.546 55.926Z" fill="white" />
            <path d="M113.98 54.98V30.2L109.22 24.81L113.98 23.34V20.68L109.22 15.29L122.38 11.3V54.98L127.56 61H108.8L113.98 54.98ZM157.704 41.19V41.26H135.234C136.004 50.29 140.834 54.07 146.294 54.07C151.054 54.07 155.254 51.69 156.304 48.75L157.354 49.17C154.834 55.54 149.864 61.98 141.534 61.98C132.364 61.98 127.184 53.79 127.184 45.39C127.184 36.36 132.784 26 144.194 26C152.524 26 157.634 31.6 157.704 41.05L157.774 41.19H157.704ZM148.674 39.16V38.53C148.674 31.04 145.664 28.1 142.584 28.1C137.264 28.1 135.094 34.47 135.094 38.67V39.16H148.674ZM178.717 61V55.12C176.057 57.71 171.157 61.7 166.537 61.7C161.707 61.7 158.137 59.32 158.137 53.65C158.137 46.51 166.607 42.87 178.717 38.6C178.717 33 178.577 28.66 172.837 28.66C167.237 28.66 163.877 32.58 160.307 37.9H159.817V26.7H188.657L187.117 32.72V56.45H187.187L192.367 61H178.717ZM178.717 53.23V40.56C167.727 44.97 167.377 47.98 167.377 51.34C167.377 54.7 169.687 56.17 172.627 56.17C174.797 56.17 176.967 55.05 178.717 53.23ZM221.429 39.09H220.869C217.789 31.74 213.659 29.29 210.439 29.29C205.609 29.29 205.609 32.79 205.609 39.93V54.98L212.119 61H192.029L197.209 54.98V32.09L192.449 26.7H221.429V39.09ZM261.467 61H242.707L247.747 54.98V39.44C247.747 34.05 246.977 30.62 241.587 30.62C238.997 30.62 236.337 31.74 234.097 34.75V54.98L239.137 61H220.377L225.697 54.98V36.08L220.937 30.69L234.097 26V32.37C236.897 28.03 241.447 25.86 245.647 25.86C252.787 25.86 256.147 30.48 256.147 37.06V54.98L261.467 61ZM274.343 11.3V32.23C277.143 27.89 281.693 25.72 285.893 25.72C293.033 25.72 296.393 30.34 296.393 36.92V54.98H296.463L301.643 61H282.883L287.993 55.05V39.3C287.993 33.91 287.223 30.48 281.833 30.48C279.243 30.48 276.583 31.6 274.343 34.61V54.98L279.523 61H260.763L265.943 54.98V21.38L261.183 15.99L274.343 11.3ZM335.945 42.31C335.945 51.34 329.855 61.84 316.835 61.84C306.895 61.84 301.645 53.79 301.645 45.39C301.645 36.36 307.735 25.86 320.755 25.86C330.695 25.86 335.945 33.91 335.945 42.31ZM316.975 28.52C311.165 28.52 310.535 34.82 310.535 39.02C310.535 49.94 314.525 59.18 320.685 59.18C325.865 59.18 327.195 52.32 327.195 48.68C327.195 37.76 323.135 28.52 316.975 28.52ZM349.01 26.63V48.12C349.01 53.51 349.78 56.94 355.17 56.94C357.55 56.94 360 55.75 361.82 53.65V32.72L356.64 26.63H370.22V55.26L374.98 61L361.82 61.42V55.82C359.3 59.32 356.08 61.7 351.11 61.7C343.97 61.7 340.61 57.08 340.61 50.5V32.72L335.36 26.63H349.01ZM374.617 47.77H375.177C376.997 53.79 382.527 59.04 388.267 59.04C391.137 59.04 393.517 57.64 393.517 54.49C393.517 46.23 374.967 50.29 374.967 36.43C374.967 31.25 379.517 26.7 386.657 26.7H394.357L396.947 25.23V36.85L396.527 36.78C394.007 32.23 389.807 28.87 385.327 28.94C382.387 29.01 380.707 30.83 380.707 33.56C380.707 40.77 399.887 37.62 399.887 50.43C399.887 58.55 391.697 61.7 386.167 61.7C382.667 61.7 377.907 61.21 375.247 60.09L374.617 47.77ZM430.416 41.19V41.26H407.946C408.716 50.29 413.546 54.07 419.006 54.07C423.766 54.07 427.966 51.69 429.016 48.75L430.066 49.17C427.546 55.54 422.576 61.98 414.246 61.98C405.076 61.98 399.896 53.79 399.896 45.39C399.896 36.36 405.496 26 416.906 26C425.236 26 430.346 31.6 430.416 41.05L430.486 41.19H430.416ZM421.386 39.16V38.53C421.386 31.04 418.376 28.1 415.296 28.1C409.976 28.1 407.806 34.47 407.806 38.67V39.16H421.386Z" fill="#121212" />
            <defs>
                <radialGradient id="paint0_angular_1555_220" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(40 40) rotate(90) scale(40)">
                    <stop stopColor="#FBFBFB" stopOpacity="0.15" />
                    <stop offset="0.442708" stopOpacity="0.1" />
                </radialGradient>
            </defs>
        </svg>
    )

}

export default InstallClient