function GeneralWrapperStyled({ children }: { children: React.ReactNode }) {
  return (
    <div className="z-50 mx-auto max-w-(--breakpoint-2xl) px-4 py-5 tracking-tight sm:px-6 lg:px-8">
      {children}
    </div>
  )
}

export default GeneralWrapperStyled
