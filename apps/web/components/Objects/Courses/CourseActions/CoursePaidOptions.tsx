import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { getUriWithOrg } from '@services/config/config'
import {
  getProductsByCourse,
  getStripeProductCheckoutSession,
} from '@services/payments/products'
import { ChevronDown, ChevronUp, RefreshCcw, SquareCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import toast from 'react-hot-toast'
import useSWR from 'swr'

interface CoursePaidOptionsProps {
  course: {
    id: string
    org_id: number
  }
}

function CoursePaidOptions({ course }: CoursePaidOptionsProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const [expandedProducts, setExpandedProducts] = useState<{
    [key: string]: boolean
  }>({})
  const [isProcessing, setIsProcessing] = useState<{ [key: string]: boolean }>(
    {}
  )
  const router = useRouter()

  const { data: linkedProducts, error } = useSWR(
    () =>
      org && session
        ? [
            `/payments/${course.org_id}/courses/${course.id}/products`,
            session.data?.tokens?.access_token,
          ]
        : null,
    ([url, token]) => getProductsByCourse(course.org_id, course.id, token)
  )

  const handleCheckout = async (productId: number) => {
    if (!session.data?.user) {
      // Redirect to login if user is not authenticated
      router.push(`/signup?orgslug=${org.slug}`)
      return
    }

    try {
      setIsProcessing((prev) => ({ ...prev, [productId]: true }))
      const redirect_uri = getUriWithOrg(org.slug, '/courses')
      const response = await getStripeProductCheckoutSession(
        course.org_id,
        productId,
        redirect_uri,
        session.data?.tokens?.access_token
      )

      if (response.success) {
        router.push(response.data.checkout_url)
      } else {
        toast.error('Failed to initiate checkout process')
      }
    } catch (error) {
      toast.error('An error occurred while processing your request')
    } finally {
      setIsProcessing((prev) => ({ ...prev, [productId]: false }))
    }
  }

  const toggleProductExpansion = (productId: string) => {
    setExpandedProducts((prev) => ({
      ...prev,
      [productId]: !prev[productId],
    }))
  }

  if (error) return <div>Failed to load product options</div>
  if (!linkedProducts) return <div>Loading...</div>

  return (
    <div className="space-y-4 p-1">
      {linkedProducts.data.map((product: any) => (
        <div
          key={product.id}
          className="nice-shadow flex flex-col rounded-lg bg-slate-50/30 p-4"
        >
          <div className="mb-2 flex items-start justify-between">
            <div className="flex flex-col items-start space-y-1">
              <Badge
                className="flex w-fit items-center space-x-2 bg-gray-100/50"
                variant="outline"
              >
                {product.product_type === 'subscription' ? (
                  <RefreshCcw size={12} />
                ) : (
                  <SquareCheck size={12} />
                )}
                <span className="text-sm">
                  {product.product_type === 'subscription'
                    ? 'Subscription'
                    : 'One-time payment'}
                  {product.product_type === 'subscription' && ' (per month)'}
                </span>
              </Badge>
              <h3 className="text-lg font-bold">{product.name}</h3>
            </div>
          </div>

          <div className="grow overflow-hidden">
            <div
              className={`transition-all duration-300 ease-in-out ${
                expandedProducts[product.id] ? 'max-h-[1000px]' : 'max-h-24'
              } overflow-hidden`}
            >
              <p className="text-gray-600">{product.description}</p>
              {product.benefits && (
                <div className="mt-2">
                  <h4 className="text-sm font-semibold">Benefits:</h4>
                  <p className="text-sm text-gray-600">{product.benefits}</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2">
            <button
              onClick={() => toggleProductExpansion(product.id)}
              className="flex items-center text-sm text-slate-500 hover:text-slate-700"
            >
              {expandedProducts[product.id] ? (
                <>
                  <ChevronUp size={16} />
                  <span>Show less</span>
                </>
              ) : (
                <>
                  <ChevronDown size={16} />
                  <span>Show more</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between rounded-md bg-gray-100 p-2">
            <span className="text-sm text-gray-600">
              {product.price_type === 'customer_choice'
                ? 'Minimum Price:'
                : 'Price:'}
            </span>
            <div className="flex flex-col items-end">
              <span className="text-lg font-semibold">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: product.currency,
                }).format(product.amount)}
                {product.product_type === 'subscription' && (
                  <span className="ml-1 text-sm text-gray-500">/month</span>
                )}
              </span>
              {product.price_type === 'customer_choice' && (
                <span className="text-sm text-gray-500">Choose your price</span>
              )}
            </div>
          </div>

          <Button
            className="mt-4 w-full"
            variant="default"
            onClick={() => handleCheckout(product.id)}
            disabled={isProcessing[product.id]}
          >
            {isProcessing[product.id]
              ? 'Processing...'
              : product.product_type === 'subscription'
                ? 'Subscribe Now'
                : 'Purchase Now'}
          </Button>
        </div>
      ))}
    </div>
  )
}

export default CoursePaidOptions
