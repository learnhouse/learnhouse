"use client";

import '../styles/globals.css'
import { AlertTriangle, RefreshCcw } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="flex flex-col items-center space-y-6 max-w-md text-center">
            <div className="bg-rose-100 p-4 rounded-full">
                <AlertTriangle className="text-rose-700" size={48} />
            </div>
            <h2 className="text-3xl font-bold text-gray-900">Something went wrong!</h2>
            <p className="text-gray-600">
                A critical error occurred. This might be due to a connection issue or a temporary server error.
            </p>
            {error?.message && (
                <div className="bg-gray-100 p-3 rounded text-xs font-mono text-gray-700 break-all max-w-full">
                    {error.message}
                </div>
            )}
            <button 
                onClick={() => reset()}
                className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-sm"
            >
                <RefreshCcw size={18} />
                <span>Try again</span>
            </button>
        </div>
      </body>
    </html>
  );
}
