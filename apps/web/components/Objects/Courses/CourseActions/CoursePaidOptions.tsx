import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useSWR from 'swr'
import { getProductsByCourse, getStripeProductCheckoutSession } from '@services/payments/products'
import { RefreshCcw, SquareCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { getUriWithOrg } from '@services/config/config'

interface CoursePaidOptionsProps {
  course: {
    id: string;
    org_id: number;
  }
}

function CoursePaidOptions({ course }: CoursePaidOptionsProps) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const [expandedProducts, setExpandedProducts] = useState<{ [key: string]: boolean }>({})
  const [isProcessing, setIsProcessing] = useState<{ [key: string]: boolean }>({})
  const router = useRouter()

  const { data: linkedProducts, error } = useSWR(
    () => org && session ? [`/payments/${course.org_id}/courses/${course.id}/products`, session.data?.tokens?.access_token] : null,
    ([url, token]) => getProductsByCourse(course.org_id, course.id, token)
  )

  const handleCheckout = async (productId: number) => {
    if (!session.data?.user) {
      // Redirect to login if user is not authenticated
      router.push(`/signup?orgslug=${org.slug}`)
      return
    }

    try {
      setIsProcessing(prev => ({ ...prev, [productId]: true }))
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
        toast.error(t('payments.failed_checkout'))
      }
    } catch (error) {
      toast.error(t('common.error_request'))
    } finally {
      setIsProcessing(prev => ({ ...prev, [productId]: false }))
    }
  }

  const toggleProductExpansion = (productId: string) => {
    setExpandedProducts(prev => ({
      ...prev,
      [productId]: !prev[productId]
    }))
  }

  if (error) return <div>{t('payments.failed_load_products')}</div>
  if (!linkedProducts) return <div>{t('common.loading')}</div>

  return (
    <div className="space-y-4 p-1">
      {linkedProducts.data.map((product: any) => (
        <div key={product.id} className="bg-slate-50/30 p-4 rounded-lg nice-shadow flex flex-col">
          <div className="flex justify-between items-start mb-2">
            <div className="flex flex-col space-y-1 items-start">
              <Badge className='w-fit flex items-center space-x-2 bg-gray-100/50' variant="outline">
                {product.product_type === 'subscription' ? <RefreshCcw size={12} /> : <SquareCheck size={12} />}
                <span className='text-sm'>
                  {product.product_type === 'subscription' ? t('payments.subscription') : t('payments.one_time_payment')}
                  {product.product_type === 'subscription' && ` ${t('payments.per_month')}`}
                </span>
              </Badge>
              <h3 className="font-bold text-lg">{product.name}</h3>
            </div>
          </div>

          <div className="grow overflow-hidden">
            <div className={`transition-all duration-300 ease-in-out ${expandedProducts[product.id] ? 'max-h-[1000px]' : 'max-h-24'
              } overflow-hidden`}>
              <p className="text-gray-600">
                {product.description}
              </p>
              {product.benefits && (
                <div className="mt-2">
                  <h4 className="font-semibold text-sm">{t('payments.benefits')}</h4>
                  <p className="text-sm text-gray-600">
                    {product.benefits}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2">
            <button
              onClick={() => toggleProductExpansion(product.id)}
              className="text-slate-500 hover:text-slate-700 text-sm flex items-center"
            >
              {expandedProducts[product.id] ? (
                <>
                  <ChevronUp size={16} />
                  <span>{t('common.show_less')}</span>
                </>
              ) : (
                <>
                  <ChevronDown size={16} />
                  <span>{t('common.show_more')}</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between bg-gray-100 rounded-md p-2">
            <span className="text-sm text-gray-600">
              {product.price_type === 'customer_choice' ? t('payments.min_price') : t('common.price')}
            </span>
            <div className="flex flex-col items-end">
              <span className="font-semibold text-lg">
                {new Intl.NumberFormat(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
                  style: 'currency',
                  currency: product.currency
                }).format(product.amount)}
                {product.product_type === 'subscription' && <span className="text-sm text-gray-500 ml-1">{t('payments.per_month_short')}</span>}
              </span>
              {product.price_type === 'customer_choice' && (
                <span className="text-sm text-gray-500">{t('payments.choose_price')}</span>
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
              ? t('common.processing')
              : product.product_type === 'subscription'
                ? t('payments.subscribe_now')
                : t('payments.purchase_now')
            }
          </Button>
        </div>
      ))}
    </div>
  )
}

export default CoursePaidOptions
