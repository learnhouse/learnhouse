import React, { useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { createProduct } from '@services/payments/products';
import FormLayout, { ButtonBlack, Input, Textarea, FormField, FormLabelAndMessage, Flex } from '@components/StyledElements/Form/Form';
import * as Form from '@radix-ui/react-form';
import { useFormik } from 'formik';
import toast from 'react-hot-toast';
import { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';

interface ProductFormValues {
  name: string;
  description: string;
  product_type: string;
  benefits: string;
  amount: number;
}

const CreateProductForm: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (values: any) => {
    const errors: any = {};

    if (!values.name) {
      errors.name = 'Required';
    }

    if (!values.description) {
      errors.description = 'Required';
    }

    if (!values.amount) {
      errors.amount = 'Required';
    } else {
      const numAmount = Number(values.amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        errors.amount = 'Amount must be greater than 0';
      }
    }

    return errors;
  };

  const formik = useFormik<ProductFormValues>({
    initialValues: {
      name: '',
      description: '',
      product_type: 'one_time',
      benefits: '',
      amount: 0,
    },
    validate,
    onSubmit: async (values) => {
      setIsSubmitting(true);
      try {
        const res = await createProduct(org.id, values, session.data?.tokens?.access_token);
        if (res.success) {
          toast.success('Product created successfully');
          mutate([`/payments/${org.id}/products`, session.data?.tokens?.access_token]);
          formik.resetForm();
          onSuccess(); // Call the onSuccess function to close the modal
        } else {
          toast.error('Failed to create product');
        }
      } catch (error) {
        console.error('Error creating product:', error);
        toast.error('An error occurred while creating the product');
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  return (
    <div className="p-5">
      <FormLayout onSubmit={formik.handleSubmit}>
        <FormField name="name">
          <FormLabelAndMessage label="Product Name" message={formik.errors.name} />
          <Form.Control asChild>
            <Input
              onChange={formik.handleChange}
              value={formik.values.name}
              type="text"
              required
            />
          </Form.Control>
        </FormField>

        <FormField name="description">
          <FormLabelAndMessage label="Description" message={formik.errors.description} />
          <Form.Control asChild>
            <Textarea
              onChange={formik.handleChange}
              value={formik.values.description}
              required
            />
          </Form.Control>
        </FormField>

        <FormField name="benefits">
          <FormLabelAndMessage label="Benefits" />
          <Form.Control asChild>
            <Textarea
              onChange={formik.handleChange}
              value={formik.values.benefits}
            />
          </Form.Control>
        </FormField>

        <FormField name="amount">
          <FormLabelAndMessage label="Amount" message={formik.errors.amount} />
          <Form.Control asChild>
            <Input
              onChange={formik.handleChange}
              value={formik.values.amount}
              type="number"
              min="0"
              step="0.01"
              required
            />
          </Form.Control>
        </FormField>
        <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
          <Form.Submit asChild>
            <ButtonBlack type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Product'}
            </ButtonBlack>
          </Form.Submit>
        </Flex>
      </FormLayout>
    </div>
  );
};

export default CreateProductForm;
