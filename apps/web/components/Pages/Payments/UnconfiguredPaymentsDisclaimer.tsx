import {  Settings, ChevronRight, CreditCard } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@components/ui/alert'
import { AlertTriangle, ShoppingCart, Users } from 'lucide-react'
import React from 'react'
import Link from 'next/link'

function UnconfiguredPaymentsDisclaimer() {
  return (
    <div className="h-full w-full bg-[#f8f8f8]">
        <div className="ml-10 mr-10 mx-auto">
          <Alert className="mb-3 p-6 border-2 border-yellow-200 bg-yellow-100/50 light-shadow">
            <AlertTitle className="text-lg font-semibold mb-2 flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5" />
              <span>Payments not yet properly configured</span>
            </AlertTitle>
            <AlertDescription className="space-y-5">
              <div className="pl-2">
                <ul className="list-disc list-inside space-y-1 text-gray-600 pl-2">
                  <li className="flex items-center space-x-2">
                    <CreditCard className="h-4 w-4" />
                    <span>Configure Stripe to start accepting payments</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <ShoppingCart className="h-4 w-4" />
                    <span>Create and manage products</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Users className="h-4 w-4" />
                    <span>Start selling to your customers</span>
                  </li>
                </ul>
              </div>
              <Link
                href="./configuration" 
                className="text-yellow-900 hover:text-yellow-700 inline-flex items-center font-medium transition-colors duration-200 pl-2"
              >
                <Settings className="h-4 w-4 mr-1.5" />
                Go to Payment Configuration
                <ChevronRight className="ml-1.5 h-4 w-4" />
              </Link>
            </AlertDescription>
          </Alert>
        </div>
      </div>
  )
}

export default UnconfiguredPaymentsDisclaimer