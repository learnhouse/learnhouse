import FormLayout, { FormField, FormLabelAndMessage, Input, Textarea } from '@components/StyledElements/Form/Form';
import { useFormik } from 'formik';
import { AlertTriangle } from 'lucide-react'
import * as Switch from '@radix-ui/react-switch';
import * as Form from '@radix-ui/react-form';
import React from 'react'
import { useCourse, useCourseDispatch } from '../../Contexts/CourseContext';


type EditCourseStructureProps = {
    orgslug: string,
    course_uuid?: string,
}

const validate = (values: any) => {
    const errors: any = {};

    if (!values.name) {
        errors.name = 'Required';
    }

    if (values.name.length > 100) {
        errors.name = 'Must be 100 characters or less';
    }


    if (!values.description) {
        errors.description = 'Required';

    }

    if (values.description.length > 1000) {
        errors.description = 'Must be 1000 characters or less';
    }


    if (!values.learnings) {
        errors.learnings = 'Required';
    }

    return errors;
};


function EditCourseGeneral(props: EditCourseStructureProps) {
    const [error, setError] = React.useState('');
    const course = useCourse() as any;
    const dispatchCourse = useCourseDispatch() as any;

    const courseStructure = course.courseStructure;
    const formik = useFormik({
        initialValues: {
            name: String(courseStructure.name),
            description: String(courseStructure.description),
            about: String(courseStructure.about),
            learnings: String(courseStructure.learnings),
            tags: String(courseStructure.tags),
            public: String(courseStructure.public),
        },
        validate,
        onSubmit: async values => {

        },
        enableReinitialize: true,
    });


    React.useEffect(() => {
        // This code will run whenever form values are updated
        if (formik.values !== formik.initialValues) {
            dispatchCourse({ type: 'setIsNotSaved' });
            const updatedCourse = {
                ...courseStructure,
                name: formik.values.name,
                description: formik.values.description,
                about: formik.values.about,
                learnings: formik.values.learnings,
                tags: formik.values.tags,
                public: formik.values.public,
            }
            dispatchCourse({ type: 'setCourseStructure', payload: updatedCourse });
        }

    }, [course, formik.values, formik.initialValues]);

    return (
        <div className='ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-6 py-5'>

            {course.courseStructure && (
                <div className="editcourse-form">
                    {error && (
                        <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-sm">
                            <AlertTriangle size={18} />
                            <div className="font-bold text-sm">{error}</div>
                        </div>
                    )}
                    <FormLayout onSubmit={formik.handleSubmit}>
                        <FormField name="name">
                            <FormLabelAndMessage label='Name' message={formik.errors.name} />
                            <Form.Control asChild>
                                <Input style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.name} type="text" required />
                            </Form.Control>
                        </FormField>

                        <FormField name="description">
                            <FormLabelAndMessage label='Description' message={formik.errors.description} />
                            <Form.Control asChild>
                                <Textarea style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.description} required />
                            </Form.Control>
                        </FormField>

                        <FormField name="about">
                            <FormLabelAndMessage label='About' message={formik.errors.about} />
                            <Form.Control asChild>
                                <Textarea style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.about} required />
                            </Form.Control>
                        </FormField>

                        <FormField name="learnings">
                            <FormLabelAndMessage label='Learnings' message={formik.errors.learnings} />
                            <Form.Control asChild>
                                <Textarea style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.learnings} required />
                            </Form.Control>
                        </FormField>

                        <FormField name="tags">
                            <FormLabelAndMessage label='Tags' message={formik.errors.tags} />
                            <Form.Control asChild>
                                <Textarea style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.tags} required />
                            </Form.Control>
                        </FormField>

                        <FormField className="flex items-center h-10" name="public">
                            <div className='flex my-auto items-center'>
                                <label className="text-black text-[15px] leading-none pr-[15px]" htmlFor="public-course">
                                    Public Course
                                </label>
                                <Switch.Root
                                    className="w-[42px] h-[25px] bg-neutral-200 rounded-full relative  data-[state=checked]:bg-neutral-500 outline-none cursor-default"
                                    id="public-course"
                                    onCheckedChange={checked => formik.setFieldValue('public', checked)}
                                    checked={formik.values.public === 'true'}
                                >
                                    <Switch.Thumb className="block w-[21px] h-[21px] bg-white rounded-full shadow-[0_2px_2px] shadow-neutral-300 transition-transform duration-100 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[19px]" />
                                </Switch.Root>
                            </div>
                        </FormField>

                    </FormLayout>
                </div>
            )}
        </div>
    )
}

export default EditCourseGeneral