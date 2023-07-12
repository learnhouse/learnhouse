import FormLayout, { ButtonBlack, FormField, FormLabel, FormLabelAndMessage, FormMessage, Input } from '@components/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form';
import { getAPIUrl } from '@services/config/config';
import { createNewUserInstall, updateInstall } from '@services/install/install';
import { swrFetcher } from '@services/utils/ts/requests';
import { useFormik } from 'formik';
import { useRouter } from 'next/navigation';
import React from 'react'
import { BarLoader } from 'react-spinners';
import useSWR, { mutate } from "swr";

const validate = (values: any) => {
    const errors: any = {};

    if (!values.email) {
        errors.email = 'Required';
    }
    else if (
        !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)
    ) {
        errors.email = 'Invalid email address';
    }

    if (!values.password) {
        errors.password = 'Required';
    }
    else if (values.password.length < 8) {
        errors.password = 'Password must be at least 8 characters';
    }

    if (!values.confirmPassword) {
        errors.confirmPassword = 'Required';
    }
    else if (values.confirmPassword !== values.password) {
        errors.confirmPassword = 'Passwords must match';
    }

    if (!values.username) {
        errors.username = 'Required';
    }
    else if (values.username.length < 3) {
        errors.username = 'Username must be at least 3 characters';
    }

    return errors;
};

function AccountCreation() {
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const { data: install, error: error, isLoading } = useSWR(`${getAPIUrl()}install/latest`, swrFetcher);
    const router = useRouter(

    )
    const formik = useFormik({
        initialValues: {
            org_slug: '',
            email: '',
            password: '',
            confirmPassword: '',
            username: '',
        },
        validate,
        onSubmit: values => {
            console.log(install.data[1].slug)
            let finalvalues = { ...values, org_slug: install.data[1].slug }
            let finalvalueswithoutpasswords = { ...values, password: '', confirmPassword: '', org_slug: install.data[1].slug }
            let install_data = { ...install.data, 3: finalvalues }
            let install_data_without_passwords = { ...install.data, 3: finalvalueswithoutpasswords }
            updateInstall({ ...install_data_without_passwords }, 4)
            createNewUserInstall(finalvalues)

            // await 2 seconds
            setTimeout(() => {
                setIsSubmitting(false)
            }, 2000)

            router.push('/install?step=4')

        },
    });

    return (
        <div>
            <FormLayout onSubmit={formik.handleSubmit}>
                <FormField name="email">
                    <FormLabelAndMessage label='Email' message={formik.errors.email} />
                    <Form.Control asChild>
                        <Input onChange={formik.handleChange} value={formik.values.email} type="email" required />
                    </Form.Control>
                </FormField>
                {/* for password  */}
                <FormField name="password">
                    <FormLabelAndMessage label='Password' message={formik.errors.password} />

                    <Form.Control asChild>
                        <Input onChange={formik.handleChange} value={formik.values.password} type="password" required />
                    </Form.Control>
                </FormField>
                {/* for confirm password  */}
                <FormField name="confirmPassword">

                    <FormLabelAndMessage label='Confirm Password' message={formik.errors.confirmPassword} />

                    <Form.Control asChild>
                        <Input onChange={formik.handleChange} value={formik.values.confirmPassword} type="password" required />
                    </Form.Control>
                </FormField>
                {/* for username  */}
                <FormField name="username">

                    <FormLabelAndMessage label='Username' message={formik.errors.username} />

                    <Form.Control asChild>
                        <Input onChange={formik.handleChange} value={formik.values.username} type="text" required />
                    </Form.Control>
                </FormField>

                <div className="flex flex-row-reverse py-4">
                    <Form.Submit asChild>
                        <ButtonBlack type="submit" css={{ marginTop: 10 }}>
                            {isSubmitting ? <BarLoader cssOverride={{ borderRadius: 60, }} width={60} color="#ffffff" />
                                : "Create Admin Account"}
                        </ButtonBlack>
                    </Form.Submit>
                </div>

            </FormLayout>
        </div>
    )
}

export default AccountCreation