function GeneralWrapperStyled({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-screen-2xl mx-auto px-16 py-5 tracking-tight z-50">
      {children}
    </div>
  )
}

export default GeneralWrapperStyled
