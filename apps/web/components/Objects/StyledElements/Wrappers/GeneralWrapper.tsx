function GeneralWrapperStyled({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 py-5 tracking-tight z-50">
      {children}
    </div>
  )
}

export default GeneralWrapperStyled