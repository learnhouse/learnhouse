'use client'
import { Loader2 } from 'lucide-react'

function PageLoading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="animate-page-loading-in">
        <Loader2 className="w-10 h-10 text-gray-400 animate-spin" />
      </div>
    </div>
  )
}

export default PageLoading
