import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert'
import { ChevronRight, CreditCard, Settings } from 'lucide-react'
import { AlertTriangle, ShoppingCart, Users } from 'lucide-react'
import Link from 'next/link'
import React from 'react'

function UnconfiguredPaymentsDisclaimer() {
  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="mx-auto mr-10 ml-10">
        <Alert className="light-shadow mb-3 border-2 border-yellow-200 bg-yellow-100/50 p-6">
          <AlertTitle className="mb-2 flex items-center space-x-2 text-lg font-semibold">
            <AlertTriangle className="h-5 w-5" />
            <span>Payments not yet properly configured</span>
          </AlertTitle>
          <AlertDescription className="space-y-5">
            <div className="pl-2">
              <ul className="list-inside list-disc space-y-1 pl-2 text-gray-600">
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
              className="inline-flex items-center pl-2 font-medium text-yellow-900 transition-colors duration-200 hover:text-yellow-700"
            >
              <Settings className="mr-1.5 h-4 w-4" />
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
