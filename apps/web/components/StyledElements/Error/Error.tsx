import { XCircle } from 'lucide-react'
import React from 'react'
function ErrorUI() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="mx-auto bg-red-100 w-[800px] p-3 rounded-xl m-5 ">
        <div className="flex flex-row">
          <div className="p-3 pr-4 items-center">
            <XCircle size={40} className="text-red-600" />
          </div>
          <div className="p-3 ">
            <h1 className="text-2xl font-bold text-red-600">Error</h1>
            <p className="pt-0 text-md text-red-600">Something went wrong</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ErrorUI
