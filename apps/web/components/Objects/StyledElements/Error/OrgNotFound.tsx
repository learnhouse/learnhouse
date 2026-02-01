'use client'
import { AlertTriangle, Building2, Mail, ArrowRight } from 'lucide-react'
import React from 'react'

function OrgNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-md w-full mx-4 p-8 bg-white rounded-2xl shadow-lg">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
            <Building2 className="h-8 w-8 text-yellow-600" />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">
            Organization Not Found
          </h1>
          <p className="mt-3 text-sm text-gray-600">
            We couldn't determine which organization you're trying to access.
          </p>
        </div>

        <div className="mt-8 space-y-6">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">This might happen if:</p>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                <span>The URL is missing the organization subdomain</span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                <span>Your session has expired</span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                <span>The link you followed is invalid or expired</span>
              </li>
            </ul>
          </div>

          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Try the following:</p>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <span>
                  Go to <code className="px-1.5 py-0.5 bg-blue-100 rounded text-blue-700 text-xs">yourorg.learnhouse.io</code>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Mail className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <span>Click the original link from your email again</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <span>Contact your organization administrator</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OrgNotFound
