import React from 'react';
import { updateAssignment } from '@services/courses/assignments';
import { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';
import toast from 'react-hot-toast';
import * as Form from '@radix-ui/react-form';
import { useFormik } from 'formik';
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import { useTranslation } from 'react-i18next';

// Same input class used by the create-assignment modal, so both forms look
// identical to the user.
const inputClass =
    'w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors';
const textareaClass =
    'w-full px-3 py-2 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors resize-none';
const labelClass = 'text-sm font-medium text-gray-700';
const errorClass = 'text-xs text-red-500';
import {
    ALargeSmall,
    Hash,
    Percent,
    ThumbsUp,
    GraduationCap,
    Check,
    Zap,
    Shield,
    AlertTriangle,
    Eye,
} from 'lucide-react';

type GradingType = 'ALPHABET' | 'NUMERIC' | 'PERCENTAGE' | 'PASS_FAIL' | 'GPA_SCALE';

interface Assignment {
    assignment_uuid: string;
    title: string;
    description: string;
    due_date?: string;
    grading_type?: GradingType;
    auto_grading?: boolean;
    anti_copy_paste?: boolean;
    show_correct_answers?: boolean;
    assignment_tasks?: any[];
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

const GRADING_TYPES: {
    value: GradingType;
    labelKey: string;
    descriptionKey: string;
    icon: React.ReactNode;
    color: string;
    selectedBorder: string;
    selectedBg: string;
    illustration: string;
}[] = [
    {
        value: 'ALPHABET',
        labelKey: 'dashboard.assignments.modals.edit.form.grading_types.alphabet',
        descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.alphabet',
        icon: <ALargeSmall size={20} />,
        color: 'text-violet-600',
        selectedBorder: 'border-violet-400',
        selectedBg: 'bg-violet-50',
        illustration: 'A  B  C',
    },
    {
        value: 'NUMERIC',
        labelKey: 'dashboard.assignments.modals.edit.form.grading_types.numeric',
        descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.numeric',
        icon: <Hash size={20} />,
        color: 'text-blue-600',
        selectedBorder: 'border-blue-400',
        selectedBg: 'bg-blue-50',
        illustration: '0 — 100',
    },
    {
        value: 'PERCENTAGE',
        labelKey: 'dashboard.assignments.modals.edit.form.grading_types.percentage',
        descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.percentage',
        icon: <Percent size={20} />,
        color: 'text-emerald-600',
        selectedBorder: 'border-emerald-400',
        selectedBg: 'bg-emerald-50',
        illustration: '85%',
    },
    {
        value: 'PASS_FAIL',
        labelKey: 'dashboard.assignments.modals.edit.form.grading_types.pass_fail',
        descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.pass_fail',
        icon: <ThumbsUp size={20} />,
        color: 'text-amber-600',
        selectedBorder: 'border-amber-400',
        selectedBg: 'bg-amber-50',
        illustration: 'P / F',
    },
    {
        value: 'GPA_SCALE',
        labelKey: 'dashboard.assignments.modals.edit.form.grading_types.gpa_scale',
        descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.gpa_scale',
        icon: <GraduationCap size={20} />,
        color: 'text-rose-600',
        selectedBorder: 'border-rose-400',
        selectedBg: 'bg-rose-50',
        illustration: '0.0 — 4.0',
    },
];

const EditAssignmentForm: React.FC<EditAssignmentFormProps> = ({
    onClose,
    assignment,
    accessToken
}) => {
    const { t } = useTranslation()

    // Auto-grading is incompatible with file-submission tasks — those need
    // human review. If any such task exists, we force the toggle off and
    // show a note explaining why.
    const hasFileSubmissionTask = (assignment.assignment_tasks || []).some(
        (t: any) => t.assignment_type === 'FILE_SUBMISSION'
    );

    const formik = useFormik({
        initialValues: {
            title: assignment.title || '',
            description: assignment.description || '',
            due_date: assignment.due_date || '',
            grading_type: assignment.grading_type || 'ALPHABET',
            auto_grading: assignment.auto_grading || false,
            anti_copy_paste: assignment.anti_copy_paste || false,
            show_correct_answers: assignment.show_correct_answers || false,
        },
        enableReinitialize: true,
        onSubmit: async (values, { setSubmitting }) => {
            // Never send auto_grading=true when the assignment has a file task
            const payload = hasFileSubmissionTask
                ? { ...values, auto_grading: false }
                : values;
            const toast_loading = toast.loading(t('dashboard.assignments.modals.edit.toasts.updating'));
            try {
                const res = await updateAssignment(payload, assignment.assignment_uuid, accessToken);
                if (res.success) {
                    mutate(`${getAPIUrl()}assignments/${assignment.assignment_uuid}`);
                    toast.success(t('dashboard.assignments.modals.edit.toasts.success'));
                    onClose();
                } else {
                    toast.error(t('dashboard.assignments.modals.edit.toasts.error'));
                }
            } catch (error) {
                toast.error(t('dashboard.assignments.modals.edit.toasts.error_detail'));
            } finally {
                toast.dismiss(toast_loading);
                setSubmitting(false);
            }
        }
    });

    return (
        <Form.Root onSubmit={formik.handleSubmit} className="space-y-5">
            {/* Basic info */}
            <Form.Field name="title" className="space-y-1.5">
                <Form.Label className={labelClass}>
                    {t('dashboard.assignments.modals.edit.form.title_label')}
                </Form.Label>
                <Form.Message match="valueMissing" className={errorClass}>
                    {t('dashboard.assignments.modals.edit.form.title_required')}
                </Form.Message>
                <Form.Control asChild>
                    <input
                        onChange={formik.handleChange}
                        value={formik.values.title}
                        type="text"
                        required
                        className={inputClass}
                    />
                </Form.Control>
            </Form.Field>

            <Form.Field name="description" className="space-y-1.5">
                <Form.Label className={labelClass}>
                    {t('dashboard.assignments.modals.edit.form.description_label')}
                </Form.Label>
                <Form.Message match="valueMissing" className={errorClass}>
                    {t('dashboard.assignments.modals.edit.form.description_required')}
                </Form.Message>
                <Form.Control asChild>
                    <textarea
                        onChange={formik.handleChange}
                        value={formik.values.description}
                        required
                        rows={3}
                        className={textareaClass}
                    />
                </Form.Control>
            </Form.Field>

            <Form.Field name="due_date" className="space-y-1.5">
                <Form.Label className={labelClass}>
                    {t('dashboard.assignments.modals.edit.form.due_date_label')}
                </Form.Label>
                <Form.Message match="valueMissing" className={errorClass}>
                    {t('dashboard.assignments.modals.edit.form.due_date_required')}
                </Form.Message>
                <Form.Control asChild>
                    <input
                        type="date"
                        onChange={formik.handleChange}
                        value={formik.values.due_date}
                        required
                        className={inputClass}
                    />
                </Form.Control>
            </Form.Field>

            {/* Grading type */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <p className={labelClass}>
                        {t('dashboard.assignments.modals.edit.form.grading_type_label')}
                    </p>
                    <p className="text-[10px] text-gray-400">
                        {t('dashboard.assignments.modals.edit.form.grading_type_hint')}
                    </p>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                    {GRADING_TYPES.map((gt) => {
                        const isSelected = formik.values.grading_type === gt.value;
                        return (
                            <button
                                key={gt.value}
                                type="button"
                                onClick={() => formik.setFieldValue('grading_type', gt.value, true)}
                                className={`relative flex flex-col items-center text-center p-4 rounded-xl nice-shadow bg-white transition-all cursor-pointer ${
                                    isSelected
                                        ? `${gt.selectedBg} ring-2 ${gt.selectedBorder.replace('border-', 'ring-')}`
                                        : 'hover:bg-gray-50/60'
                                }`}
                            >
                                {isSelected && (
                                    <div className={`absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center ${gt.color} bg-white nice-shadow`}>
                                        <Check size={10} strokeWidth={3} />
                                    </div>
                                )}
                                <div className={`text-lg font-mono font-bold mb-2 tracking-wider ${isSelected ? gt.color : 'text-gray-300'}`}>
                                    {gt.illustration}
                                </div>
                                <div className={`mb-1 ${isSelected ? gt.color : 'text-gray-400'}`}>
                                    {gt.icon}
                                </div>
                                <p className={`text-xs font-bold ${isSelected ? 'text-gray-900' : 'text-gray-500'}`}>
                                    {t(gt.labelKey)}
                                </p>
                                <p className='text-[10px] text-gray-400 mt-0.5 leading-tight'>
                                    {t(gt.descriptionKey)}
                                </p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Grading options */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <p className={labelClass}>
                        {t('dashboard.assignments.modals.edit.form.grading_options_label')}
                    </p>
                    <p className="text-[10px] text-gray-400">
                        {t('dashboard.assignments.modals.edit.form.grading_options_hint')}
                    </p>
                </div>
                <div className="space-y-2">
                    <ToggleRow
                        icon={<Zap size={16} className="text-amber-500" />}
                        label={t('dashboard.assignments.modals.edit.form.auto_grading_label')}
                        description={
                            hasFileSubmissionTask
                                ? t('dashboard.assignments.modals.edit.form.auto_grading_disabled_file')
                                : t('dashboard.assignments.modals.edit.form.auto_grading_description')
                        }
                        checked={!hasFileSubmissionTask && formik.values.auto_grading}
                        disabled={hasFileSubmissionTask}
                        onChange={(v) => formik.setFieldValue('auto_grading', v, true)}
                        warning={hasFileSubmissionTask}
                    />
                    <ToggleRow
                        icon={<Shield size={16} className="text-cyan-500" />}
                        label={t('dashboard.assignments.modals.edit.form.anti_copy_paste_label')}
                        description={t('dashboard.assignments.modals.edit.form.anti_copy_paste_description')}
                        checked={formik.values.anti_copy_paste}
                        onChange={(v) => formik.setFieldValue('anti_copy_paste', v, true)}
                    />
                    <ToggleRow
                        icon={<Eye size={16} className="text-indigo-500" />}
                        label={t('dashboard.assignments.modals.edit.form.show_correct_answers_label')}
                        description={t('dashboard.assignments.modals.edit.form.show_correct_answers_description')}
                        checked={formik.values.show_correct_answers}
                        onChange={(v) => formik.setFieldValue('show_correct_answers', v, true)}
                    />
                </div>
            </div>

            <div className="flex justify-end space-x-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center justify-center h-9 px-5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    {t('dashboard.assignments.modals.edit.form.cancel')}
                </button>
                <Form.Submit asChild>
                    <button
                        type="submit"
                        disabled={formik.isSubmitting}
                        className="inline-flex items-center justify-center h-9 px-5 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                        {formik.isSubmitting ? t('dashboard.assignments.modals.edit.form.saving') : t('dashboard.assignments.modals.edit.form.save')}
                    </button>
                </Form.Submit>
            </div>
        </Form.Root>
    );
};

const EditAssignmentModal: React.FC<EditAssignmentModalProps> = ({
    isOpen,
    onClose,
    assignment,
    accessToken
}) => {
    const { t } = useTranslation()
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
            dialogTitle={t('dashboard.assignments.modals.edit.title')}
            dialogDescription={t('dashboard.assignments.modals.edit.description')}
            dialogTrigger={null}
        />
    );
};

function ToggleRow({
    icon,
    label,
    description,
    checked,
    disabled,
    onChange,
    warning,
}: {
    icon: React.ReactNode;
    label: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
    warning?: boolean;
}) {
    return (
        <div className={`flex items-start justify-between gap-3 p-3 rounded-xl border nice-shadow ${
            disabled ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-100'
        }`}>
            <div className="flex items-start gap-2.5 flex-1 min-w-0">
                <div className="mt-0.5 flex-none">{icon}</div>
                <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-gray-900">{label}</p>
                        {warning && (
                            <AlertTriangle size={12} className="text-amber-500 flex-none" />
                        )}
                    </div>
                    <p className="text-[10px] text-gray-500 leading-snug mt-0.5">
                        {description}
                    </p>
                </div>
            </div>
            <button
                type="button"
                onClick={() => !disabled && onChange(!checked)}
                disabled={disabled}
                aria-pressed={checked}
                className={`relative flex-none inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    disabled
                        ? 'bg-gray-200 cursor-not-allowed'
                        : checked
                            ? 'bg-gray-900'
                            : 'bg-gray-200 hover:bg-gray-300'
                }`}
            >
                <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                        checked ? 'translate-x-5' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
}

export default EditAssignmentModal;
