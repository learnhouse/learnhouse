import type { ComponentPropsWithoutRef, MouseEventHandler } from 'react'

interface NewCourseButtonProps extends ComponentPropsWithoutRef<'button'> {
  onClick?: MouseEventHandler<HTMLButtonElement>
}

function NewCourseButton(props: NewCourseButtonProps) {
  const { onClick, ...restProps } = props
  return (
    <button
      onClick={onClick}
      className="font my-auto flex items-center space-x-2 rounded-lg bg-black p-2 px-5 text-xs font-bold text-white antialiased ring-offset-purple-800 drop-shadow-lg transition-all duration-100 ease-linear hover:scale-105"
      {...restProps}
    >
      <div>New Course </div>
      <div className="text-md rounded-full bg-neutral-800 px-1">+</div>
    </button>
  )
}

export default NewCourseButton
