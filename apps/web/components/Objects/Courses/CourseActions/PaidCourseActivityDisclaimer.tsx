import React from 'react'
import { AlertCircle } from 'lucide-react'
import CoursePaidOptions from './CoursePaidOptions'
import { useTranslation } from 'react-i18next'

interface PaidCourseActivityProps {
  course: any;
}

function PaidCourseActivityDisclaimer({ course }: PaidCourseActivityProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg ">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-800" />
          <h3 className="text-amber-800 font-semibold">{t('payments.paid_content')}</h3>
        </div>
        <p className="text-amber-700 text-sm mt-1">
          {t('payments.paid_content_description')} 
        </p>
      </div>
      <CoursePaidOptions course={course} />
    </div>
  )
}

export default PaidCourseActivityDisclaimer