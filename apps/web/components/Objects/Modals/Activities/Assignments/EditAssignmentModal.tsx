import React from 'react';
import { updateAssignment } from '@services/courses/assignments';
import { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';
import toast from 'react-hot-toast';
import FormLayout, {
    FormField,
    FormLabelAndMessage,
    Input,
    Textarea,
    Flex,
    FormLabel,
    FormMessage
} from '@components/Objects/StyledElements/Form/Form';
import * as Form from '@radix-ui/react-form';
import { useFormik } from 'formik';
import Modal from '@components/Objects/StyledElements/Modal/Modal';

interface Assignment {
    assignment_uuid: string;
    title: string;
    description: string;
    due_date?: string;
    grading_type?: 'ALPHABET' | 'NUMERIC' | 'PERCENTAGE';
}

interface EditAssignmentFormProps {
    onClose: () => void;
    assignment: Assignment;
    accessToken: string;
}

interface EditAssignmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    assignment: Assignment;
    accessToken: string;
}

const EditAssignmentForm: React.FC<EditAssignmentFormProps> = ({
    onClose,
    assignment,
    accessToken
}) => {
    const formik = useFormik({
        initialValues: {
            title: assignment.title || '',
            description: assignment.description || '',
            due_date: assignment.due_date || '',
            grading_type: assignment.grading_type || 'ALPHABET'
        },
        enableReinitialize: true,
        onSubmit: async (values, { setSubmitting }) => {
            const toast_loading = toast.loading('Updating assignment...');
            try {
                const res = await updateAssignment(values, assignment.assignment_uuid, accessToken);
                if (res.success) {
                    mutate(`${getAPIUrl()}assignments/${assignment.assignment_uuid}`);
                    toast.success('Assignment updated successfully');
                    onClose();
                } else {
                    toast.error('Failed to update assignment');
                }
            } catch (error) {
                toast.error('An error occurred while updating the assignment');
            } finally {
                toast.dismiss(toast_loading);
                setSubmitting(false);
            }
        }
    });

    return (
        <FormLayout onSubmit={formik.handleSubmit}>
            <FormField name="title">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Assignment Title</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a name for your assignment
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input
                        onChange={formik.handleChange}
                        value={formik.values.title}
                        type="text"
                        required
                    />
                </Form.Control>
            </FormField>

            <FormField name="description">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Assignment Description</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a description for your assignment
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Textarea
                        onChange={formik.handleChange}
                        value={formik.values.description}
                        required
                    />
                </Form.Control>
            </FormField>

            <FormField name="due_date">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Due Date</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a due date for your assignment
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input
                        type="date"
                        onChange={formik.handleChange}
                        value={formik.values.due_date}
                        required
                    />
                </Form.Control>
            </FormField>

            <FormField name="grading_type">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Grading Type</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a grading type for your assignment
                    </FormMessage>
                </Flex>
                <select 
                    id="grading_type"
                    name="grading_type"
                    className='w-full bg-gray-100/40 rounded-lg px-3 py-2 outline outline-1 outline-gray-100'
                    onChange={(e) => formik.setFieldValue('grading_type', e.target.value, true)}
                    value={formik.values.grading_type}
                    required
                >
                    <option value="ALPHABET">Alphabet</option>
                    <option value="NUMERIC">Numeric</option>
                    <option value="PERCENTAGE">Percentage</option>
                </select>
            </FormField>

            <div className="flex justify-end space-x-3 mt-6">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                >
                    Cancel
                </button>
                <Form.Submit asChild>
                    <button
                        type="submit"
                        disabled={formik.isSubmitting}
                        className="px-4 py-2 bg-black text-white font-bold rounded-md hover:bg-black/90"
                    >
                        {formik.isSubmitting ? 'Saving...' : 'Save Changes'}
                    </button>
                </Form.Submit>
            </div>
        </FormLayout>
    );
};

const EditAssignmentModal: React.FC<EditAssignmentModalProps> = ({
    isOpen,
    onClose,
    assignment,
    accessToken
}) => {
    return (
        <Modal
            isDialogOpen={isOpen}
            onOpenChange={onClose}
            minHeight="md"
            minWidth="lg"
            dialogContent={
                <EditAssignmentForm
                    onClose={onClose}
                    assignment={assignment}
                    accessToken={accessToken}
                />
            }
            dialogTitle="Edit Assignment"
            dialogDescription="Update assignment details"
            dialogTrigger={null}
        />
    );
};

export default EditAssignmentModal; 