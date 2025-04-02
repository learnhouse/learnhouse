'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import UnconfiguredPaymentsDisclaimer from '@components/Pages/Payments/UnconfiguredPaymentsDisclaimer'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'
import { Textarea } from '@components/ui/textarea'
import { usePaymentsEnabled } from '@hooks/usePaymentsEnabled'
import { getPaymentConfigs } from '@services/payments/payments'
import {
  archiveProduct,
  getProducts,
  updateProduct,
} from '@services/payments/products'
import currencyCodes from 'currency-codes'
import { ErrorMessage, Field, Form, Formik } from 'formik'
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Info,
  Pencil,
  Plus,
  RefreshCcw,
  SquareCheck,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import * as Yup from 'yup'
import CreateProductForm from './SubComponents/CreateProductForm'
import ProductLinkedCourses from './SubComponents/ProductLinkedCourses'

const validationSchema = Yup.object().shape({
  name: Yup.string().required('Name is required'),
  description: Yup.string().required('Description is required'),
  amount: Yup.number()
    .min(0, 'Amount must be positive')
    .required('Amount is required'),
  benefits: Yup.string(),
  currency: Yup.string().required('Currency is required'),
})

function PaymentsProductPage() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [expandedProducts, setExpandedProducts] = useState<{
    [key: string]: boolean
  }>({})
  const [isStripeEnabled, setIsStripeEnabled] = useState(false)
  const { isEnabled, isLoading } = usePaymentsEnabled()

  const { data: products, error } = useSWR(
    () =>
      org && session
        ? [`/payments/${org.id}/products`, session.data?.tokens?.access_token]
        : null,
    ([url, token]) => getProducts(org.id, token)
  )

  const { data: paymentConfigs, error: paymentConfigError } = useSWR(
    () =>
      org && session
        ? [`/payments/${org.id}/config`, session.data?.tokens?.access_token]
        : null,
    ([url, token]) => getPaymentConfigs(org.id, token)
  )

  useEffect(() => {
    if (paymentConfigs) {
      const stripeConfig = paymentConfigs.find(
        (config: any) => config.provider === 'stripe'
      )
      setIsStripeEnabled(!!stripeConfig)
    }
  }, [paymentConfigs])

  const handleArchiveProduct = async (productId: string) => {
    const res = await archiveProduct(
      org.id,
      productId,
      session.data?.tokens?.access_token
    )
    mutate([`/payments/${org.id}/products`, session.data?.tokens?.access_token])
    if (res.status === 200) {
      toast.success('Product archived successfully')
    } else {
      toast.error(res.data.detail)
    }
  }

  const toggleProductExpansion = (productId: string) => {
    setExpandedProducts((prev) => ({
      ...prev,
      [productId]: !prev[productId],
    }))
  }

  if (!isEnabled && !isLoading) {
    return <UnconfiguredPaymentsDisclaimer />
  }

  if (error) return <div>Failed to load products</div>
  if (!products) return <div>Loading...</div>

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="mx-auto pr-10 pl-10">
        <Modal
          isDialogOpen={isCreateModalOpen}
          onOpenChange={setIsCreateModalOpen}
          dialogTitle="Create New Product"
          dialogDescription="Add a new product to your organization"
          dialogContent={
            <CreateProductForm onSuccess={() => setIsCreateModalOpen(false)} />
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {products.data.map((product: any) => (
            <div
              key={product.id}
              className="nice-shadow flex h-full flex-col rounded-lg bg-white p-4"
            >
              {editingProductId === product.id ? (
                <EditProductForm
                  product={product}
                  onSuccess={() => setEditingProductId(null)}
                  onCancel={() => setEditingProductId(null)}
                />
              ) : (
                <div className="flex h-full flex-col">
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex flex-col items-start space-y-1">
                      <Badge
                        className="flex w-fit items-center space-x-2"
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
                        </span>
                      </Badge>
                      <h3 className="text-lg font-bold">{product.name}</h3>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setEditingProductId(product.id)}
                        className={`text-blue-500 hover:text-blue-700 ${isStripeEnabled ? '' : 'cursor-not-allowed opacity-50'}`}
                        disabled={!isStripeEnabled}
                      >
                        <Pencil size={16} />
                      </button>
                      <ConfirmationModal
                        confirmationButtonText="Archive Product"
                        confirmationMessage="Are you sure you want to archive this product?"
                        dialogTitle={`Archive ${product.name}?`}
                        dialogTrigger={
                          <button className="text-red-500 hover:text-red-700">
                            <Archive size={16} />
                          </button>
                        }
                        functionToExecute={() =>
                          handleArchiveProduct(product.id)
                        }
                        status="warning"
                      />
                    </div>
                  </div>
                  <div className="grow overflow-hidden">
                    <div
                      className={`transition-all duration-300 ease-in-out ${expandedProducts[product.id] ? 'max-h-[1000px]' : 'max-h-24'} overflow-hidden`}
                    >
                      <p className="text-gray-600">{product.description}</p>
                      {product.benefits && (
                        <div className="mt-2">
                          <h4 className="text-sm font-semibold">Benefits:</h4>
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
                  <ProductLinkedCourses productId={product.id} />
                  <div className="mt-2 flex items-center justify-between rounded-md bg-gray-100 p-2">
                    <span className="text-sm text-gray-600">Price:</span>
                    <span className="text-lg font-semibold">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: product.currency,
                      }).format(product.amount)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {products.data.length === 0 && (
          <div className="mx-auto mt-3 flex items-center space-x-2 font-semibold text-gray-600">
            <Info size={20} />
            <p>No products available. Create a new product to get started.</p>
          </div>
        )}

        <div className="flex items-center justify-center py-10">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className={`nice-shadow mb-4 flex items-center space-x-2 rounded-lg border border-gray-600 bg-linear-to-bl from-gray-700 to-gray-900 px-3 py-1.5 font-medium text-white shadow-gray-900/20 transition duration-300 ${
              isStripeEnabled
                ? 'hover:from-gray-600 hover:to-gray-800'
                : 'cursor-not-allowed opacity-50'
            }`}
            disabled={!isStripeEnabled}
          >
            <Plus size={18} />
            <span className="text-sm font-bold">Create New Product</span>
          </button>
        </div>
      </div>
    </div>
  )
}

const EditProductForm = ({
  product,
  onSuccess,
  onCancel,
}: {
  product: any
  onSuccess: () => void
  onCancel: () => void
}) => {
  const org = useOrg() as any
  const session = useLHSession() as any
  const [currencies, setCurrencies] = useState<
    { code: string; name: string }[]
  >([])

  useEffect(() => {
    const allCurrencies = currencyCodes.data.map((currency) => ({
      code: currency.code,
      name: `${currency.code} - ${currency.currency}`,
    }))
    setCurrencies(allCurrencies)
  }, [])

  const initialValues = {
    name: product.name,
    description: product.description,
    amount: product.amount,
    benefits: product.benefits || '',
    currency: product.currency || '',
    product_type: product.product_type,
  }

  const handleSubmit = async (
    values: typeof initialValues,
    { setSubmitting }: { setSubmitting: (isSubmitting: boolean) => void }
  ) => {
    try {
      await updateProduct(
        org.id,
        product.id,
        values,
        session.data?.tokens?.access_token
      )
      mutate([
        `/payments/${org.id}/products`,
        session.data?.tokens?.access_token,
      ])
      onSuccess()
      toast.success('Product updated successfully')
    } catch (error) {
      toast.error('Failed to update product')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={handleSubmit}
    >
      {({ isSubmitting, values, setFieldValue }) => (
        <Form className="space-y-4">
          <div className="flex-col space-y-3 px-1.5 py-2">
            <div>
              <Label htmlFor="name">Product Name</Label>
              <Field name="name" as={Input} placeholder="Product Name" />
              <ErrorMessage
                name="name"
                component="div"
                className="mt-1 text-sm text-red-500"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Field
                name="description"
                as={Textarea}
                placeholder="Product Description"
              />
              <ErrorMessage
                name="description"
                component="div"
                className="mt-1 text-sm text-red-500"
              />
            </div>

            <div className="flex space-x-2">
              <div className="grow">
                <Label htmlFor="amount">Price</Label>
                <Field
                  name="amount"
                  as={Input}
                  type="number"
                  placeholder="Price"
                />
                <ErrorMessage
                  name="amount"
                  component="div"
                  className="mt-1 text-sm text-red-500"
                />
              </div>
              <div className="w-1/3">
                <Label htmlFor="currency">Currency</Label>
                <Select
                  value={values.currency}
                  onValueChange={(value) => setFieldValue('currency', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((currency) => (
                      <SelectItem key={currency.code} value={currency.code}>
                        {currency.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ErrorMessage
                  name="currency"
                  component="div"
                  className="mt-1 text-sm text-red-500"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="benefits">Benefits</Label>
              <Field
                name="benefits"
                as={Textarea}
                placeholder="Product Benefits"
              />
              <ErrorMessage
                name="benefits"
                component="div"
                className="mt-1 text-sm text-red-500"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  )
}

export default PaymentsProductPage
