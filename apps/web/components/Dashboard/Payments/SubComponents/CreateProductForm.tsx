import React, { useEffect, useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { createProduct } from '@services/payments/products';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import toast from 'react-hot-toast';
import { mutate } from 'swr';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import currencyCodes from 'currency-codes';

const validationSchema = Yup.object().shape({
  name: Yup.string().required('Name is required'),
  description: Yup.string().required('Description is required'),
  amount: Yup.number().min(0, 'Amount must be positive').required('Amount is required'),
  benefits: Yup.string(),
  currency: Yup.string().required('Currency is required'),
  product_type: Yup.string().oneOf(['one_time', 'subscription']).required('Product type is required'),
});

interface ProductFormValues {
  name: string;
  description: string;
  product_type: 'one_time' | 'subscription';
  benefits: string;
  amount: number;
  currency: string;
}

const CreateProductForm: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    const allCurrencies = currencyCodes.data.map(currency => ({
      code: currency.code,
      name: `${currency.code} - ${currency.currency}`
    }));
    setCurrencies(allCurrencies);
  }, []);

  const initialValues: ProductFormValues = {
    name: '',
    description: '',
    product_type: 'one_time',
    benefits: '',
    amount: 0,
    currency: 'USD',
  };

  const handleSubmit = async (values: ProductFormValues, { setSubmitting, resetForm }: any) => {
    try {
      const res = await createProduct(org.id, values, session.data?.tokens?.access_token);
      if (res.success) {
        toast.success('Product created successfully');
        mutate([`/payments/${org.id}/products`, session.data?.tokens?.access_token]);
        resetForm();
        onSuccess();
      } else {
        toast.error('Failed to create product');
      }
    } catch (error) {
      console.error('Error creating product:', error);
      toast.error('An error occurred while creating the product');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={handleSubmit}
    >
      {({ isSubmitting, values, setFieldValue }) => (
        <Form className="space-y-4">
          <div className='px-1.5 py-2 flex-col space-y-3'>
            <div>
              <Label htmlFor="name">Product Name</Label>
              <Field name="name" as={Input} placeholder="Product Name" />
              <ErrorMessage name="name" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Field name="description" as={Textarea} placeholder="Product Description" />
              <ErrorMessage name="description" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div className="flex space-x-2">
              <div className="flex-grow">
                <Label htmlFor="amount">Price</Label>
                <Field name="amount" as={Input} type="number" placeholder="Price" />
                <ErrorMessage name="amount" component="div" className="text-red-500 text-sm mt-1" />
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
                <ErrorMessage name="currency" component="div" className="text-red-500 text-sm mt-1" />
              </div>
            </div>

            <div>
              <Label htmlFor="product_type">Product Type</Label>
              <Select
                value={values.product_type}
                onValueChange={(value) => setFieldValue('product_type', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Product Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_time">One Time</SelectItem>
                  <SelectItem value="subscription">Subscription</SelectItem>
                </SelectContent>
              </Select>
              <ErrorMessage name="product_type" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div>
              <Label htmlFor="benefits">Benefits</Label>
              <Field name="benefits" as={Textarea} placeholder="Product Benefits" />
              <ErrorMessage name="benefits" component="div" className="text-red-500 text-sm mt-1" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Product'}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default CreateProductForm;
